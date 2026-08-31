/**
 * convergence-harness.ts
 *
 * Drives the real language fact adapters + resolution pipeline (the same
 * `factAdapter.extract`/`buildResolutionIndexes`/`materializeSemanticRelationships`
 * production code uses) through a scripted edit history, applying each edit
 * either as a full rebuild or through the dependency-aware incremental path
 * (semantic-snapshot/reverse-dependency-index/semantic-delta/re-resolve),
 * so tests can assert the two converge to the same ConvergenceSnapshot.
 *
 * This is test-only glue, not a new production code path: production still
 * always chooses full rebuild for any non-zero change (rollout-gate.ts).
 */
import { createKnowledgeGraph, type KnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { generateNodeId } from '../../../src/graph/id-generator.js';
import { detectLanguage } from '../../../src/shared/index.js';
import { getLanguageFactAdapter } from '../../../src/semantic/adapters/registry.js';
import { projectFactBundle } from '../../../src/semantic/graph-projector.js';
import { buildResolutionIndexes, createResolutionInstrumentation } from '../../../src/resolution/indexes.js';
import { materializeSemanticRelationships } from '../../../src/resolution/materialize-relationships.js';
import { RESOLVER_VERSION } from '../../../src/resolution/contracts.js';
import type { ResolutionEvidenceStore } from '../../../src/evidence/store.js';
import type { SemanticFact } from '../../../src/semantic/facts.js';
import {
  computeSemanticCompatibility,
  createSemanticSnapshot,
  type SemanticSnapshot,
} from '../../../src/incremental/semantic-snapshot.js';
import { buildReverseDependencyIndex, type ReverseDependencyIndex } from '../../../src/incremental/reverse-dependency-index.js';
import { computeSemanticDelta, type SemanticDelta } from '../../../src/incremental/semantic-delta.js';
import { selectFactsForReResolution } from '../../../src/incremental/re-resolve.js';
import { buildConvergenceSnapshot, type ConvergenceSnapshot } from '../../../src/incremental/convergence-snapshot.js';

export type WorkspaceFiles = Record<string, string>;

export const HARNESS_COMPATIBILITY = computeSemanticCompatibility();

function extractFacts(relativePath: string, source: string): SemanticFact[] {
  const lang = detectLanguage(relativePath);
  if (!lang) return [];
  return [...getLanguageFactAdapter(lang).extract({
    language: lang, filePath: relativePath, workspaceRoot: '.', source,
  }).facts];
}

function seedFileNode(graph: KnowledgeGraph, relativePath: string): void {
  if (graph.getNode(generateNodeId('file', relativePath, relativePath))) return;
  graph.addNode({ id: generateNodeId('file', relativePath, relativePath), kind: 'file', name: relativePath, filePath: relativePath });
}

function projectFacts(graph: KnowledgeGraph, relativePath: string, facts: readonly SemanticFact[]): void {
  const lang = detectLanguage(relativePath);
  if (!lang) return;
  const projected = projectFactBundle({ schema: { version: '1', language: lang, adapterId: 'convergence-harness' }, facts, diagnostics: [] });
  for (const node of projected.nodes) graph.addNode(node);
  for (const edge of projected.edges) graph.addEdge(edge);
}

function materialize(graph: KnowledgeGraph, facts: readonly SemanticFact[], evidenceStore: ResolutionEvidenceStore): void {
  const indexes = buildResolutionIndexes(facts, createResolutionInstrumentation());
  materializeSemanticRelationships({ graph, facts, indexes, evidenceStore, resolverVersion: RESOLVER_VERSION });
}

export interface HarnessState {
  graph: KnowledgeGraph;
  factsByFile: Map<string, SemanticFact[]>;
  snapshot: SemanticSnapshot;
  reverseIndex: ReverseDependencyIndex;
}

/** Build the initial state (equivalent to a full analyze) for a workspace of files. */
export function buildInitialState(files: WorkspaceFiles, evidenceStore: ResolutionEvidenceStore): HarnessState {
  const graph = createKnowledgeGraph();
  const factsByFile = new Map<string, SemanticFact[]>();
  for (const [relativePath, source] of Object.entries(files)) {
    seedFileNode(graph, relativePath);
    const facts = extractFacts(relativePath, source);
    factsByFile.set(relativePath, facts);
    projectFacts(graph, relativePath, facts);
  }
  materialize(graph, [...factsByFile.values()].flat(), evidenceStore);
  return {
    graph,
    factsByFile,
    snapshot: createSemanticSnapshot(factsByFile, HARNESS_COMPATIBILITY),
    reverseIndex: buildReverseDependencyIndex(factsByFile),
  };
}

/** A fresh full rebuild of the given final tree — the correctness baseline. */
export function runFullRebuild(files: WorkspaceFiles, evidenceStore: ResolutionEvidenceStore): HarnessState {
  return buildInitialState(files, evidenceStore);
}

/**
 * `contains` (file -> declaration) edges are structural, produced once by
 * `projectFacts` when a file is reparsed — not by `materializeSemanticRelationships`.
 * An invalidated-but-unchanged consumer file is never reparsed (only its
 * relationship facts are re-resolved), so removing its `contains` edges here
 * would delete them with nothing left to recreate them. Only files actually
 * being reparsed (`removeContainsEdgesToo`) get their structural edges wiped.
 */
function removeEdgesForFiles(graph: KnowledgeGraph, files: ReadonlySet<string>, removeContainsEdgesToo: boolean): void {
  const filePathByNodeId = new Map(Array.from(graph.allNodes(), (n) => [n.id, n.filePath] as const));
  for (const edge of [...graph.allEdges()]) {
    if (!removeContainsEdgesToo && edge.kind === 'contains') continue;
    const filePath = filePathByNodeId.get(edge.source);
    if (filePath && files.has(filePath)) graph.removeEdge(edge.id);
  }
}

function removeDeclarationNodesForFiles(graph: KnowledgeGraph, files: ReadonlySet<string>, options: { includeFileNode: boolean }): void {
  for (const node of [...graph.allNodes()]) {
    if (!files.has(node.filePath)) continue;
    if (node.kind === 'file' && !options.includeFileNode) continue;
    graph.removeNodeCascade(node.id);
  }
}

type DeclarationNodeMetadata = { semantic?: { factId?: string } };

/**
 * Remove only the declaration nodes whose backing fact actually disappeared
 * or changed identity (`touchedFactIds`) — NOT every declaration in a changed
 * file. `removeNodeCascade` also drops incoming edges, so blanket-removing an
 * unrelated, unchanged sibling declaration in the same file would silently
 * orphan edges from consumers elsewhere that were never re-selected for
 * re-resolution (nothing invalidated them, because nothing about that
 * declaration changed).
 */
function removeTouchedDeclarationNodes(graph: KnowledgeGraph, filePath: string, touchedFactIds: ReadonlySet<string>): void {
  for (const node of [...graph.allNodes()]) {
    if (node.filePath !== filePath || node.kind === 'file') continue;
    const factId = (node.metadata as DeclarationNodeMetadata | undefined)?.semantic?.factId;
    if (factId && touchedFactIds.has(factId)) graph.removeNodeCascade(node.id);
  }
}

export interface IncrementalEditResult {
  delta: SemanticDelta;
  state: HarnessState;
}

/**
 * Apply one edit incrementally: parse only the changed files, compute the
 * dependency-aware delta against the previous snapshot, and — when the
 * closure is proven complete — remove and re-materialize only the affected
 * files' edges (mirroring what a real incremental publish would do to
 * graph.db). Returns the delta unconditionally so callers can assert on it
 * even when it requires full resolution (the caller then falls back itself).
 */
export function applyIncrementalEdit(
  state: HarnessState,
  evidenceStore: ResolutionEvidenceStore,
  changes: { changedFiles?: WorkspaceFiles; deletedFiles?: string[] },
): IncrementalEditResult {
  const changedFiles = Object.keys(changes.changedFiles ?? {});
  const deletedFiles = changes.deletedFiles ?? [];
  const newFactsByFile = new Map<string, SemanticFact[]>();
  for (const [relativePath, source] of Object.entries(changes.changedFiles ?? {})) {
    newFactsByFile.set(relativePath, extractFacts(relativePath, source));
  }

  const delta = computeSemanticDelta({
    changedFiles,
    deletedFiles,
    previousSnapshot: state.snapshot,
    newFactsByFile,
    reverseIndex: state.reverseIndex,
    compatibility: HARNESS_COMPATIBILITY,
  });

  if (delta.requiresFullResolution) return { delta, state };

  const invalidatedFileSet = new Set<string>();
  const invalidatedFactIds = new Set([...delta.invalidatedReferences, ...delta.invalidatedCallSites, ...delta.invalidatedSymbols]);
  if (invalidatedFactIds.size > 0) {
    for (const file of state.snapshot.files) {
      if (changedFiles.includes(file.filePath) || deletedFiles.includes(file.filePath)) continue;
      if (file.facts.some((fact) => invalidatedFactIds.has(fact.factId))) invalidatedFileSet.add(file.filePath);
    }
  }
  const reparsedFiles = new Set([...changedFiles, ...deletedFiles]);

  removeEdgesForFiles(state.graph, reparsedFiles, true);
  removeEdgesForFiles(state.graph, invalidatedFileSet, false);
  const touchedFactIds = new Set([...delta.removedFacts, ...delta.changedFacts]);
  for (const filePath of changedFiles) removeTouchedDeclarationNodes(state.graph, filePath, touchedFactIds);
  removeDeclarationNodesForFiles(state.graph, new Set(deletedFiles), { includeFileNode: true });

  const factsByFile = new Map(state.factsByFile);
  for (const filePath of changedFiles) {
    const facts = newFactsByFile.get(filePath) ?? [];
    factsByFile.set(filePath, facts);
    seedFileNode(state.graph, filePath);
    projectFacts(state.graph, filePath, facts);
  }
  for (const filePath of deletedFiles) factsByFile.delete(filePath);

  const factsToReResolve = selectFactsForReResolution({ delta, previousSnapshot: state.snapshot, newFactsByFile });
  const freshIndexes = buildResolutionIndexes([...factsByFile.values()].flat(), createResolutionInstrumentation());
  materializeSemanticRelationships({
    graph: state.graph, facts: factsToReResolve, indexes: freshIndexes, evidenceStore, resolverVersion: RESOLVER_VERSION,
  });

  const nextState: HarnessState = {
    graph: state.graph,
    factsByFile,
    snapshot: createSemanticSnapshot(factsByFile, HARNESS_COMPATIBILITY),
    reverseIndex: buildReverseDependencyIndex(factsByFile),
  };
  return { delta, state: nextState };
}

export function snapshotOf(state: HarnessState, evidenceStore: ResolutionEvidenceStore): ConvergenceSnapshot {
  const nodes = [...state.graph.allNodes()];
  const edges = [...state.graph.allEdges()];
  const evidenceRecords = edges
    .map((edge) => (edge.evidenceRef ? evidenceStore.get(edge.evidenceRef) : null))
    .filter((record): record is NonNullable<typeof record> => Boolean(record));
  return buildConvergenceSnapshot({ nodes, edges, evidenceRecords, bm25MemberIds: [], vectorMemberIds: [] });
}
