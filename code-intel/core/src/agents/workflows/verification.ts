/**
 * verification.ts
 *
 * Expected-vs-actual verification for a change-workflow session.
 *
 * Per repository:
 * 1. check the session scope still holds (branch unchanged, baseline commit
 *    is an ancestor of HEAD, analyzer identity fingerprint compatible);
 * 2. require a trusted index whose source has not changed since it was
 *    published — otherwise the repository is `reindex-required` and no
 *    semantic reasoning happens from the stale graph;
 * 3. diff the hash-only baseline against the current index with the
 *    snapshot normalizer/diff (`snapshots/graph-diff.ts`), API-contract
 *    drift (`getApiDrift`), stable flow diff, test selection, structural and
 *    security keys;
 * 4. evaluate expected conditions (pure, `conditions.ts`), collect
 *    unexpected changes, and run the requested review lenses.
 *
 * Verification never edits source and never mutates Git.
 */

import crypto from 'node:crypto';
import type { KnowledgeGraph } from '../../graph/knowledge-graph.js';
import type { AnalysisCoverage } from '../../shared/index.js';
import { FLOW_IDENTITY_VERSION } from '../../flow-detection/identity.js';
import { selectTestsForImpact } from '../../query/test-selection.js';
import { getApiDrift } from '../../semantic/api-contracts/service.js';
import { diffEntitiesWithContinuity, diffFlows, diffRelationships } from '../../snapshots/graph-diff.js';
import type { NormalizedGraph } from '../../snapshots/normalizer.js';
import type { EntityDelta } from '../../snapshots/types.js';
import {
  cycleKeysOf,
  identityAliasesOf,
  isBaselinePayload,
  normalizeCurrentGraph,
  rehydrateApiGraph,
  rehydrateNormalizedGraph,
  securityFindingKeysOf,
  type WorkflowBaselinePayload,
} from './baseline.js';
import {
  collectUnexpectedChanges,
  evaluateConditions,
  isPositionOnlyDelta,
  regradeWithCrossRepoConsumers,
  relationshipTripleKey,
  type ConsumerObservation,
  type CrossRepoConsumerRecord,
  type RepositoryObservation,
} from './conditions.js';
import { assessIndexReadiness, type WorkflowRepoRuntime } from './repo-runtime.js';
import { runReviewLenses } from './review-lenses.js';
import type { SessionStore } from './session-store.js';
import type {
  ChangedSymbolRef,
  ChangeWorkflowSession,
  ExpectedSemanticCondition,
  LensResult,
  RepositoryBaseline,
  RepositoryFreshness,
  ReviewLensId,
  UnexpectedChange,
  VerificationOutcome,
  VerificationResult,
  WorkflowBoundary,
  WorkflowCapabilityId,
} from './session-types.js';

export const VERIFICATION_LIMITS = Object.freeze({
  maxChangedSymbols: 500,
  maxChangedFiles: 500,
  maxUnexpected: 200,
  maxTestSelections: 100,
});

/** Group-level inputs computed by the caller (session-service) for group sessions. */
export interface GroupVerificationContext {
  boundaries: WorkflowBoundary[];
  /** repositoryId -> consumer observation for `consumer-updated` conditions. */
  consumersFor?: (repositoryId: string, headGraph: KnowledgeGraph, payload: WorkflowBaselinePayload, nodes: readonly EntityDelta[]) => ConsumerObservation | undefined;
  /** Cross-repository consumers known at start; used to re-grade provider contract findings. */
  contractConsumers?: readonly CrossRepoConsumerRecord[];
  /** Extra unexpected changes (e.g. system flows no longer present). */
  extraUnexpected?: UnexpectedChange[];
  systemFlowsChanged?: number;
}

export interface VerifyDeps {
  store: SessionStore;
  runtime: WorkflowRepoRuntime;
  now: () => Date;
  group?: GroupVerificationContext;
}

interface RepositoryAssessment {
  freshness: RepositoryFreshness;
  boundaries: WorkflowBoundary[];
  freshnessUnknown: boolean;
}

/** Scope and freshness checks only — no graph load. Used by `status` and `verify`. */
export function assessRepository(baseline: RepositoryBaseline, runtime: WorkflowRepoRuntime): RepositoryAssessment {
  const boundaries: WorkflowBoundary[] = [];
  const repoDir = baseline.repoPath;
  const branch = runtime.gitBranch(repoDir);
  const head = runtime.gitHead(repoDir);
  const base = { repositoryId: baseline.repositoryId, branch, commit: head };

  if (baseline.branch && branch !== baseline.branch) {
    boundaries.push({ kind: 'branch-changed', repositoryId: baseline.repositoryId, message: `branch changed from ${baseline.branch} to ${branch ?? '(detached)'}` });
  }
  if (baseline.commit && head && head !== baseline.commit && runtime.gitIsAncestor(repoDir, baseline.commit, head) !== true) {
    boundaries.push({ kind: 'head-diverged', repositoryId: baseline.repositoryId, message: `baseline commit ${baseline.commit.slice(0, 12)} is not an ancestor of HEAD ${head.slice(0, 12)}` });
  }
  if (boundaries.length > 0) {
    return { freshness: { ...base, state: 'blocked', reasons: boundaries.map((b) => b.message) }, boundaries, freshnessUnknown: false };
  }

  const readiness = assessIndexReadiness(repoDir, runtime);
  const metadata = readiness.trust.metadata;
  if (metadata?.identityFingerprint && baseline.analyzer.identityFingerprint && metadata.identityFingerprint !== baseline.analyzer.identityFingerprint) {
    boundaries.push({ kind: 'analyzer-incompatible', repositoryId: baseline.repositoryId, message: 'canonical identity fingerprint changed since the session started; start a new session' });
    return { freshness: { ...base, state: 'blocked', reasons: boundaries.map((b) => b.message), generationId: readiness.trust.generationId }, boundaries, freshnessUnknown: false };
  }
  if (!readiness.ready) {
    boundaries.push({ kind: 'stale-index', repositoryId: baseline.repositoryId, message: `index is not current for ${baseline.repositoryName}; run \`code-intel analyze\` before verifying` });
    return { freshness: { ...base, state: 'reindex-required', reasons: readiness.reasons, generationId: readiness.trust.generationId }, boundaries, freshnessUnknown: false };
  }
  if (readiness.freshnessUnknown) {
    boundaries.push({ kind: 'coverage-incomplete', repositoryId: baseline.repositoryId, message: `source freshness could not be proven (${readiness.changes.reason})` });
  }
  const unchanged = readiness.trust.generationId !== undefined && readiness.trust.generationId === baseline.generationId;
  return {
    freshness: { ...base, state: unchanged ? 'unchanged' : 'fresh', reasons: readiness.reasons, generationId: readiness.trust.generationId },
    boundaries,
    freshnessUnknown: readiness.freshnessUnknown,
  };
}

function relationshipFacts(normalized: NormalizedGraph): RepositoryObservation['headRelationships'] {
  const certainties = new Map<string, Array<string | undefined>>();
  for (const edge of normalized.edgesByKey.values()) {
    const key = relationshipTripleKey(edge.source, edge.kind, edge.target);
    const list = certainties.get(key) ?? [];
    list.push(edge.certainty);
    certainties.set(key, list);
  }
  return { certainties };
}

function aliasMap(...lists: Array<Array<[string, string]>>): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const list of lists) {
    for (const [id, identity] of list) {
      aliases.set(id, identity);
      aliases.set(identity, id);
    }
  }
  return aliases;
}

function testNodeIds(conditions: readonly ExpectedSemanticCondition[], repositoryId: string): string[] {
  return [...new Set(conditions
    .filter((c): c is Extract<ExpectedSemanticCondition, { kind: 'test-evidence-present' }> => c.kind === 'test-evidence-present' && c.repositoryId === repositoryId)
    .map((c) => c.nodeId))].sort().slice(0, VERIFICATION_LIMITS.maxTestSelections);
}

interface ObservedRepository {
  observation: RepositoryObservation;
  headGraph?: KnowledgeGraph;
  capabilities: Set<WorkflowCapabilityId>;
  changedFiles: string[];
  changedSymbols: ChangedSymbolRef[];
}

function unavailableObservation(repositoryId: string, reason: string): RepositoryObservation {
  return {
    repositoryId,
    available: false,
    unavailableReason: reason,
    nodes: [],
    baseNodes: new Map(),
    headNodeIds: new Set(),
    relationships: [],
    headRelationships: { certainties: new Map() },
    flows: { supported: false, reason },
    baseFlows: new Map(),
    headFlows: new Map(),
    aliases: new Map(),
    coverage: { complete: false, examinedCount: 0, incompleteReasons: [reason] },
  };
}

async function observeRepository(input: {
  session: ChangeWorkflowSession;
  baseline: RepositoryBaseline;
  conditions: readonly ExpectedSemanticCondition[];
  deps: VerifyDeps;
  freshnessUnknown: boolean;
}): Promise<ObservedRepository> {
  const { session, baseline, deps } = input;
  const capabilities = new Set<WorkflowCapabilityId>();
  if (!baseline.artifact) {
    return { observation: unavailableObservation(baseline.repositoryId, 'session has no baseline artifact for this repository'), capabilities, changedFiles: [], changedSymbols: [] };
  }
  let payload: WorkflowBaselinePayload;
  try {
    const raw = deps.store.readBaseline(session.id, baseline.repositoryId, baseline.artifact.sha256);
    if (!isBaselinePayload(raw) || raw.repositoryId !== baseline.repositoryId) throw new Error('baseline payload is malformed');
    payload = raw;
  } catch (err) {
    return { observation: unavailableObservation(baseline.repositoryId, `baseline unavailable: ${err instanceof Error ? err.message : String(err)}`), capabilities, changedFiles: [], changedSymbols: [] };
  }

  const { graph: headGraph } = await deps.runtime.loadGraph(baseline.repoPath);
  const base = rehydrateNormalizedGraph(payload);
  const head = normalizeCurrentGraph(headGraph, baseline.repoPath);
  const nodes = diffEntitiesWithContinuity(base, head);
  const relationships = diffRelationships(base, head);

  const trust = deps.runtime.verifyTrust(baseline.repoPath);
  const headFlowVersion = trust.metadata?.compatibilityReceipt?.flowIdentityFingerprint;
  const stableFlows = baseline.analyzer.flowIdentityFingerprint === FLOW_IDENTITY_VERSION && headFlowVersion === FLOW_IDENTITY_VERSION;
  if (stableFlows) capabilities.add('stable-flows');
  const flows: RepositoryObservation['flows'] = stableFlows
    ? { supported: true, deltas: diffFlows(base, head) }
    : { supported: false, reason: 'flow verification requires baseline and current indexes produced with the current stable flow identity version' };

  const incompleteReasons: string[] = [];
  if (input.freshnessUnknown) incompleteReasons.push('source freshness unproven');
  let contracts: RepositoryObservation['contracts'];
  try {
    const drift = getApiDrift(rehydrateApiGraph(payload), headGraph, baseline.repositoryId);
    const findings = deps.group?.contractConsumers
      ? regradeWithCrossRepoConsumers(baseline.repositoryId, drift.findings, deps.group.contractConsumers)
      : drift.findings;
    contracts = { findings, consumerCoverageComplete: drift.coverage.consumerCoverageComplete };
    capabilities.add('api-contracts');
    if (!drift.coverage.consumerCoverageComplete) incompleteReasons.push('api-contract consumer coverage is incomplete');
  } catch (err) {
    incompleteReasons.push(`api-contract drift failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const tests = new Map<string, ReturnType<typeof selectTestsForImpact>>();
  for (const nodeId of testNodeIds(input.conditions, baseline.repositoryId)) {
    if (headGraph.getNode(nodeId)) tests.set(nodeId, selectTestsForImpact(headGraph, [nodeId], { repoDir: baseline.repoPath }));
  }
  capabilities.add('test-intelligence');
  const cycles = { base: payload.cycleKeys, head: cycleKeysOf(headGraph) };
  capabilities.add('structural-review');
  const security = securityFindingKeysOf(headGraph);
  capabilities.add('security-review');

  const consumers = deps.group?.consumersFor?.(baseline.repositoryId, headGraph, payload, nodes);
  if (consumers) capabilities.add('group-contracts');

  const observation: RepositoryObservation = {
    repositoryId: baseline.repositoryId,
    available: true,
    nodes,
    baseNodes: base.nodesById,
    headNodeIds: new Set(head.nodesById.keys()),
    relationships,
    headRelationships: relationshipFacts(head),
    contracts,
    consumers,
    flows,
    baseFlows: base.flowsById ?? new Map(),
    headFlows: head.flowsById ?? new Map(),
    tests,
    cycles,
    security: { baseKeys: payload.securityFindingKeys, headKeys: security.keys, nodeIdsByKey: security.nodeIdsByKey },
    aliases: aliasMap(payload.identityAliases, identityAliasesOf(headGraph)),
    coverage: { complete: incompleteReasons.length === 0, examinedCount: nodes.length + relationships.length, incompleteReasons },
  };

  const changedSymbols: ChangedSymbolRef[] = nodes
    .filter((delta) => !isPositionOnlyDelta(delta) && delta.nodeKind !== 'file')
    .map((delta) => ({
      repositoryId: baseline.repositoryId,
      id: delta.headId ?? delta.baseId ?? '',
      kind: delta.nodeKind,
      change: delta.kind,
      name: delta.headName ?? delta.baseName,
      filePath: delta.headFilePath ?? delta.baseFilePath,
    }));
  const changedFiles = [...new Set(nodes
    .filter((delta) => !isPositionOnlyDelta(delta))
    .flatMap((delta) => [delta.baseFilePath, delta.headFilePath])
    .filter((file): file is string => Boolean(file)))].sort();
  return { observation, headGraph, capabilities, changedFiles, changedSymbols };
}

function emptyCoverage(reasons: string[]): AnalysisCoverage {
  return { complete: reasons.length === 0, examinedCount: 0, incompleteReasons: reasons };
}

function lensesFor(session: ChangeWorkflowSession, repositoryId: string): ReviewLensId[] {
  const ids = new Set<ReviewLensId>(['scope']);
  for (const step of session.plan.steps) {
    if (step.repositories.includes(repositoryId)) for (const lens of step.reviewLenses) ids.add(lens);
  }
  return [...ids].sort();
}

/**
 * Runs verification for a session and returns the result plus the phase the
 * session should move to. Does not persist — the session service writes the
 * result with revision compare-and-swap.
 */
export async function computeVerification(session: ChangeWorkflowSession, deps: VerifyDeps): Promise<{ result: VerificationResult; phase: ChangeWorkflowSession['phase'] }> {
  const verifiedAt = deps.now().toISOString();
  const conditions = session.plan.steps.flatMap((step) => step.expected);
  const boundaries: WorkflowBoundary[] = [...(deps.group?.boundaries ?? [])];
  const assessments = session.baselines.map((baseline) => ({ baseline, assessment: assessRepository(baseline, deps.runtime) }));
  for (const { assessment } of assessments) boundaries.push(...assessment.boundaries);
  const repositories = assessments.map(({ assessment }) => assessment.freshness);

  const groupBlocked = boundaries.some((b) => b.kind === 'group-membership-changed');
  const blocked = groupBlocked || repositories.some((repo) => repo.state === 'blocked');
  const reindex = repositories.some((repo) => repo.state === 'reindex-required');

  const base = {
    verifiedAt,
    repositories,
    boundaries,
    lenses: [] as LensResult[],
    unexpected: [] as UnexpectedChange[],
    changedFiles: [] as string[],
    changedSymbols: [] as ChangedSymbolRef[],
    truncated: false,
  };
  if (blocked || reindex) {
    // Never reason from a stale or incomparable graph: report why and stop.
    const outcome: VerificationOutcome = blocked ? 'blocked' : 'reindex-required';
    return {
      phase: blocked ? 'needs-revision' : 'reindex-required',
      result: {
        ...base,
        outcome,
        conditions: [],
        counts: { plannedConditions: conditions.length, satisfied: 0, unexpectedChanges: 0, changedNodes: 0, changedRelationships: 0, contractFindings: 0, flowDeltas: 0 },
        coverage: emptyCoverage([blocked ? 'verification blocked by scope/compatibility change' : 'reindex required before semantic verification']),
      },
    };
  }

  const observed = new Map<string, ObservedRepository>();
  for (const { baseline, assessment } of assessments) {
    observed.set(baseline.repositoryId, await observeRepository({ session, baseline, conditions, deps, freshnessUnknown: assessment.freshnessUnknown }));
  }
  const observations = new Map([...observed.entries()].map(([id, repo]) => [id, repo.observation]));
  const evaluations = evaluateConditions(conditions, observations);

  const unexpected: UnexpectedChange[] = [...(deps.group?.extraUnexpected ?? [])];
  const lenses: LensResult[] = [];
  const changedFiles: string[] = [];
  const changedSymbols: ChangedSymbolRef[] = [];
  const incomplete: string[] = [];
  let changedNodes = 0;
  let changedRelationships = 0;
  let contractFindings = 0;
  let flowDeltas = 0;
  for (const [repositoryId, repo] of [...observed.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const repoUnexpected = collectUnexpectedChanges({ observation: repo.observation, conditions, targets: session.selectedTargets });
    unexpected.push(...repoUnexpected);
    changedFiles.push(...repo.changedFiles);
    changedSymbols.push(...repo.changedSymbols);
    changedNodes += repo.observation.nodes.filter((delta) => !isPositionOnlyDelta(delta)).length;
    changedRelationships += repo.observation.relationships.length;
    contractFindings += repo.observation.contracts?.findings.length ?? 0;
    flowDeltas += repo.observation.flows.supported ? repo.observation.flows.deltas.length : 0;
    incomplete.push(...repo.observation.coverage.incompleteReasons.map((reason) => `${repositoryId}: ${reason}`));
    if (repo.headGraph) {
      lenses.push(...runReviewLenses(lensesFor(session, repositoryId), {
        repositoryId,
        repoDir: session.baselines.find((b) => b.repositoryId === repositoryId)!.repoPath,
        observation: repo.observation,
        headGraph: repo.headGraph,
        changedNodeIds: repo.changedSymbols.map((symbol) => symbol.id).filter(Boolean),
        changedFiles: repo.changedFiles,
        unexpected: repoUnexpected,
        conditions,
        capabilities: repo.capabilities,
      }));
    }
  }

  // Candidate steps are heuristic suggestions: their conditions inform review but never fail verification.
  const requiredIds = new Set(session.plan.steps.filter((step) => step.category === 'required').flatMap((step) => step.expected.map((c) => c.id)));
  const enforcedIds = new Set(session.plan.steps.filter((step) => step.category === 'required' || step.category === 'optional').flatMap((step) => step.expected.map((c) => c.id)));
  const satisfied = evaluations.filter((evaluation) => evaluation.status === 'satisfied').length;
  const requiredOk = evaluations.filter((evaluation) => requiredIds.has(evaluation.conditionId)).every((evaluation) => evaluation.status === 'satisfied');
  const hardFailure = evaluations.some((evaluation) => (enforcedIds.has(evaluation.conditionId) && evaluation.status === 'unexpected-change')
    || (requiredIds.has(evaluation.conditionId) && evaluation.status === 'blocked'));
  const lensFailure = lenses.some((lens) => lens.status === 'fail');
  const coverageComplete = incomplete.length === 0 && boundaries.every((b) => b.kind !== 'coverage-incomplete' && b.kind !== 'group-sync-stale');
  const passed = requiredOk && !hardFailure && !lensFailure && coverageComplete && satisfied > 0;

  const truncated = changedSymbols.length > VERIFICATION_LIMITS.maxChangedSymbols
    || changedFiles.length > VERIFICATION_LIMITS.maxChangedFiles
    || unexpected.length > VERIFICATION_LIMITS.maxUnexpected;
  return {
    phase: passed ? 'review' : 'needs-revision',
    result: {
      ...base,
      outcome: passed ? 'passed' : 'needs-revision',
      conditions: evaluations,
      unexpected: unexpected.slice(0, VERIFICATION_LIMITS.maxUnexpected),
      lenses,
      changedFiles: [...new Set(changedFiles)].sort().slice(0, VERIFICATION_LIMITS.maxChangedFiles),
      changedSymbols: changedSymbols
        .sort((a, b) => a.repositoryId.localeCompare(b.repositoryId) || (a.filePath ?? '').localeCompare(b.filePath ?? '') || a.id.localeCompare(b.id))
        .slice(0, VERIFICATION_LIMITS.maxChangedSymbols),
      counts: {
        plannedConditions: conditions.length,
        satisfied,
        unexpectedChanges: unexpected.length,
        changedNodes,
        changedRelationships,
        contractFindings,
        flowDeltas,
        ...(deps.group?.systemFlowsChanged !== undefined ? { systemFlowsChanged: deps.group.systemFlowsChanged } : {}),
      },
      coverage: { complete: coverageComplete, examinedCount: changedNodes + changedRelationships, incompleteReasons: [...new Set(incomplete)].sort() },
      truncated,
    },
  };
}

/** Stable digest of a verification result (excluding its timestamp) for determinism checks. */
export function verificationDigest(result: VerificationResult): string {
  const { verifiedAt: _verifiedAt, ...rest } = result;
  return crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex');
}
