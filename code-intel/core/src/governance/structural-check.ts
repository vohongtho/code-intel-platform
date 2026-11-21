/**
 * Structural check: one evidence-bearing verdict over a change, composed from
 * existing analyzers. Read-only; usable whether or not rename apply is
 * supported for any language.
 *
 * Rules:
 * - `architecture/policy-invalid` — an explicit policy file exists but does not validate.
 * - `architecture/layer-violation` — an import crosses an explicitly forbidden
 *   layer boundary (explicit policy only; inferred layers never produce findings).
 * - `graph/new-import-cycle` — a file-level import cycle through a changed file
 *   that did not exist on the base side (pre-existing cycles are notes).
 * - `api/breaking-change` — API-contract drift between base and head
 *   (delegated verbatim to semantic/api-contracts).
 * - `risk/untested-change` — a changed HIGH-risk symbol with no known test.
 * - `refactor/verification-failed` — a failed post-apply rename verification.
 *
 * Every finding carries a stable id, rule, severity, location, evidence,
 * certainty, and whether the change introduced it. Absence of findings is never
 * proof of safety when `coverage.complete` is false.
 */
import crypto from 'node:crypto';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { AnalysisCoverage } from '../shared/index.js';
import type { ApiCompatibilityFinding } from '../semantic/api-contracts/types.js';
import { routeFactFromNode } from '../semantic/api-contracts/service.js';
import { computePRImpactWithPrecision } from '../query/pr-impact.js';
import { selectTestsForImpact } from '../query/test-selection.js';
import type { ChangedLineRange } from '../program-analysis/source-map.js';
import { detectArchitectureLayers, type LayerSuggestion } from '../analysis/architecture-layers.js';
import { layerOf, type ArchitecturePolicyLoad, type FindingSeverity } from './policy-schema.js';
import type { RenameVerification } from '../refactoring/verify.js';

export const STRUCTURAL_CHECK_SCHEMA_VERSION = 1;

export const STRUCTURAL_RULES = [
  { id: 'architecture/policy-invalid', name: 'ArchitecturePolicyInvalid', description: 'The explicit architecture policy file exists but is invalid' },
  { id: 'architecture/layer-violation', name: 'ArchitectureLayerViolation', description: 'Import crosses an explicitly forbidden layer boundary' },
  { id: 'graph/new-import-cycle', name: 'NewImportCycle', description: 'Change introduces a file-level import cycle' },
  { id: 'api/breaking-change', name: 'ApiBreakingChange', description: 'API contract change is breaking or potentially breaking for known consumers' },
  { id: 'risk/untested-change', name: 'UntestedHighRiskChange', description: 'High-risk changed symbol has no known relevant test' },
  { id: 'refactor/verification-failed', name: 'RefactorVerificationFailed', description: 'Post-apply rename verification did not pass' },
] as const;

export type StructuralRuleId = typeof STRUCTURAL_RULES[number]['id'];
export type FindingCertainty = 'exact' | 'candidate' | 'heuristic' | 'unknown';

export interface StructuralFinding {
  /** Stable across runs over the same inputs: hash of rule + location + subject. */
  id: string;
  ruleId: StructuralRuleId;
  severity: FindingSeverity;
  message: string;
  location: { filePath: string; startLine?: number };
  evidence: string[];
  certainty: FindingCertainty;
  /** true: introduced by the change; false: pre-existing; null: no base to tell. */
  introduced: boolean | null;
  hint: string;
}

export interface StructuralRuleStatus {
  id: StructuralRuleId;
  status: 'ran' | 'skipped';
  reason?: string;
}

export interface StructuralCheckInput {
  head: KnowledgeGraph;
  /** Base-side graph; enables new-vs-pre-existing distinctions. */
  base?: KnowledgeGraph | null;
  /** Repo-relative POSIX paths in scope for the check. */
  changedFiles: readonly string[];
  changedRanges?: readonly ChangedLineRange[];
  repoDir?: string;
  policy: ArchitecturePolicyLoad;
  /** Base→head API drift; omit when no base exists. */
  api?: { findings: readonly ApiCompatibilityFinding[]; consumerCoverageComplete: boolean } | null;
  renameVerification?: RenameVerification | null;
  /** Subset of rules to run; default all. */
  rules?: readonly StructuralRuleId[];
  maxFindings?: number;
  /** Caller-known coverage gaps (e.g. stale index) merged into `coverage.incompleteReasons`. */
  coverageNotes?: readonly string[];
}

export interface StructuralCheckResult {
  schemaVersion: typeof STRUCTURAL_CHECK_SCHEMA_VERSION;
  findings: StructuralFinding[];
  totalFindings: number;
  truncated: boolean;
  summary: Record<FindingSeverity, number>;
  rules: StructuralRuleStatus[];
  policy: { status: ArchitecturePolicyLoad['status']; path: string };
  /** Inferred layers: shown for guidance, never enforced. */
  advisory: { layers: LayerSuggestion[] };
  changedFiles: string[];
  coverage: AnalysisCoverage;
}

const SEVERITY_RANK: Record<FindingSeverity, number> = { error: 0, warning: 1, note: 2 };
const DEFAULT_MAX_FINDINGS = 500;
const MAX_CYCLE_EVIDENCE = 12;

export function severityAtLeast(severity: FindingSeverity, threshold: FindingSeverity): boolean {
  return SEVERITY_RANK[severity] <= SEVERITY_RANK[threshold];
}

function findingId(ruleId: string, filePath: string, subject: string): string {
  return crypto.createHash('sha256').update(`${ruleId}\u0000${filePath}\u0000${subject}`).digest('hex').slice(0, 20);
}

function finding(input: Omit<StructuralFinding, 'id'>, subject: string): StructuralFinding {
  return { id: findingId(input.ruleId, input.location.filePath, subject), ...input };
}

function capSeverity(severity: FindingSeverity, certainty: FindingCertainty): FindingSeverity {
  // Only exact evidence may block at error level.
  return severity === 'error' && certainty !== 'exact' ? 'warning' : severity;
}

function asCertainty(value: string | undefined): FindingCertainty {
  return value === 'exact' || value === 'candidate' || value === 'heuristic' ? value : 'unknown';
}

/** File→file import edges with their strongest certainty. */
function fileImports(graph: KnowledgeGraph): Map<string, Map<string, FindingCertainty>> {
  const rank: Record<FindingCertainty, number> = { exact: 0, candidate: 1, heuristic: 2, unknown: 3 };
  const out = new Map<string, Map<string, FindingCertainty>>();
  for (const edge of graph.findEdgesByKind('imports')) {
    const from = graph.getNode(edge.source)?.filePath;
    const to = graph.getNode(edge.target)?.filePath;
    if (!from || !to) continue;
    let targets = out.get(from);
    if (!targets) out.set(from, (targets = new Map()));
    const certainty = asCertainty(edge.certainty);
    const prior = targets.get(to);
    if (!prior || rank[certainty] < rank[prior]) targets.set(to, certainty);
  }
  return out;
}

/** Tarjan SCCs over the file import graph; returns only cyclic components, each sorted. */
export function importCycles(imports: Map<string, Map<string, FindingCertainty>>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  let counter = 0;
  const nodes = [...new Set([...imports.keys(), ...[...imports.values()].flatMap((m) => [...m.keys()])])].sort();

  for (const start of nodes) {
    if (index.has(start)) continue;
    // Iterative DFS to stay safe on deep import chains.
    const work: Array<{ node: string; edges: string[]; next: number }> = [];
    const push = (node: string) => {
      index.set(node, counter);
      low.set(node, counter);
      counter++;
      stack.push(node);
      onStack.add(node);
      work.push({ node, edges: [...(imports.get(node)?.keys() ?? [])].sort(), next: 0 });
    };
    push(start);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      if (frame.next < frame.edges.length) {
        const to = frame.edges[frame.next++];
        if (!index.has(to)) push(to);
        else if (onStack.has(to)) low.set(frame.node, Math.min(low.get(frame.node)!, index.get(to)!));
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!));
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        const selfLoop = component.length === 1 && imports.get(component[0])?.has(component[0]);
        if (component.length > 1 || selfLoop) out.push(component.sort());
      }
    }
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

function layerViolations(input: StructuralCheckInput, changed: ReadonlySet<string>, findings: StructuralFinding[]): void {
  if (input.policy.status !== 'loaded') return;
  const policy = input.policy.policy;
  const baseImports = input.base ? fileImports(input.base) : null;
  for (const [from, targets] of [...fileImports(input.head)].sort(([a], [b]) => a.localeCompare(b))) {
    if (!changed.has(from)) continue;
    const fromLayer = layerOf(policy, from);
    if (!fromLayer) continue;
    for (const [to, certainty] of [...targets].sort(([a], [b]) => a.localeCompare(b))) {
      const toLayer = layerOf(policy, to);
      if (!toLayer || toLayer === fromLayer) continue;
      const rule = policy.rules.find((r) => r.from === fromLayer && r.forbid.includes(toLayer));
      if (!rule) continue;
      const introduced = baseImports ? !baseImports.get(from)?.has(to) : null;
      const severity = introduced === false ? 'note' : capSeverity(rule.severity, certainty);
      findings.push(finding({
        ruleId: 'architecture/layer-violation',
        severity,
        message: `${from} (layer '${fromLayer}') imports ${to} (layer '${toLayer}'), which the policy forbids`,
        location: { filePath: from },
        evidence: [`${certainty} import ${from} → ${to}`, `policy ${input.policy.path}: ${fromLayer} forbids [${rule.forbid.join(', ')}]`],
        certainty,
        introduced,
        hint: introduced === false
          ? 'Pre-existing violation in a changed file; not introduced by this change.'
          : `Route the dependency through an allowed layer, or change the rule in ${input.policy.path}.`,
      }, `${from}\u0000${to}`));
    }
  }
}

function newCycles(input: StructuralCheckInput, changed: ReadonlySet<string>, findings: StructuralFinding[]): void {
  const headImports = fileImports(input.head);
  const baseComponent = new Map<string, number>();
  if (input.base) importCycles(fileImports(input.base)).forEach((component, i) => component.forEach((file) => baseComponent.set(file, i)));
  for (const component of importCycles(headImports)) {
    const touched = component.filter((file) => changed.has(file));
    if (touched.length === 0) continue;
    const first = baseComponent.get(component[0]);
    const preExisting = input.base ? component.every((file) => first !== undefined && baseComponent.get(file) === first) : null;
    const introduced = preExisting === null ? null : !preExisting;
    const exactOnly = component.every((file) => [...(headImports.get(file) ?? new Map<string, FindingCertainty>())]
      .filter(([to]) => component.includes(to)).every(([, c]) => c === 'exact'));
    const certainty: FindingCertainty = exactOnly ? 'exact' : 'heuristic';
    const shown = component.slice(0, MAX_CYCLE_EVIDENCE);
    findings.push(finding({
      ruleId: 'graph/new-import-cycle',
      severity: introduced ? 'warning' : 'note',
      message: introduced
        ? `import cycle of ${component.length} file(s) introduced through ${touched[0]}`
        : introduced === false
          ? `pre-existing import cycle of ${component.length} file(s) through changed file ${touched[0]}`
          : `import cycle of ${component.length} file(s) through changed file ${touched[0]} (no base to tell whether it is new)`,
      location: { filePath: touched[0] },
      evidence: [...shown.map((file) => `cycle member: ${file}`), ...(component.length > shown.length ? [`… ${component.length - shown.length} more`] : [])],
      certainty,
      introduced,
      hint: introduced ? 'Break the cycle by extracting the shared piece or inverting one dependency.' : 'Known cycle; consider it debt rather than a regression.',
    }, component.join('\u0000')));
  }
}

function apiFindings(input: StructuralCheckInput, findings: StructuralFinding[]): void {
  if (!input.api) return;
  const routeLocations = new Map<string, { filePath: string; startLine?: number }>();
  for (const graph of [input.head, input.base].filter((g): g is KnowledgeGraph => Boolean(g))) {
    for (const node of graph.allNodes()) {
      if (node.kind !== 'route') continue;
      const fact = routeFactFromNode(node);
      if (fact && !routeLocations.has(fact.factId)) routeLocations.set(fact.factId, { filePath: node.filePath, startLine: node.startLine });
    }
  }
  for (const api of input.api.findings) {
    if (api.verdict !== 'breaking' && api.verdict !== 'potentially-breaking') continue;
    const location = routeLocations.get(api.routeFactId) ?? { filePath: 'unknown' };
    const certainty: FindingCertainty = api.verdict === 'breaking' && api.boundaryReasons.length === 0 ? 'exact' : 'heuristic';
    findings.push(finding({
      ruleId: 'api/breaking-change',
      severity: api.verdict === 'breaking' ? capSeverity('error', certainty) : 'warning',
      message: `${api.rule}: ${api.reason}`,
      location,
      evidence: [
        `route ${api.routeFactId}`,
        ...(api.fieldKey ? [`field ${api.fieldKey}`] : []),
        `${api.affectedConsumerFactIds.length} known affected consumer(s)`,
        ...api.boundaryReasons.map((reason) => `boundary: ${reason}`),
      ],
      certainty,
      introduced: true,
      hint: 'Keep the old contract (versioned route or optional field), or update every consumer in the same change.',
    }, `${api.routeFactId}\u0000${api.rule}\u0000${api.fieldKey ?? ''}`));
  }
}

async function untestedChanges(input: StructuralCheckInput, findings: StructuralFinding[]): Promise<string[]> {
  if (input.changedFiles.length === 0) return [];
  const impact = await computePRImpactWithPrecision(input.head, [...input.changedFiles], 2, {
    repoDir: input.repoDir,
    precision: 'graph',
    ...(input.changedRanges ? { changedRanges: input.changedRanges } : {}),
  });
  const changed = new Set(input.changedFiles);
  const symbolsByName = new Map<string, Array<{ id: string; filePath: string; startLine?: number }>>();
  for (const node of input.head.allNodes()) {
    if (!changed.has(node.filePath)) continue;
    const list = symbolsByName.get(node.name) ?? [];
    list.push({ id: node.id, filePath: node.filePath, startLine: node.startLine });
    symbolsByName.set(node.name, list);
  }
  const reported = new Set<string>();
  for (const symbol of impact.changedSymbols) {
    if (symbol.risk !== 'HIGH' || symbol.testCoverage || reported.has(symbol.name)) continue;
    const nodes = (symbolsByName.get(symbol.name) ?? []).sort((a, b) => a.filePath.localeCompare(b.filePath) || (a.startLine ?? 0) - (b.startLine ?? 0));
    // The PR-impact test signal is import-based; also accept graph test-selection evidence.
    if (nodes.length > 0 && selectTestsForImpact(input.head, nodes.map((n) => n.id), { repoDir: input.repoDir }).evidence.some((e) => e.testId)) continue;
    reported.add(symbol.name);
    const location = nodes[0] ? { filePath: nodes[0].filePath, startLine: nodes[0].startLine } : { filePath: 'unknown' };
    findings.push(finding({
      ruleId: 'risk/untested-change',
      severity: 'warning',
      message: `${symbol.name} changed with ${symbol.callerCount} caller(s) and no known relevant test`,
      location,
      evidence: [`risk HIGH (${symbol.callerCount} callers)`, 'no test evidence in the index'],
      certainty: 'heuristic',
      introduced: null,
      hint: 'Add or point to a test that exercises this symbol; missing test evidence is not proof that none exists.',
    }, symbol.name));
  }
  return impact.coverage && !impact.coverage.complete ? impact.coverage.incompleteReasons.map((r) => `risk: ${r}`) : [];
}

function verificationFindings(input: StructuralCheckInput, findings: StructuralFinding[]): void {
  const verification = input.renameVerification;
  if (!verification || verification.verdict === 'verified') return;
  for (const check of verification.checks.filter((c) => !c.passed)) {
    findings.push(finding({
      ruleId: 'refactor/verification-failed',
      severity: 'error',
      message: `rename verification check '${check.id}' failed: ${check.detail}`,
      location: { filePath: check.filePath ?? 'unknown' },
      evidence: [`plan ${verification.planId}`, check.detail],
      certainty: 'exact',
      introduced: true,
      hint: 'Inspect the listed references; revert the rename (it was not committed) or fix them by hand, then re-run verification.',
    }, `${verification.planId}\u0000${check.id}`));
  }
}

export async function runStructuralCheck(input: StructuralCheckInput): Promise<StructuralCheckResult> {
  const enabled = new Set<StructuralRuleId>(input.rules ?? STRUCTURAL_RULES.map((r) => r.id));
  const changed = new Set(input.changedFiles);
  const findings: StructuralFinding[] = [];
  const rules: StructuralRuleStatus[] = [];
  const incomplete: string[] = [...(input.coverageNotes ?? [])];
  const skip = (id: StructuralRuleId, reason: string) => rules.push({ id, status: 'skipped', reason });
  const ran = (id: StructuralRuleId) => rules.push({ id, status: 'ran' });

  if (!enabled.has('architecture/policy-invalid')) skip('architecture/policy-invalid', 'not selected');
  else {
    ran('architecture/policy-invalid');
    if (input.policy.status === 'invalid') {
      for (const error of input.policy.errors) {
        findings.push(finding({
          ruleId: 'architecture/policy-invalid',
          severity: 'error',
          message: `${input.policy.path} ${error}`,
          location: { filePath: input.policy.path },
          evidence: [error],
          certainty: 'exact',
          introduced: null,
          hint: 'Fix the policy file; an invalid policy is never treated as "no policy".',
        }, error));
      }
    }
  }

  if (!enabled.has('architecture/layer-violation')) skip('architecture/layer-violation', 'not selected');
  else if (input.policy.status !== 'loaded') skip('architecture/layer-violation', input.policy.status === 'absent' ? `no explicit policy at ${input.policy.path}; inferred layers are advisory only` : 'policy is invalid');
  else {
    ran('architecture/layer-violation');
    layerViolations(input, changed, findings);
  }

  if (!enabled.has('graph/new-import-cycle')) skip('graph/new-import-cycle', 'not selected');
  else {
    ran('graph/new-import-cycle');
    if (!input.base) incomplete.push('no base graph: import cycles cannot be classified as new or pre-existing');
    newCycles(input, changed, findings);
  }

  if (!enabled.has('api/breaking-change')) skip('api/breaking-change', 'not selected');
  else if (!input.api) {
    skip('api/breaking-change', input.base ? 'API contract drift was not computed for this comparison' : 'no base graph to compare API contracts against');
    incomplete.push(input.base ? 'API contract drift not computed' : 'API contract drift not computed (no base)');
  } else {
    ran('api/breaking-change');
    if (!input.api.consumerCoverageComplete) incomplete.push('api-contract consumer coverage is incomplete');
    apiFindings(input, findings);
  }

  if (!enabled.has('risk/untested-change')) skip('risk/untested-change', 'not selected');
  else {
    ran('risk/untested-change');
    incomplete.push(...await untestedChanges(input, findings));
  }

  if (!enabled.has('refactor/verification-failed')) skip('refactor/verification-failed', 'not selected');
  else if (!input.renameVerification) skip('refactor/verification-failed', 'no rename verification in scope');
  else {
    ran('refactor/verification-failed');
    verificationFindings(input, findings);
  }

  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || a.ruleId.localeCompare(b.ruleId)
    || a.location.filePath.localeCompare(b.location.filePath)
    || (a.location.startLine ?? 0) - (b.location.startLine ?? 0)
    || a.id.localeCompare(b.id));
  const summary: Record<FindingSeverity, number> = { error: 0, warning: 0, note: 0 };
  for (const f of findings) summary[f.severity]++;
  const max = Math.max(1, input.maxFindings ?? DEFAULT_MAX_FINDINGS);
  const truncated = findings.length > max;
  if (truncated) incomplete.push(`findings truncated to ${max} of ${findings.length}`);

  return {
    schemaVersion: STRUCTURAL_CHECK_SCHEMA_VERSION,
    findings: findings.slice(0, max),
    totalFindings: findings.length,
    truncated,
    summary,
    rules: rules.sort((a, b) => a.id.localeCompare(b.id)),
    policy: { status: input.policy.status, path: input.policy.path },
    advisory: { layers: detectArchitectureLayers(input.head).suggestions },
    changedFiles: [...changed].sort(),
    coverage: { complete: incomplete.length === 0, examinedCount: changed.size, incompleteReasons: [...new Set(incomplete)].sort() },
  };
}
