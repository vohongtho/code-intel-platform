/**
 * Post-apply rename verification. Re-runs the normal analyzer (scan →
 * structure → parse → resolve) into a fresh graph and compares it with the
 * pre-apply graph. Success is withheld unless:
 *
 * - the renamed definition exists exactly once and the old one is gone;
 * - every rewritten file that had an exact graph relationship to the old
 *   symbol has the same kind of exact relationship to the new one;
 * - re-resolving the new name in the rewritten source (same exact-span
 *   resolver that planned the edits) finds exactly the planned number of
 *   exact occurrences in each edited file and none elsewhere. The graph alone
 *   is not enough: TS/JS imports are recorded file→file, so a class or value
 *   reference can be lost without any symbol edge changing;
 * - (verifyAppliedRename) API contracts are not broken and the structural
 *   check reports no error-level finding for the edited files.
 *
 * Lost heuristic/candidate relationships are reported as warnings: they were
 * never proof of a reference.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { createKnowledgeGraph } from '../graph/knowledge-graph.js';
import type { CodeNode, EdgeKind } from '../shared/index.js';
import { runPipeline } from '../pipeline/orchestrator.js';
import { parsePhase, resolvePhase, scanPhase, structurePhase } from '../pipeline/phases/index.js';
import { selectTestsForImpact } from '../query/test-selection.js';
import { runWithEvidenceDb } from '../evidence/store.js';
import type { RenamePlan } from './contracts.js';
import { collectExactRenameOccurrences, languageForPath } from './edit-spans.js';

export type RenameVerificationCheckId =
  | 'new-definition'
  | 'old-definition-removed'
  | 'references-resolve'
  | 'source-references-resolve'
  | 'api-compatible'
  | 'structural-check';

export interface RenameVerificationCheck {
  id: RenameVerificationCheckId;
  passed: boolean;
  detail: string;
  filePath?: string;
}

export interface RenameVerification {
  verdict: 'verified' | 'failed';
  planId: string;
  newTargetId: string | null;
  checks: RenameVerificationCheck[];
  warnings: string[];
  graphDelta: { nodesBefore: number; nodesAfter: number; edgesBefore: number; edgesAfter: number };
  tests: Array<{ testId: string; kind: string }>;
}

const NON_REFERENCE_EDGES = new Set<EdgeKind>(['contains', 'has_member', 'belongs_to', 'step_of', 'tested_by', 'has_vulnerability']);
const PROBE_NAME = '__codeIntelVerifyProbe__';

/**
 * Analyze a workspace into a new in-memory graph with the standard phases;
 * never touches the persisted index. The resolve phase records relationship
 * evidence, which by default goes to the published generation's evidence.db,
 * so it is redirected to a throwaway in-memory store for this run.
 */
export async function analyzeWorkspaceInMemory(workspaceRoot: string): Promise<KnowledgeGraph> {
  const graph = createKnowledgeGraph();
  const result = await runWithEvidenceDb(null, () => runPipeline([scanPhase, structurePhase, parsePhase, resolvePhase], { workspaceRoot, graph, filePaths: [] }));
  if (!result.success) throw new Error('re-analysis failed; rename cannot be verified');
  return graph;
}

function definitions(graph: KnowledgeGraph, name: string, kind: string, filePath: string): CodeNode[] {
  return [...graph.allNodes()].filter((node) => node.name === name && node.kind === kind && node.filePath === filePath);
}

/** Reference-edge kinds into `targetId`, grouped by source file. */
function referenceKindsByFile(graph: KnowledgeGraph, targetId: string, exact: boolean): Map<string, Set<EdgeKind>> {
  const byFile = new Map<string, Set<EdgeKind>>();
  for (const edge of graph.findEdgesTo(targetId)) {
    if (NON_REFERENCE_EDGES.has(edge.kind) || edge.source === targetId) continue;
    if ((edge.certainty === 'exact') !== exact) continue;
    const file = graph.getNode(edge.source)?.filePath;
    if (!file) continue;
    let kinds = byFile.get(file);
    if (!kinds) byFile.set(file, (kinds = new Set()));
    kinds.add(edge.kind);
  }
  return byFile;
}

/**
 * Re-resolve the new name in the rewritten source and compare per-file exact
 * occurrence counts with the plan's edits.
 */
export async function checkSourceReferences(plan: RenamePlan, workspaceRoot: string, after: KnowledgeGraph): Promise<RenameVerificationCheck> {
  const root = path.resolve(workspaceRoot);
  const files = new Set([...after.allNodes()].filter((n) => n.kind === 'file' && languageForPath(n.filePath)).map((n) => n.filePath));
  files.add(plan.target.filePath);
  for (const f of plan.fingerprint.files) files.add(f.filePath);
  const existing = new Set([...files].filter((f) => fs.existsSync(path.join(root, f))));
  const result = await collectExactRenameOccurrences(
    { filePath: plan.target.filePath, name: plan.newName, line: plan.target.startLine },
    PROBE_NAME,
    { files: existing, readFile: (f) => fs.readFileSync(path.join(root, f), 'utf8'), hasPathAliases: false },
  );
  if (!result.moduleScope) {
    return { id: 'source-references-resolve', passed: false, detail: `${plan.newName} is not a module-scope declaration in ${plan.target.filePath}`, filePath: plan.target.filePath };
  }
  const expected = new Map<string, number>();
  for (const edit of plan.edits) expected.set(edit.filePath, (expected.get(edit.filePath) ?? 0) + 1);
  const actual = new Map<string, number>();
  for (const o of result.occurrences) {
    if (o.category !== 'exact-definition' && o.category !== 'exact-semantic') continue;
    actual.set(o.filePath, (actual.get(o.filePath) ?? 0) + 1);
  }
  const mismatches: Array<{ filePath: string; expected: number; actual: number }> = [];
  for (const filePath of [...new Set([...expected.keys(), ...actual.keys()])].sort()) {
    const e = expected.get(filePath) ?? 0;
    const a = actual.get(filePath) ?? 0;
    if (e !== a) mismatches.push({ filePath, expected: e, actual: a });
  }
  return mismatches.length === 0
    ? { id: 'source-references-resolve', passed: true, detail: `${plan.edits.length} exact occurrence(s) of ${plan.newName} resolve to the renamed declaration in ${expected.size} file(s)` }
    : {
        id: 'source-references-resolve',
        passed: false,
        detail: `exact occurrences of ${plan.newName} differ from the plan: ${mismatches.map((m) => `${m.filePath} expected ${m.expected}, found ${m.actual}`).join('; ')}`,
        filePath: mismatches[0].filePath,
      };
}

export function verifyRenameResult(
  plan: RenamePlan,
  before: KnowledgeGraph,
  after: KnowledgeGraph,
  extraChecks: readonly RenameVerificationCheck[] = [],
): RenameVerification {
  const { definition } = plan.expectedDelta;
  const checks: RenameVerificationCheck[] = [];

  const renamed = definitions(after, definition.newName, definition.kind, definition.filePath);
  checks.push({
    id: 'new-definition',
    passed: renamed.length === 1,
    detail: `${renamed.length} ${definition.kind} named ${definition.newName} in ${definition.filePath} (expected 1)`,
    filePath: definition.filePath,
  });

  const oldBefore = definitions(before, definition.oldName, definition.kind, definition.filePath).length;
  const oldAfter = definitions(after, definition.oldName, definition.kind, definition.filePath).length;
  checks.push({
    id: 'old-definition-removed',
    passed: oldAfter === oldBefore - 1,
    detail: `${definition.oldName} definitions in ${definition.filePath}: ${oldBefore} → ${oldAfter}`,
    filePath: definition.filePath,
  });

  const newTarget = renamed.length === 1 ? renamed[0] : null;
  const edited = new Set(plan.fingerprint.files.map((f) => f.filePath));
  const lostBetween = (from: Map<string, Set<EdgeKind>>, to: Map<string, Set<EdgeKind>>) => {
    const lost: Array<{ file: string; kind: EdgeKind }> = [];
    for (const [file, kinds] of [...from].sort(([a], [b]) => a.localeCompare(b))) {
      if (!edited.has(file)) continue; // only references the plan rewrote are expected to follow the rename
      for (const kind of [...kinds].sort()) if (!to.get(file)?.has(kind)) lost.push({ file, kind });
    }
    return lost;
  };
  const none = new Map<string, Set<EdgeKind>>();
  const expected = referenceKindsByFile(before, plan.target.id, true);
  const lost = lostBetween(expected, newTarget ? referenceKindsByFile(after, newTarget.id, true) : none);
  const lostWeak = lostBetween(referenceKindsByFile(before, plan.target.id, false), newTarget ? referenceKindsByFile(after, newTarget.id, false) : none);
  const warnings = lostWeak.map((entry) => `non-exact relationship not re-derived after rename: ${entry.file} (${entry.kind})`);
  checks.push({
    id: 'references-resolve',
    passed: newTarget !== null && lost.length === 0,
    detail: lost.length === 0
      ? `${[...expected.keys()].filter((f) => edited.has(f)).length} file(s) with exact graph relationships resolve to ${definition.newName}`
      : `references no longer resolve to ${definition.newName}: ${lost.map((l) => `${l.file} (${l.kind})`).join(', ')}`,
    ...(lost[0] ? { filePath: lost[0].file } : {}),
  });
  checks.push(...extraChecks);

  const tests = newTarget
    ? selectTestsForImpact(after, [newTarget.id]).evidence.filter((e) => e.testId).slice(0, 25).map((e) => ({ testId: e.testId!, kind: e.kind }))
    : [];
  return {
    verdict: checks.every((check) => check.passed) ? 'verified' : 'failed',
    planId: plan.planId,
    newTargetId: newTarget?.id ?? null,
    checks,
    warnings,
    graphDelta: { nodesBefore: before.size.nodes, nodesAfter: after.size.nodes, edgesBefore: before.size.edges, edgesAfter: after.size.edges },
    tests,
  };
}

export interface VerifyAppliedRenameOptions {
  plan: RenamePlan;
  workspaceRoot: string;
  before: KnowledgeGraph;
  /** Defaults to a fresh in-memory analysis of the workspace. */
  after?: KnowledgeGraph;
}

/**
 * Full post-apply verification: graph checks, source re-resolution, API
 * compatibility between the pre/post graphs, and the structural check over
 * the edited files with the pre-apply graph as base.
 */
export async function verifyAppliedRename(options: VerifyAppliedRenameOptions): Promise<RenameVerification> {
  const { plan, workspaceRoot, before } = options;
  const after = options.after ?? await analyzeWorkspaceInMemory(workspaceRoot);
  const extra: RenameVerificationCheck[] = [await checkSourceReferences(plan, workspaceRoot, after)];

  const { getApiDrift } = await import('../semantic/api-contracts/service.js');
  const drift = getApiDrift(before, after);
  const breaking = drift.findings.filter((f) => f.verdict === 'breaking');
  extra.push({
    id: 'api-compatible',
    passed: breaking.length === 0,
    detail: breaking.length === 0
      ? `no breaking API-contract change (${drift.findings.length} finding(s) total)`
      : `breaking API-contract change(s): ${breaking.map((f) => `${f.rule} ${f.routeFactId}`).join(', ')}`,
  });

  const { runStructuralCheck } = await import('../governance/structural-check.js');
  const { loadArchitecturePolicy } = await import('../governance/policy-schema.js');
  const structural = await runStructuralCheck({
    head: after,
    base: before,
    changedFiles: plan.fingerprint.files.map((f) => f.filePath),
    repoDir: workspaceRoot,
    policy: loadArchitecturePolicy(workspaceRoot),
    api: null,
    // Risk/test evidence is advisory for a rename; API drift was checked above.
    rules: ['architecture/policy-invalid', 'architecture/layer-violation', 'graph/new-import-cycle'],
  });
  const errors = structural.findings.filter((f) => f.severity === 'error');
  extra.push({
    id: 'structural-check',
    passed: errors.length === 0,
    detail: errors.length === 0
      ? `no error-level structural finding in ${structural.changedFiles.length} edited file(s)`
      : errors.map((f) => `${f.ruleId}: ${f.message}`).join('; '),
    ...(errors[0] ? { filePath: errors[0].location.filePath } : {}),
  });

  const verification = verifyRenameResult(plan, before, after, extra);
  verification.warnings.push(...structural.findings.filter((f) => f.severity !== 'error').map((f) => `${f.ruleId}: ${f.message}`));
  return verification;
}
