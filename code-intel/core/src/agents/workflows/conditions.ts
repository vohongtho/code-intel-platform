/**
 * conditions.ts
 *
 * Pure, deterministic evaluation of expected semantic conditions against an
 * observed baseline-vs-current delta for one repository.
 *
 * Invariant (spec: "Unknown evidence cannot satisfy a planned condition"):
 * a condition is only ever `satisfied` when the evidence it needs is
 * available *and* complete. Missing capabilities produce `blocked`;
 * incomplete/ambiguous evidence produces `unknown` or `partially-satisfied`;
 * neither is ever upgraded to `satisfied`.
 */

import crypto from 'node:crypto';
import type { AnalysisCoverage } from '../../shared/index.js';
import type { ApiCompatibilityFinding } from '../../semantic/api-contracts/types.js';
import type { EntityDelta, FlowDiffSection, RelationshipDelta } from '../../snapshots/types.js';
import type { NormalizedFlow, NormalizedNode } from '../../snapshots/normalizer.js';
import type { TestEvidenceKind, TestSelectionResult } from '../../query/test-selection.js';
import type {
  ConditionEvaluation,
  ConditionStatus,
  ExpectedSemanticCondition,
  ExpectedSemanticConditionInput,
  UnexpectedChange,
  WorkflowTargetRef,
} from './session-types.js';

/** Head-side relationship facts keyed by `source::kind::target` (call sites collapsed). */
export interface RelationshipFacts {
  certainties: ReadonlyMap<string, ReadonlyArray<string | undefined>>;
}

export interface ContractObservation {
  findings: readonly ApiCompatibilityFinding[];
  consumerCoverageComplete: boolean;
}

export type ConsumerUpdateState = 'updated' | 'unchanged' | 'unknown';

export interface ConsumerObservation {
  /** consumerId -> observed state, for consumers located in this repository. */
  states: ReadonlyMap<string, ConsumerUpdateState>;
  coverageComplete: boolean;
}

export interface SecurityObservation {
  baseKeys: readonly string[];
  headKeys: readonly string[];
  /** finding key -> node ID (empty string when unmapped). */
  nodeIdsByKey: ReadonlyMap<string, string>;
}

/**
 * Everything the evaluator may look at for one repository. Optional
 * sections are `undefined` when the capability is unavailable — that is
 * distinct from "available and empty".
 */
export interface RepositoryObservation {
  repositoryId: string;
  /** False when the repository could not be compared at all (stale, diverged, incompatible...). */
  available: boolean;
  unavailableReason?: string;
  nodes: readonly EntityDelta[];
  baseNodes: ReadonlyMap<string, NormalizedNode>;
  headNodeIds: ReadonlySet<string>;
  relationships: readonly RelationshipDelta[];
  headRelationships: RelationshipFacts;
  contracts?: ContractObservation;
  consumers?: ConsumerObservation;
  flows: FlowDiffSection;
  baseFlows: ReadonlyMap<string, NormalizedFlow>;
  headFlows: ReadonlyMap<string, NormalizedFlow>;
  /** node ID -> test selection over the current graph. */
  tests?: ReadonlyMap<string, TestSelectionResult>;
  cycles?: { base: readonly string[]; head: readonly string[] };
  security?: SecurityObservation;
  /** canonical identity aliases (node ID <-> identityId) on either side. */
  aliases: ReadonlyMap<string, string>;
  coverage: AnalysisCoverage;
}

const POSITION_ONLY = new Set(['startLine', 'endLine']);
const TEST_RANK: Record<TestEvidenceKind, number> = { direct: 0, 'affected-flow': 1, transitive: 2, candidate: 3, unknown: 4 };

export function conditionId(condition: ExpectedSemanticConditionInput): string {
  const { description: _description, ...identity } = condition;
  const canonical = JSON.stringify(identity, Object.keys(identity).sort());
  return `cond-${crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16)}`;
}

export function relationshipTripleKey(sourceId: string, edgeKind: string, targetId: string): string {
  return `${sourceId}::${edgeKind}::${targetId}`;
}

export function isPositionOnlyDelta(delta: EntityDelta): boolean {
  return delta.kind === 'changed'
    && (delta.changedProperties?.length ?? 0) > 0
    && delta.changedProperties!.every((prop) => POSITION_ONLY.has(prop));
}

function result(condition: ExpectedSemanticCondition, status: ConditionStatus, reason: string, evidenceRefs: string[] = []): ConditionEvaluation {
  return {
    conditionId: condition.id,
    kind: condition.kind,
    repositoryId: condition.repositoryId,
    status,
    reason,
    evidenceRefs: [...new Set(evidenceRefs)].sort(),
  };
}

function deltaRef(delta: EntityDelta): string {
  return `node:${delta.kind}:${delta.baseId ?? ''}->${delta.headId ?? ''}`;
}

function deltaForBase(obs: RepositoryObservation, nodeId: string): EntityDelta | undefined {
  return obs.nodes.find((delta) => delta.baseId === nodeId);
}

/**
 * Added declarations with the same kind, display name and file as a removed
 * one. This is *not* continuity evidence (names never prove identity); it is
 * only used to explain a partial result and to avoid double-reporting the
 * replacement as an unplanned change.
 */
export function replacementCandidates(obs: Pick<RepositoryObservation, 'nodes'>, removed: EntityDelta): EntityDelta[] {
  if (removed.kind !== 'removed' || !removed.baseName) return [];
  return obs.nodes.filter((delta) => delta.kind === 'added'
    && delta.nodeKind === removed.nodeKind
    && delta.headName === removed.baseName
    && delta.headFilePath === removed.baseFilePath);
}

function evaluateNodeExists(c: Extract<ExpectedSemanticCondition, { kind: 'node-exists' }>, obs: RepositoryObservation): ConditionEvaluation {
  if (obs.headNodeIds.has(c.nodeId)) {
    const added = obs.nodes.find((delta) => delta.headId === c.nodeId);
    return result(c, 'satisfied', added ? `node was ${added.kind}` : 'node exists in the current index', added ? [deltaRef(added)] : [`node:${c.nodeId}`]);
  }
  const delta = deltaForBase(obs, c.nodeId);
  if (delta && (delta.kind === 'renamed' || delta.kind === 'moved')) {
    return result(c, 'unexpected-change', `node identity changed (${delta.kind}) instead of being kept`, [deltaRef(delta)]);
  }
  if (obs.baseNodes.has(c.nodeId)) return result(c, 'unexpected-change', 'node existed at baseline and is now absent', delta ? [deltaRef(delta)] : []);
  return result(c, 'not-observed', 'node is not present in the current index');
}

function evaluateNodeAbsent(c: Extract<ExpectedSemanticCondition, { kind: 'node-absent' }>, obs: RepositoryObservation): ConditionEvaluation {
  if (obs.headNodeIds.has(c.nodeId)) return result(c, 'not-observed', 'node still exists in the current index');
  const delta = deltaForBase(obs, c.nodeId);
  if (delta && (delta.kind === 'renamed' || delta.kind === 'moved')) {
    return result(c, 'partially-satisfied', `original identity is gone but the declaration continues (${delta.kind})`, [deltaRef(delta)]);
  }
  if (delta?.continuity?.certainty === 'candidate') {
    return result(c, 'unknown', 'node was removed but may have been renamed/moved (ambiguous continuity)', [deltaRef(delta)]);
  }
  return result(c, 'satisfied', obs.baseNodes.has(c.nodeId) ? 'node was removed' : 'node is absent', delta ? [deltaRef(delta)] : []);
}

function evaluateNodeModified(c: Extract<ExpectedSemanticCondition, { kind: 'node-modified' }>, obs: RepositoryObservation): ConditionEvaluation {
  const delta = deltaForBase(obs, c.nodeId);
  if (delta) {
    if (delta.kind === 'renamed' || delta.kind === 'moved') return result(c, 'satisfied', `node was ${delta.kind}`, [deltaRef(delta)]);
    if (delta.kind === 'changed' && !isPositionOnlyDelta(delta)) return result(c, 'satisfied', `node changed (${(delta.changedProperties ?? []).join(', ')})`, [deltaRef(delta)]);
    if (delta.kind === 'removed') {
      if (delta.continuity?.certainty === 'candidate') return result(c, 'unknown', 'node was removed with ambiguous rename/move continuity', [deltaRef(delta)]);
      const replacements = replacementCandidates(obs, delta);
      if (replacements.length === 1) {
        return result(
          c,
          'partially-satisfied',
          `declaration was replaced under a new canonical identity ${replacements[0]!.headId} (e.g. a signature change); continuity is not proven — restate the step as node-absent/node-exists if intended`,
          [deltaRef(delta), deltaRef(replacements[0]!)],
        );
      }
      if (replacements.length > 1) return result(c, 'unknown', `node was removed and ${replacements.length} same-named declarations were added`, [deltaRef(delta), ...replacements.map(deltaRef)]);
      return result(c, 'unexpected-change', 'node was removed instead of modified', [deltaRef(delta)]);
    }
    if (delta.kind === 'unknown') return result(c, 'unknown', 'node change could not be classified', [deltaRef(delta)]);
  }
  const base = obs.baseNodes.get(c.nodeId);
  if (!base) return result(c, 'not-observed', 'node did not exist at baseline');
  if (!base.properties.contentFingerprint) {
    return result(c, 'unknown', 'baseline has no content fingerprint for this node, so body changes are not observable');
  }
  return result(c, 'not-observed', delta ? 'only the node position changed' : 'node is unchanged');
}

function evaluateIdentityChange(c: Extract<ExpectedSemanticCondition, { kind: 'identity-change' }>, obs: RepositoryObservation): ConditionEvaluation {
  const delta = deltaForBase(obs, c.nodeId);
  if (!delta) {
    return obs.headNodeIds.has(c.nodeId)
      ? result(c, 'not-observed', 'node identity is unchanged')
      : result(c, 'not-observed', 'node is not present at baseline or current index');
  }
  if ((delta.kind === 'renamed' || delta.kind === 'moved') && delta.continuity?.certainty === 'proven') {
    const kindMatches = c.change === 'renamed-or-moved' || c.change === delta.kind;
    const headMatches = !c.expectedHeadId || c.expectedHeadId === delta.headId;
    if (kindMatches && headMatches) return result(c, 'satisfied', `proven ${delta.kind} to ${delta.headId}`, [deltaRef(delta)]);
    return result(c, 'partially-satisfied', `node was ${delta.kind} to ${delta.headId}, which differs from the expected change`, [deltaRef(delta)]);
  }
  if (delta.kind === 'removed' && (delta.continuityCandidates?.length ?? 0) > 0) {
    return result(c, 'unknown', `removed with ${delta.continuityCandidates!.length} ambiguous continuation candidate(s)`, [deltaRef(delta), ...delta.continuityCandidates!.map((id) => `node:${id}`)]);
  }
  if (delta.kind === 'removed') return result(c, 'unexpected-change', 'node was removed without a proven rename/move', [deltaRef(delta)]);
  if (delta.kind === 'unknown') return result(c, 'unknown', 'node change could not be classified', [deltaRef(delta)]);
  return result(c, 'not-observed', 'node changed in place without an identity change', [deltaRef(delta)]);
}

function evaluateRelationship(c: Extract<ExpectedSemanticCondition, { kind: 'relationship-exists' | 'relationship-absent' }>, obs: RepositoryObservation): ConditionEvaluation {
  const key = relationshipTripleKey(c.sourceId, c.edgeKind, c.targetId);
  const certainties = obs.headRelationships.certainties.get(key) ?? [];
  const ref = `rel:${key}`;
  if (c.kind === 'relationship-absent') {
    return certainties.length === 0
      ? result(c, 'satisfied', 'relationship is absent from the current index', [ref])
      : result(c, 'not-observed', 'relationship still exists', [ref]);
  }
  if (certainties.length === 0) return result(c, 'not-observed', 'relationship does not exist in the current index', [ref]);
  if (certainties.some((certainty) => certainty === undefined || certainty === 'exact')) {
    return result(c, 'satisfied', 'relationship exists with exact evidence', [ref]);
  }
  return result(c, 'partially-satisfied', `relationship exists only with ${[...new Set(certainties)].join('/')} evidence`, [ref]);
}

function contractFindingsFor(obs: RepositoryObservation, contractId: string): ApiCompatibilityFinding[] {
  return (obs.contracts?.findings ?? []).filter((finding) => finding.routeFactId === contractId);
}

function evaluateContract(c: Extract<ExpectedSemanticCondition, { kind: 'contract-compatible' | 'contract-expected-breaking' }>, obs: RepositoryObservation): ConditionEvaluation {
  if (!obs.contracts) return result(c, 'blocked', 'API-contract evidence is unavailable for this repository');
  const findings = contractFindingsFor(obs, c.contractId);
  const refs = findings.map((finding) => `contract:${finding.routeFactId}:${finding.rule}${finding.fieldKey ? `:${finding.fieldKey}` : ''}`);
  const breaking = findings.filter((finding) => finding.verdict === 'breaking');
  const potentially = findings.filter((finding) => finding.verdict === 'potentially-breaking');
  const unknown = findings.filter((finding) => finding.verdict === 'unknown');
  const complete = obs.contracts.consumerCoverageComplete;

  if (c.kind === 'contract-compatible') {
    if (breaking.length > 0 || potentially.length > 0) {
      return result(c, 'unexpected-change', `${breaking.length} breaking / ${potentially.length} potentially-breaking finding(s)`, refs);
    }
    if (unknown.length > 0) return result(c, 'unknown', 'compatibility verdict is unknown for at least one change', refs);
    if (!complete) return result(c, 'unknown', 'consumer coverage is incomplete; compatibility cannot be confirmed', refs);
    return result(c, 'satisfied', findings.length > 0 ? 'only compatible contract changes' : 'no contract change', refs);
  }
  if (breaking.length > 0) {
    return complete
      ? result(c, 'satisfied', `${breaking.length} intentional breaking change(s) observed`, refs)
      : result(c, 'partially-satisfied', 'breaking change observed but affected-consumer coverage is incomplete', refs);
  }
  if (potentially.length > 0) return result(c, 'partially-satisfied', 'only potentially-breaking changes observed', refs);
  if (unknown.length > 0 || !complete) return result(c, 'unknown', 'contract change could not be classified with complete coverage', refs);
  return result(c, 'not-observed', 'no breaking contract change observed', refs);
}

function evaluateConsumerUpdated(c: Extract<ExpectedSemanticCondition, { kind: 'consumer-updated' }>, obs: RepositoryObservation): ConditionEvaluation {
  if (!obs.consumers) return result(c, 'blocked', 'cross-repository consumer evidence is unavailable');
  const states = c.consumerIds.map((id) => [id, obs.consumers!.states.get(id) ?? 'unknown'] as const);
  const refs = states.map(([id, state]) => `consumer:${id}:${state}`);
  if (c.consumerIds.length === 0) return result(c, 'unknown', 'no known consumer IDs were planned for this contract', refs);
  if (states.some(([, state]) => state === 'unknown')) return result(c, 'unknown', 'at least one consumer could not be analyzed', refs);
  const updated = states.filter(([, state]) => state === 'updated').length;
  if (!obs.consumers.coverageComplete) {
    return updated > 0
      ? result(c, 'partially-satisfied', `${updated}/${states.length} known consumer(s) updated, but consumer coverage is partial`, refs)
      : result(c, 'unknown', 'consumer coverage is partial', refs);
  }
  if (updated === states.length) return result(c, 'satisfied', `all ${updated} known consumer(s) updated`, refs);
  if (updated > 0) return result(c, 'partially-satisfied', `${updated}/${states.length} known consumer(s) updated`, refs);
  return result(c, 'not-observed', 'no known consumer was updated', refs);
}

function evaluateFlow(c: Extract<ExpectedSemanticCondition, { kind: 'flow-preserved' | 'flow-changed' }>, obs: RepositoryObservation): ConditionEvaluation {
  if (!obs.flows.supported) return result(c, 'blocked', `stable flow verification unavailable: ${obs.flows.reason}`);
  const ref = `flow:${c.flowId}`;
  const present = obs.headFlows.has(c.flowId);
  const existed = obs.baseFlows.has(c.flowId);
  if (c.kind === 'flow-preserved') {
    if (present) return result(c, 'satisfied', 'flow identity is unchanged', [ref]);
    return existed
      ? result(c, 'unexpected-change', 'flow path/membership changed or the flow disappeared', [ref])
      : result(c, 'not-observed', 'flow did not exist at baseline', [ref]);
  }
  if (!existed) return result(c, 'not-observed', 'flow did not exist at baseline', [ref]);
  return present
    ? result(c, 'not-observed', 'flow identity is unchanged', [ref])
    : result(c, 'satisfied', 'flow path/membership changed', [ref]);
}

function evaluateTests(c: Extract<ExpectedSemanticCondition, { kind: 'test-evidence-present' }>, obs: RepositoryObservation): ConditionEvaluation {
  if (!obs.tests) return result(c, 'blocked', 'test intelligence is unavailable');
  const selection = obs.tests.get(c.nodeId);
  if (!selection) return result(c, 'unknown', 'no test selection was computed for this node');
  const minimum = TEST_RANK[c.minimumKind ?? 'transitive'];
  const refs = selection.evidence.map((evidence) => `test:${evidence.kind}:${evidence.testId ?? evidence.filePath ?? '?'}`);
  const best = selection.evidence.reduce<TestEvidenceKind | undefined>(
    (acc, evidence) => (acc === undefined || TEST_RANK[evidence.kind] < TEST_RANK[acc] ? evidence.kind : acc),
    undefined,
  );
  if (best !== undefined && TEST_RANK[best] <= minimum) return result(c, 'satisfied', `${best} test evidence present`, refs);
  if (best === 'candidate' || (best !== undefined && TEST_RANK[best] <= TEST_RANK.transitive)) {
    return result(c, 'partially-satisfied', `only ${best} test evidence present`, refs);
  }
  if (selection.missingTestFinding?.definitive) return result(c, 'not-observed', selection.missingTestFinding.reason, refs);
  return result(c, 'unknown', selection.missingTestFinding?.reason ?? 'test coverage is incomplete', refs);
}

function evaluateStructural(c: Extract<ExpectedSemanticCondition, { kind: 'structural-rule-no-new-violation' }>, obs: RepositoryObservation): ConditionEvaluation {
  if (!obs.cycles) return result(c, 'blocked', 'structural analysis is unavailable');
  const base = new Set(obs.cycles.base);
  const added = obs.cycles.head.filter((key) => !base.has(key));
  return added.length > 0
    ? result(c, 'unexpected-change', `${added.length} new import cycle(s)`, added.map((key) => `cycle:${key}`))
    : result(c, 'satisfied', 'no new import cycles');
}

function evaluateSecurity(c: Extract<ExpectedSemanticCondition, { kind: 'security-no-new-finding' }>, obs: RepositoryObservation): ConditionEvaluation {
  if (!obs.security) return result(c, 'blocked', 'security review capability is unavailable');
  const base = new Set(obs.security.baseKeys);
  const scope = new Set(c.nodeIds);
  const added = obs.security.headKeys.filter((key) => !base.has(key)
    && (scope.size === 0 || scope.has(obs.security!.nodeIdsByKey.get(key) ?? '')));
  return added.length > 0
    ? result(c, 'unexpected-change', `${added.length} new heuristic security finding(s)`, added.map((key) => `security:${key.replaceAll('\u0000', ':')}`))
    : result(c, 'satisfied', 'no new findings from the heuristic security scanner');
}

export function evaluateCondition(condition: ExpectedSemanticCondition, obs: RepositoryObservation | undefined): ConditionEvaluation {
  if (!obs) return result(condition, 'blocked', 'repository was not observed during verification');
  if (!obs.available) return result(condition, 'blocked', obs.unavailableReason ?? 'repository could not be compared');
  switch (condition.kind) {
    case 'node-exists': return evaluateNodeExists(condition, obs);
    case 'node-absent': return evaluateNodeAbsent(condition, obs);
    case 'node-modified': return evaluateNodeModified(condition, obs);
    case 'identity-change': return evaluateIdentityChange(condition, obs);
    case 'relationship-exists':
    case 'relationship-absent': return evaluateRelationship(condition, obs);
    case 'contract-compatible':
    case 'contract-expected-breaking': return evaluateContract(condition, obs);
    case 'consumer-updated': return evaluateConsumerUpdated(condition, obs);
    case 'flow-preserved':
    case 'flow-changed': return evaluateFlow(condition, obs);
    case 'test-evidence-present': return evaluateTests(condition, obs);
    case 'structural-rule-no-new-violation': return evaluateStructural(condition, obs);
    case 'security-no-new-finding': return evaluateSecurity(condition, obs);
  }
}

/** Evaluates every condition; output order follows input order. */
export function evaluateConditions(
  conditions: readonly ExpectedSemanticCondition[],
  observations: ReadonlyMap<string, RepositoryObservation>,
): ConditionEvaluation[] {
  return conditions.map((condition) => evaluateCondition(condition, observations.get(condition.repositoryId)));
}

// ─── Cross-repository consumer re-grading ────────────────────────────────────

export interface CrossRepoConsumerRecord {
  routeFactId?: string;
  providerRepositoryId: string;
  consumers: ReadonlyArray<{ repositoryId: string; consumerId: string; certainty: string; consumedFields: readonly string[] }>;
}

const VERDICT_RANK: Record<ApiCompatibilityFinding['verdict'], number> = { compatible: 0, unknown: 1, 'potentially-breaking': 2, breaking: 3 };

/**
 * Local API drift (`getApiDrift`) matches consumers only inside the provider repository, so a
 * route whose consumers live in other repositories looks unconsumed and its removal "compatible".
 * Re-grades provider findings with the cross-repository consumers known at session start:
 * - route removed / method changed with any exact consumer -> breaking;
 * - response field removed / retyped -> breaking when a consumer reads that field,
 *   potentially-breaking when consumers exist but their consumed fields are unknown.
 * Verdicts are only ever raised, never lowered.
 */
export function regradeWithCrossRepoConsumers(
  repositoryId: string,
  findings: readonly ApiCompatibilityFinding[],
  records: readonly CrossRepoConsumerRecord[],
): ApiCompatibilityFinding[] {
  const byRoute = new Map(records.filter((r) => r.providerRepositoryId === repositoryId && r.routeFactId).map((r) => [r.routeFactId!, r]));
  return findings.map((finding) => {
    const record = byRoute.get(finding.routeFactId);
    if (!record) return finding;
    const exact = record.consumers.filter((consumer) => consumer.certainty === 'exact');
    if (exact.length === 0) return finding;
    let verdict: ApiCompatibilityFinding['verdict'] = finding.verdict;
    let affected = exact;
    if (finding.rule === 'route-removed' || finding.rule === 'method-changed' || finding.rule === 'success-status-removed') {
      verdict = 'breaking';
    } else if (finding.rule === 'response-field-removed' || finding.rule === 'response-field-type-changed') {
      const readers = exact.filter((consumer) => finding.fieldKey !== undefined && consumer.consumedFields.includes(finding.fieldKey));
      const unknownReaders = exact.filter((consumer) => consumer.consumedFields.length === 0);
      if (readers.length > 0) {
        verdict = 'breaking';
        affected = readers;
      } else if (unknownReaders.length > 0) {
        verdict = 'potentially-breaking';
        affected = unknownReaders;
      } else {
        return finding;
      }
    } else {
      return finding;
    }
    if (VERDICT_RANK[verdict] <= VERDICT_RANK[finding.verdict]) return finding;
    return {
      ...finding,
      verdict,
      affectedConsumerFactIds: [...new Set([...finding.affectedConsumerFactIds, ...affected.map((consumer) => `${consumer.repositoryId}:${consumer.consumerId}`)])].sort(),
      reason: `${finding.reason}; ${affected.length} known cross-repository consumer(s) affected`,
    };
  });
}

// ─── Unexpected changes ──────────────────────────────────────────────────────

const BENIGN_EDGE_KINDS = new Set(['contains', 'defines', 'step_of', 'belongs_to']);

function conditionNodeIds(condition: ExpectedSemanticCondition): string[] {
  switch (condition.kind) {
    case 'node-exists':
    case 'node-absent':
    case 'node-modified':
    case 'test-evidence-present':
      return [condition.nodeId];
    case 'identity-change':
      return condition.expectedHeadId ? [condition.nodeId, condition.expectedHeadId] : [condition.nodeId];
    case 'relationship-exists':
    case 'relationship-absent':
      return [condition.sourceId, condition.targetId];
    case 'security-no-new-finding':
      return condition.nodeIds;
    default:
      return [];
  }
}

/**
 * Graph/contract/flow deltas not accounted for by the plan. A delta is
 * accounted for when it touches a planned node (target or condition subject,
 * either identity alias), a node reached by a proven rename/move of one, or
 * the single same-kind/name/file replacement of a removed planned node.
 * Position-only shifts, file-level fingerprint changes in files that contain
 * an accounted-for change, and structural containment edges are benign.
 */
export function collectUnexpectedChanges(input: {
  observation: RepositoryObservation;
  conditions: readonly ExpectedSemanticCondition[];
  targets: readonly WorkflowTargetRef[];
}): UnexpectedChange[] {
  const obs = input.observation;
  if (!obs.available) return [];
  const planned = new Set<string>();
  const addWithAlias = (id: string) => {
    planned.add(id);
    const alias = obs.aliases.get(id);
    if (alias) planned.add(alias);
  };
  for (const target of input.targets) if (target.repositoryId === obs.repositoryId) addWithAlias(target.id);
  for (const condition of input.conditions) {
    if (condition.repositoryId !== obs.repositoryId) continue;
    for (const id of conditionNodeIds(condition)) addWithAlias(id);
  }
  for (const delta of obs.nodes) {
    if ((delta.kind === 'renamed' || delta.kind === 'moved') && delta.baseId && planned.has(delta.baseId) && delta.headId) addWithAlias(delta.headId);
    if (delta.kind === 'removed' && delta.baseId && planned.has(delta.baseId)) {
      const replacements = replacementCandidates(obs, delta);
      if (replacements.length === 1 && replacements[0]!.headId) addWithAlias(replacements[0]!.headId);
    }
  }

  const out: UnexpectedChange[] = [];
  const touchedFiles = new Set<string>();
  for (const delta of obs.nodes) {
    if ((delta.baseId && planned.has(delta.baseId)) || (delta.headId && planned.has(delta.headId))) {
      if (delta.baseFilePath) touchedFiles.add(delta.baseFilePath);
      if (delta.headFilePath) touchedFiles.add(delta.headFilePath);
    }
  }
  for (const delta of obs.nodes) {
    if (isPositionOnlyDelta(delta)) continue;
    if ((delta.baseId && planned.has(delta.baseId)) || (delta.headId && planned.has(delta.headId))) continue;
    if (delta.nodeKind === 'file' && delta.kind === 'changed' && touchedFiles.has(delta.headFilePath ?? delta.baseFilePath ?? '')) continue;
    if (delta.nodeKind === 'vulnerability') continue;
    out.push({
      repositoryId: obs.repositoryId,
      category: 'node',
      key: delta.headId ?? delta.baseId ?? '',
      change: delta.kind,
      name: delta.headName ?? delta.baseName,
      filePath: delta.headFilePath ?? delta.baseFilePath,
    });
  }
  for (const delta of obs.relationships) {
    if (BENIGN_EDGE_KINDS.has(delta.edgeKind)) continue;
    if (planned.has(delta.sourceId) || planned.has(delta.targetId)) continue;
    out.push({
      repositoryId: obs.repositoryId,
      category: 'relationship',
      key: relationshipTripleKey(delta.sourceId, delta.edgeKind, delta.targetId),
      change: delta.kind,
    });
  }
  const plannedContracts = new Set(input.conditions
    .filter((c): c is Extract<ExpectedSemanticCondition, { contractId: string }> => 'contractId' in c && c.repositoryId === obs.repositoryId)
    .map((c) => c.contractId));
  for (const finding of obs.contracts?.findings ?? []) {
    if (finding.verdict === 'compatible' || plannedContracts.has(finding.routeFactId)) continue;
    out.push({
      repositoryId: obs.repositoryId,
      category: 'contract',
      key: finding.routeFactId,
      change: `${finding.verdict}:${finding.rule}${finding.fieldKey ? `:${finding.fieldKey}` : ''}`,
    });
  }
  if (obs.flows.supported) {
    const plannedFlows = new Set(input.conditions
      .filter((c): c is Extract<ExpectedSemanticCondition, { flowId: string }> => 'flowId' in c && c.repositoryId === obs.repositoryId)
      .map((c) => c.flowId));
    const flowTouchesPlan = (flowId: string) => {
      const flow = obs.headFlows.get(flowId) ?? obs.baseFlows.get(flowId);
      return Boolean(flow?.stepCanonicalIds.some((step) => planned.has(step)));
    };
    for (const delta of obs.flows.deltas) {
      const baseFlowId = delta.details?.split(' -> ')[0];
      if (plannedFlows.has(delta.flowId) || (baseFlowId && plannedFlows.has(baseFlowId))) continue;
      if (flowTouchesPlan(delta.flowId) || (baseFlowId && flowTouchesPlan(baseFlowId))) continue;
      out.push({ repositoryId: obs.repositoryId, category: 'flow', key: delta.flowId, change: delta.kind });
    }
  }
  return out.sort((a, b) => a.category.localeCompare(b.category) || a.key.localeCompare(b.key) || a.change.localeCompare(b.change));
}
