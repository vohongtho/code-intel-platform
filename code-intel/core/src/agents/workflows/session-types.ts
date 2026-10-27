/**
 * session-types.ts
 *
 * Versioned contracts for resumable change-workflow sessions: a
 * plan -> external edit -> reindex -> verify -> review -> complete state
 * machine layered on top of the static workflow manifests in `registry.ts`.
 *
 * A session pins baseline *identities* (Generation ID, Git commit/branch,
 * analyzer fingerprints, group sync version) — never source text — and
 * expresses expected post-change conditions against canonical node /
 * relationship / contract / flow identities, not display names. Code Intel
 * never edits source or mutates Git state on behalf of a session.
 */

import type { AnalysisCertainty, AnalysisCoverage } from '../../shared/index.js';
import type { EdgeKind } from '../../shared/index.js';
import type { TestEvidenceKind } from '../../query/test-selection.js';

/** Bump when the persisted `ChangeWorkflowSession` shape changes incompatibly. */
export const CHANGE_WORKFLOW_SCHEMA_VERSION = 1 as const;

/** Bump when the baseline sidecar (`<id>.baseline.json`) shape changes. */
export const WORKFLOW_BASELINE_SCHEMA_VERSION = 1 as const;

export const CHANGE_WORKFLOW_PHASES = [
  'discover',
  'plan',
  'ready-for-change',
  'reindex-required',
  'verify',
  'needs-revision',
  'review',
  'complete',
] as const;
export type ChangeWorkflowPhase = (typeof CHANGE_WORKFLOW_PHASES)[number];

/**
 * Allowed phase transitions. `verify` is transient (a verify run enters it and
 * immediately resolves to `review` / `needs-revision` / `reindex-required`),
 * but it stays a real phase so a crashed verify run is visible on reopen.
 */
export const CHANGE_WORKFLOW_TRANSITIONS: Readonly<Record<ChangeWorkflowPhase, readonly ChangeWorkflowPhase[]>> = Object.freeze({
  discover: ['plan'],
  plan: ['ready-for-change'],
  'ready-for-change': ['reindex-required', 'verify'],
  'reindex-required': ['verify', 'reindex-required'],
  verify: ['review', 'needs-revision', 'reindex-required'],
  'needs-revision': ['reindex-required', 'verify'],
  review: ['complete', 'needs-revision', 'reindex-required', 'verify'],
  complete: [],
});

export function canTransition(from: ChangeWorkflowPhase, to: ChangeWorkflowPhase): boolean {
  return CHANGE_WORKFLOW_TRANSITIONS[from].includes(to);
}

// ─── Scope / baseline ────────────────────────────────────────────────────────

export interface RepoWorkflowScope {
  type: 'repo';
  repositoryId: string;
  repositoryName: string;
  /** Absolute path of the repository root (local data — sessions never leave this machine). */
  repoPath: string;
}

export interface GroupWorkflowScope {
  type: 'group';
  groupName: string;
  /** Member repository IDs at session start, sorted. */
  repositoryIds: string[];
}

export type WorkflowScope = RepoWorkflowScope | GroupWorkflowScope;

/** Analyzer/schema producer fingerprints a baseline was produced with. */
export interface BaselineAnalyzerFingerprints {
  schemaVersion?: number;
  identityFingerprint?: string;
  resolverFingerprint?: string;
  factSchemaFingerprint?: string;
  apiContractFingerprint?: string;
  flowIdentityFingerprint?: string;
}

export interface BaselineArtifactRef {
  /** sha256 of the sidecar file bytes, checked on read. */
  sha256: string;
  sizeBytes: number;
  nodeCount: number;
  edgeCount: number;
  flowCount: number;
}

export interface RepositoryBaseline {
  repositoryId: string;
  repositoryName: string;
  repoPath: string;
  generationId?: string;
  indexVersion?: string;
  commit?: string;
  branch?: string;
  /** Working tree had uncommitted changes at session start. */
  dirty: boolean;
  analyzer: BaselineAnalyzerFingerprints;
  /** Hash-only normalized graph sidecar used as the verification base. */
  artifact?: BaselineArtifactRef;
}

export interface GroupBaseline {
  groupName: string;
  syncedAt?: string;
  schemaVersion?: string;
  /** sha256 over sorted member repository IDs — membership change detection. */
  membershipFingerprint: string;
  /** sha256 over the persisted consumer index — contract-link change detection. */
  consumerIndexFingerprint?: string;
  /** System-flow IDs/fingerprints touching selected targets at start (when the capability exists). */
  systemFlows?: Array<{ id: string; fingerprint: string }>;
  /**
   * Known cross-repository consumers of target contracts at start. Local API drift only sees
   * consumers inside the provider repository; verification re-grades provider findings with these.
   */
  contractConsumers?: Array<{
    contractId: string;
    /** Route fact ID (the contract's source canonical ID) that local findings are keyed by. */
    routeFactId?: string;
    providerRepositoryId: string;
    consumers: Array<{ repositoryId: string; consumerId: string; certainty: string; consumedFields: string[] }>;
  }>;
}

// ─── Targets / capabilities / boundaries ─────────────────────────────────────

export type WorkflowTargetKind = 'symbol' | 'contract' | 'flow' | 'system-flow';
export type WorkflowTargetSource = 'user' | 'explore' | 'search' | 'impact' | 'contract-consumer' | 'flow';

export interface WorkflowTargetRef {
  kind: WorkflowTargetKind;
  /** Canonical identity: graph node ID, contract ID, flow ID, or system-flow ID. */
  id: string;
  repositoryId: string;
  /** Display name only — never used for matching. */
  name?: string;
  filePath?: string;
  nodeKind?: string;
  certainty: AnalysisCertainty;
  source: WorkflowTargetSource;
}

export const WORKFLOW_CAPABILITIES = [
  'explore',
  'stable-flows',
  'api-contracts',
  'test-intelligence',
  'pdg',
  'structural-review',
  'security-review',
  'group-contracts',
  'system-flows',
  'ref-aware-views',
] as const;
export type WorkflowCapabilityId = (typeof WORKFLOW_CAPABILITIES)[number];

export interface UnavailableWorkflowCapability {
  capability: WorkflowCapabilityId;
  reason: string;
  reducedGuarantee: string;
}

export interface ChangeWorkflowCapabilities {
  available: WorkflowCapabilityId[];
  unavailable: UnavailableWorkflowCapability[];
}

export type WorkflowBoundaryKind =
  | 'capability-unavailable'
  | 'coverage-incomplete'
  | 'ambiguous-target'
  | 'unresolved-target'
  | 'stale-index'
  | 'baseline-unavailable'
  | 'branch-changed'
  | 'head-diverged'
  | 'analyzer-incompatible'
  | 'group-membership-changed'
  | 'group-sync-stale'
  | 'analysis-limit';

export interface WorkflowBoundary {
  kind: WorkflowBoundaryKind;
  message: string;
  repositoryId?: string;
  capability?: WorkflowCapabilityId;
}

// ─── Expected semantic conditions ────────────────────────────────────────────

interface ConditionBase {
  /** Stable within the session (`cond-<hash>`). */
  id: string;
  repositoryId: string;
  description?: string;
}

/** Node with this canonical ID exists after the change (added or kept). */
export interface NodeExistsCondition extends ConditionBase { kind: 'node-exists'; nodeId: string }
/** Node with this canonical ID no longer exists (and was not merely renamed/moved). */
export interface NodeAbsentCondition extends ConditionBase { kind: 'node-absent'; nodeId: string }
/** Node body/properties changed (any of changed/moved/renamed with proven continuity). */
export interface NodeModifiedCondition extends ConditionBase { kind: 'node-modified'; nodeId: string }
/** Node identity changes via a proven rename/move. */
export interface IdentityChangeCondition extends ConditionBase {
  kind: 'identity-change';
  nodeId: string;
  change: 'renamed' | 'moved' | 'renamed-or-moved';
  /** Optional expected new canonical ID, when the agent knows it. */
  expectedHeadId?: string;
}
export interface RelationshipExistsCondition extends ConditionBase {
  kind: 'relationship-exists';
  sourceId: string;
  targetId: string;
  edgeKind: EdgeKind;
}
export interface RelationshipAbsentCondition extends ConditionBase {
  kind: 'relationship-absent';
  sourceId: string;
  targetId: string;
  edgeKind: EdgeKind;
}
/** API contract (route fact ID or group contract ID) stays compatible. */
export interface ContractCompatibleCondition extends ConditionBase { kind: 'contract-compatible'; contractId: string }
/** API contract is intentionally changed in a breaking/potentially-breaking way. */
export interface ContractExpectedBreakingCondition extends ConditionBase { kind: 'contract-expected-breaking'; contractId: string }
/** Every known exact consumer of a contract in this repository was updated. */
export interface ConsumerUpdatedCondition extends ConditionBase {
  kind: 'consumer-updated';
  contractId: string;
  consumerIds: string[];
}
export interface FlowPreservedCondition extends ConditionBase { kind: 'flow-preserved'; flowId: string }
export interface FlowChangedCondition extends ConditionBase { kind: 'flow-changed'; flowId: string }
export interface TestEvidencePresentCondition extends ConditionBase {
  kind: 'test-evidence-present';
  nodeId: string;
  /** Weakest acceptable evidence kind; `direct` is strongest. Default `transitive`. */
  minimumKind?: Exclude<TestEvidenceKind, 'candidate' | 'unknown'>;
}
export interface StructuralNoNewViolationCondition extends ConditionBase {
  kind: 'structural-rule-no-new-violation';
  rule: 'no-new-cycles';
}
export interface SecurityNoNewFindingCondition extends ConditionBase {
  kind: 'security-no-new-finding';
  /** Restrict to findings on these node IDs; empty means repository-wide. */
  nodeIds: string[];
}

export type ExpectedSemanticCondition =
  | NodeExistsCondition
  | NodeAbsentCondition
  | NodeModifiedCondition
  | IdentityChangeCondition
  | RelationshipExistsCondition
  | RelationshipAbsentCondition
  | ContractCompatibleCondition
  | ContractExpectedBreakingCondition
  | ConsumerUpdatedCondition
  | FlowPreservedCondition
  | FlowChangedCondition
  | TestEvidencePresentCondition
  | StructuralNoNewViolationCondition
  | SecurityNoNewFindingCondition;

export type ExpectedSemanticConditionKind = ExpectedSemanticCondition['kind'];

/** A condition before its content-derived `id` is assigned (distributes over the union). */
export type ExpectedSemanticConditionInput = ExpectedSemanticCondition extends infer C
  ? C extends ExpectedSemanticCondition ? Omit<C, 'id'> : never
  : never;

export const EXPECTED_CONDITION_KINDS: readonly ExpectedSemanticConditionKind[] = [
  'node-exists', 'node-absent', 'node-modified', 'identity-change',
  'relationship-exists', 'relationship-absent',
  'contract-compatible', 'contract-expected-breaking', 'consumer-updated',
  'flow-preserved', 'flow-changed',
  'test-evidence-present', 'structural-rule-no-new-violation', 'security-no-new-finding',
];

export const CONDITION_STATUSES = [
  'satisfied',
  'partially-satisfied',
  'unexpected-change',
  'not-observed',
  'unknown',
  'blocked',
] as const;
export type ConditionStatus = (typeof CONDITION_STATUSES)[number];

export interface ConditionEvaluation {
  conditionId: string;
  kind: ExpectedSemanticConditionKind;
  repositoryId: string;
  status: ConditionStatus;
  reason: string;
  /** Delta keys / finding IDs / test IDs supporting the status. */
  evidenceRefs: string[];
}

// ─── Plan ────────────────────────────────────────────────────────────────────

export type WorkflowPlanCategory = 'required' | 'candidate' | 'optional' | 'blocked';

export const REVIEW_LENS_IDS = ['architecture', 'api', 'tests', 'security', 'change-risk', 'scope'] as const;
export type ReviewLensId = (typeof REVIEW_LENS_IDS)[number];

export interface PlannedTestEvidence {
  testId?: string;
  filePath?: string;
  kind: TestEvidenceKind;
  certainty: AnalysisCertainty;
}

export interface WorkflowPlanStep {
  id: string;
  title: string;
  category: WorkflowPlanCategory;
  repositories: string[];
  targets: WorkflowTargetRef[];
  expected: ExpectedSemanticCondition[];
  tests: PlannedTestEvidence[];
  reviewLenses: ReviewLensId[];
  dependsOn: string[];
  certainty: AnalysisCertainty;
  boundaries: WorkflowBoundary[];
}

/** Content fingerprint of context already identified for a target, so integrations can skip redundant reads. */
export interface SuppliedContextFingerprint {
  targetId: string;
  repositoryId: string;
  contentFingerprint: string;
}

export interface WorkflowPlan {
  steps: WorkflowPlanStep[];
  boundaries: WorkflowBoundary[];
  contextFingerprints: SuppliedContextFingerprint[];
  /** True when target discovery hit a cap. */
  truncated: boolean;
}

// ─── Verification ────────────────────────────────────────────────────────────

export type VerificationOutcome = 'passed' | 'needs-revision' | 'reindex-required' | 'blocked';

export interface RepositoryFreshness {
  repositoryId: string;
  state: 'fresh' | 'reindex-required' | 'blocked' | 'unchanged';
  reasons: string[];
  generationId?: string;
  commit?: string;
  branch?: string;
}

export interface UnexpectedChange {
  repositoryId: string;
  category: 'node' | 'relationship' | 'contract' | 'flow';
  key: string;
  change: string;
  name?: string;
  filePath?: string;
}

export type LensStatus = 'pass' | 'warn' | 'fail' | 'unavailable';

export interface LensFinding {
  severity: 'info' | 'warning' | 'error';
  message: string;
  evidenceRefs: string[];
}

export interface LensResult {
  lensId: ReviewLensId;
  version: string;
  repositoryId: string;
  status: LensStatus;
  findings: LensFinding[];
  coverage: AnalysisCoverage;
  reducedGuarantee?: string;
}

export interface VerificationCounts {
  plannedConditions: number;
  satisfied: number;
  unexpectedChanges: number;
  changedNodes: number;
  changedRelationships: number;
  contractFindings: number;
  flowDeltas: number;
  systemFlowsChanged?: number;
}

export interface ChangedSymbolRef {
  repositoryId: string;
  id: string;
  kind: string;
  change: string;
  name?: string;
  filePath?: string;
}

export interface VerificationResult {
  verifiedAt: string;
  outcome: VerificationOutcome;
  repositories: RepositoryFreshness[];
  conditions: ConditionEvaluation[];
  unexpected: UnexpectedChange[];
  lenses: LensResult[];
  changedFiles: string[];
  changedSymbols: ChangedSymbolRef[];
  counts: VerificationCounts;
  coverage: AnalysisCoverage;
  boundaries: WorkflowBoundary[];
  /** Lists were capped for size; counts remain exact. */
  truncated: boolean;
}

// ─── Commit plan ─────────────────────────────────────────────────────────────

export interface CommitGroup {
  order: number;
  repositoryId: string;
  title: string;
  body: string;
  files: string[];
  symbols: string[];
  stepIds: string[];
  rationale: string;
}

/** Suggestion only. Code Intel never stages, commits, rewrites history or pushes. */
export interface CommitPlan {
  generatedAt: string;
  basedOnVerification: string;
  groups: CommitGroup[];
  note: string;
}

// ─── Session ─────────────────────────────────────────────────────────────────

export type CheckpointKind = 'start' | 'checkpoint' | 'status' | 'verify' | 'complete';

export interface WorkflowCheckpoint {
  id: string;
  kind: CheckpointKind;
  createdAt: string;
  fromPhase: ChangeWorkflowPhase;
  toPhase: ChangeWorkflowPhase;
  /** Revision the session reached after this checkpoint was written. */
  revision: number;
  note?: string;
  outcome?: VerificationOutcome;
}

export type TaskRetention = 'summary' | 'fingerprint-only';

export interface PhaseTiming {
  phase: ChangeWorkflowPhase;
  enteredAt: string;
}

export interface ChangeWorkflowSession {
  schemaVersion: typeof CHANGE_WORKFLOW_SCHEMA_VERSION;
  id: string;
  revision: number;
  phase: ChangeWorkflowPhase;
  createdAt: string;
  updatedAt: string;
  scope: WorkflowScope;
  /** sha256 of the normalized task text. */
  taskFingerprint: string;
  taskRetention: TaskRetention;
  /** Truncated task text; absent when `taskRetention` is `fingerprint-only`. */
  taskSummary?: string;
  baselines: RepositoryBaseline[];
  groupBaseline?: GroupBaseline;
  selectedTargets: WorkflowTargetRef[];
  plan: WorkflowPlan;
  checkpoints: WorkflowCheckpoint[];
  capabilities: ChangeWorkflowCapabilities;
  latestVerification?: VerificationResult;
  commitPlan?: CommitPlan;
  /** Phase entry times (bounded) for observability; no task/source text. */
  phaseHistory: PhaseTiming[];
  /**
   * Authenticated creator, set by multi-user transports (HTTP). Sessions without an owner were
   * created by a local transport (CLI/MCP) and are reachable over HTTP by admins only.
   */
  owner?: { userId: string; username: string };
}
