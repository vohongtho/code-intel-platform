/**
 * Rename planning: resolve one canonical target, collect classified
 * occurrences, cross-check them against graph relationships, and fingerprint
 * everything apply will touch. Planning never writes.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { CodeEdge, CodeNode, EdgeKind } from '../shared/index.js';
import { detectLanguage } from '../shared/detection.js';
import { parseSymbolTarget, resolveSymbolTarget } from '../cli/symbol-target.js';
import { selectTestsForImpact } from '../query/test-selection.js';
import {
  RENAME_PLAN_SCHEMA_VERSION,
  getRefactoringCapability,
  type RenameBoundary,
  type RenameEdit,
  type RenameOccurrence,
  type RenamePlan,
  type RenameTarget,
  type SymbolSelectionResult,
} from './contracts.js';
import { collectExactRenameOccurrences, languageForPath } from './edit-spans.js';

const SYMBOL_KINDS = new Set([
  'function', 'class', 'interface', 'method', 'constructor', 'variable', 'property', 'struct', 'enum', 'trait',
  'namespace', 'module', 'type_alias', 'constant',
]);
/** Structural edges are containment/metadata, not source references that a rename must rewrite. */
const NON_REFERENCE_EDGES = new Set<EdgeKind>(['contains', 'has_member', 'belongs_to', 'step_of', 'tested_by', 'has_vulnerability']);
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const RESERVED: ReadonlySet<string> = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export',
  'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'implements',
  'interface', 'package', 'private', 'protected', 'public', 'await', 'any', 'boolean', 'number', 'string', 'symbol',
  'unknown', 'never', 'object', 'undefined', 'arguments', 'eval',
]);

/** A new name apply may write: an ASCII identifier that is not a reserved word. */
export function isValidRenameIdentifier(name: string): boolean {
  return IDENTIFIER.test(name) && !RESERVED.has(name);
}

function toTarget(node: CodeNode): RenameTarget {
  return { id: node.id, name: node.name, kind: node.kind, filePath: node.filePath, startLine: node.startLine, language: detectLanguage(node.filePath) };
}

/** Resolve a selector to exactly one canonical symbol; never guesses between same-name symbols. */
export function selectRenameTarget(graph: KnowledgeGraph, selector: string): SymbolSelectionResult {
  const direct = graph.getNode(selector);
  if (direct && SYMBOL_KINDS.has(direct.kind)) return { status: 'exact', target: toTarget(direct) };

  const qualified = parseSymbolTarget(selector);
  if (qualified) {
    const matches = [...graph.allNodes()].filter((node) => SYMBOL_KINDS.has(node.kind)
      && node.kind === qualified.kind && node.name === qualified.name && node.filePath === qualified.filePath
      && (qualified.startLine === undefined || node.startLine === qualified.startLine));
    if (matches.length === 1) return { status: 'exact', target: toTarget(matches[0]) };
    if (matches.length > 1) return { status: 'ambiguous', candidates: matches.map(toTarget).sort(compareTargets) };
    return { status: 'missing', candidates: [] };
  }

  const resolution = resolveSymbolTarget(graph, selector);
  if (resolution.status === 'found') {
    return SYMBOL_KINDS.has(resolution.node.kind) ? { status: 'exact', target: toTarget(resolution.node) } : { status: 'missing', candidates: [] };
  }
  if (resolution.status === 'ambiguous') {
    const candidates = resolution.candidates.filter((node) => SYMBOL_KINDS.has(node.kind)).map(toTarget);
    if (candidates.length === 1) return { status: 'exact', target: candidates[0] };
    if (candidates.length > 1) return { status: 'ambiguous', candidates: candidates.sort(compareTargets) };
  }
  return { status: 'missing', candidates: [] };
}

function compareTargets(a: RenameTarget, b: RenameTarget): number {
  return a.filePath.localeCompare(b.filePath) || (a.startLine ?? 0) - (b.startLine ?? 0) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id);
}

export interface BuildRenamePlanOptions {
  graph: KnowledgeGraph;
  workspaceRoot: string;
  selector: string;
  newName: string;
  /** Selected index identity (generation or snapshot id); part of the plan fingerprint. */
  indexIdentity?: string | null;
  maxFiles?: number;
}

export type RenamePlanResult =
  | { status: 'planned'; plan: RenamePlan }
  | { status: 'ambiguous'; candidates: RenameTarget[] }
  | { status: 'missing'; selector: string };

function referenceEdges(graph: KnowledgeGraph, targetId: string): CodeEdge[] {
  return [...graph.findEdgesTo(targetId)]
    .filter((edge) => !NON_REFERENCE_EDGES.has(edge.kind) && edge.source !== targetId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function readTsconfigHasPathAliases(workspaceRoot: string): boolean {
  const file = path.join(workspaceRoot, 'tsconfig.json');
  if (!fs.existsSync(file)) return false;
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1').replace(/,(\s*[}\]])/g, '$1');
    const options = (JSON.parse(text) as { compilerOptions?: { paths?: unknown; baseUrl?: unknown } }).compilerOptions ?? {};
    return Boolean(options.paths || options.baseUrl);
  } catch {
    return true; // unreadable config: assume bare specifiers might map into the workspace
  }
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function fileSha256(workspaceRoot: string, filePath: string): string {
  return sha256(fs.readFileSync(path.join(workspaceRoot, filePath), 'utf8'));
}

export async function buildRenamePlan(options: BuildRenamePlanOptions): Promise<RenamePlanResult> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const selection = selectRenameTarget(options.graph, options.selector);
  if (selection.status === 'ambiguous') return { status: 'ambiguous', candidates: selection.candidates };
  if (selection.status === 'missing') return { status: 'missing', selector: options.selector };
  const target = selection.target;
  const capability = getRefactoringCapability(target.language);
  const boundaries: RenameBoundary[] = [];
  let occurrences: RenameOccurrence[] = [];
  let editedFiles: string[] = [];
  let scannedFiles = 0;
  const incompleteReasons: string[] = [];

  if (!isValidRenameIdentifier(options.newName)) {
    boundaries.push({ kind: 'invalid-new-name', message: `${JSON.stringify(options.newName)} is not a valid, non-reserved identifier` });
  }
  if (options.newName === target.name) boundaries.push({ kind: 'invalid-new-name', message: 'new name equals the current name' });

  const edges = referenceEdges(options.graph, target.id);
  const sourceFile = (edge: CodeEdge) => options.graph.getNode(edge.source)?.filePath;

  const textCache = new Map<string, string>();
  const readFile = (filePath: string) => {
    let text = textCache.get(filePath);
    if (text === undefined) {
      text = fs.readFileSync(path.join(workspaceRoot, filePath), 'utf8');
      textCache.set(filePath, text);
    }
    return text;
  };

  if (capability.rename === 'apply' && languageForPath(target.filePath)) {
    const files = new Set([...options.graph.allNodes()].filter((node) => node.kind === 'file' && languageForPath(node.filePath)).map((node) => node.filePath));
    files.add(target.filePath);
    const existing = new Set([...files].filter((filePath) => fs.existsSync(path.join(workspaceRoot, filePath))));
    const result = await collectExactRenameOccurrences(
      { filePath: target.filePath, name: target.name, line: target.startLine },
      options.newName,
      { files: existing, readFile, hasPathAliases: readTsconfigHasPathAliases(workspaceRoot) },
      { maxFiles: options.maxFiles },
    );
    occurrences = result.occurrences;
    boundaries.push(...result.boundaries);
    editedFiles = result.editedFiles;
    scannedFiles = result.scannedFiles;

    if (result.moduleScope) {
      // Every exact graph reference must land in a file the adapter will edit.
      const located = new Set([...editedFiles, target.filePath]);
      for (const edge of edges) {
        const file = sourceFile(edge);
        if (!file || located.has(file)) continue;
        if (edge.certainty === 'exact') {
          boundaries.push({ kind: 'graph-reference-not-located', message: `the graph has an exact ${edge.kind} relationship from ${file}, but no exact span was found there`, filePath: file });
        } else {
          incompleteReasons.push(`${edge.certainty ?? 'unclassified'} ${edge.kind} relationship from ${file} has no exact span; not edited`);
        }
      }
    }
  } else {
    boundaries.push({
      kind: capability.rename === 'unsupported' ? 'unsupported-language' : 'preview-only-language',
      message: `${target.language ?? 'unknown'} rename is ${capability.rename}: ${capability.reason ?? ''}`.trim(),
      filePath: target.filePath,
    });
    const line = target.startLine ?? 1;
    occurrences.push({ category: 'unsupported', role: 'definition', filePath: target.filePath, range: { startLine: line, startColumn: 0, endLine: line, endColumn: 0 }, text: target.name, reason: 'preview only: no exact span' });
    for (const edge of edges) {
      const source = options.graph.getNode(edge.source);
      if (!source) continue;
      const at = source.startLine ?? 1;
      occurrences.push({ category: 'unsupported', role: 'reference', filePath: source.filePath, range: { startLine: at, startColumn: 0, endLine: source.endLine ?? at, endColumn: 0 }, text: `${edge.kind} from ${source.name}`, reason: `preview only: ${edge.certainty ?? 'unclassified'} graph ${edge.kind}; line is the enclosing symbol, not the reference` });
    }
    occurrences.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.range.startLine - b.range.startLine);
  }

  const edits: RenameEdit[] = occurrences
    .filter((o) => (o.category === 'exact-definition' || o.category === 'exact-semantic') && o.startOffset !== undefined && o.endOffset !== undefined)
    .map((o) => ({ filePath: o.filePath, startOffset: o.startOffset!, endOffset: o.endOffset!, oldText: o.text, newText: options.newName }));
  const fingerprintFiles = [...new Set(edits.map((edit) => edit.filePath))].sort().map((filePath) => ({ filePath, sha256: sha256(readFile(filePath)) }));
  const applicable = capability.rename === 'apply' && boundaries.length === 0 && edits.some((edit) => edit.filePath === target.filePath);

  const tests = selectTestsForImpact(options.graph, [target.id], { repoDir: workspaceRoot }).evidence
    .filter((evidence): evidence is typeof evidence & { testId: string } => Boolean(evidence.testId))
    .slice(0, 25)
    .map((evidence) => {
      const node = options.graph.getNode(evidence.testId);
      return { testId: evidence.testId, name: node?.name ?? evidence.testId, filePath: node?.filePath ?? evidence.filePath ?? '', kind: evidence.kind };
    });
  const referencingFiles = [...new Set(edges.map(sourceFile).filter((file): file is string => Boolean(file)))].sort();

  // The plan id covers what apply would write, not which index produced the plan, so a
  // reviewed dry-run id can be matched against an apply-time re-plan (`--expect-plan`).
  const planId = `rename:v1:${sha256(JSON.stringify({ target: target.id, newName: options.newName, files: fingerprintFiles, edits }))}`;
  if (scannedFiles === 0 && capability.rename === 'apply') incompleteReasons.push('no files were scanned');
  const plan: RenamePlan = {
    schemaVersion: RENAME_PLAN_SCHEMA_VERSION,
    planId,
    target,
    newName: options.newName,
    capability,
    applicable,
    edits,
    occurrences,
    boundaries,
    fingerprint: { indexIdentity: options.indexIdentity ?? null, files: fingerprintFiles },
    impact: { referencingFiles, inboundRelationships: edges.length, tests },
    expectedDelta: {
      definition: { filePath: target.filePath, kind: target.kind, oldName: target.name, newName: options.newName },
      referenceFiles: referencingFiles.filter((file) => file !== target.filePath && fingerprintFiles.some((f) => f.filePath === file)),
    },
    coverage: {
      complete: incompleteReasons.length === 0 && !boundaries.some((b) => b.kind === 'scan-limit'),
      examinedCount: scannedFiles,
      incompleteReasons: incompleteReasons.sort(),
    },
  };
  return { status: 'planned', plan };
}
