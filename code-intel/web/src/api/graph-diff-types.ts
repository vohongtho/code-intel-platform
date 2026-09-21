// Wire types for POST /api/v1/graph/diff (Branch-Aware Semantic Graph Diff).
//
// These mirror `code-intel/core/src/snapshots/types.ts` and
// `code-intel/core/src/semantic/api-contracts/types.ts` field-for-field so the
// frontend and backend agree byte-for-byte on the wire shape. Do not add or
// rename fields here without checking those source files first.

import type { NodeKind, EdgeKind } from 'code-intel-shared';

// ── Certainty / coverage primitives (mirrors shared/evidence-types.ts) ─────────

export type RelationshipCertainty = 'exact' | 'candidate' | 'heuristic';

export type AnalysisBoundaryKind =
  | 'external-library'
  | 'dynamic-dispatch'
  | 'unresolved-receiver'
  | 'ambiguous-target'
  | 'analysis-limit'
  | 'stale-index'
  | 'unavailable-index'
  | 'legacy-resolver'
  | 'unsupported-semantics';

export interface AnalysisCoverage {
  complete: boolean;
  examinedCount: number;
  totalKnownCount?: number;
  incompleteReasons: readonly string[];
}

// ── Snapshot descriptor (mirrors snapshots/types.ts) ────────────────────────────

export interface SemanticSnapshotDescriptor {
  snapshotId: string;
  repositoryIdentity: string;
  gitTree: string;
  commit?: string;
  dirtyStateFingerprint?: string;
  parserFingerprint: string;
  factSchemaFingerprint: string;
  identityFingerprint: string;
  resolverFingerprint: string;
  graphSchemaFingerprint: string;
  contractFingerprint?: string;
  createdAt: string;
}

export type SnapshotBuildStatus = 'built' | 'cached' | 'failed' | 'unsupported';

export type SnapshotBoundaryKind =
  | AnalysisBoundaryKind
  | 'dirty-working-tree-unsupported'
  | 'unknown-ref'
  | 'materialization-failed'
  | 'analysis-failed'
  | 'readback-failed'
  | 'cache-corrupt';

export interface SnapshotBoundary {
  kind: SnapshotBoundaryKind;
  message: string;
}

/**
 * Per-side build status as embedded in a /graph/diff response. On success
 * (200) it carries `fromCache`; on failure (422) it carries `error` instead —
 * both fields are optional here so this one type covers both cases.
 */
export interface GraphDiffSnapshotStatus {
  status: SnapshotBuildStatus;
  fromCache?: boolean;
  boundaries: SnapshotBoundary[];
  error?: string;
}

// ── Entity (node) deltas ────────────────────────────────────────────────────────

export type EntityChangeKind = 'added' | 'removed' | 'changed' | 'moved' | 'renamed' | 'unknown';

export type ContinuityCertainty = 'proven' | 'candidate';

export interface EntityContinuity {
  certainty: ContinuityCertainty;
  reason: string;
  evidenceKinds: string[];
}

export interface EntityDelta {
  kind: EntityChangeKind;
  nodeKind: NodeKind;
  baseId?: string;
  headId?: string;
  baseName?: string;
  headName?: string;
  baseFilePath?: string;
  headFilePath?: string;
  changedProperties?: string[];
  continuity?: EntityContinuity;
  continuityCandidates?: string[];
}

// ── Relationship (edge) deltas ──────────────────────────────────────────────────

export type RelationshipChangeKind = 'added' | 'removed' | 'changed';

export interface RelationshipEndpointState {
  certainty?: RelationshipCertainty;
  strategy?: string;
  evidenceRef?: string;
  confidence?: number;
}

export interface RelationshipDelta {
  kind: RelationshipChangeKind;
  edgeKind: EdgeKind;
  sourceId: string;
  targetId: string;
  callSiteId?: string;
  base?: RelationshipEndpointState;
  head?: RelationshipEndpointState;
  changedFields?: string[];
}

// ── API contract deltas (mirrors semantic/api-contracts/types.ts) ──────────────

export type ApiBoundaryReason =
  | 'dynamic-path-segment'
  | 'dynamic-url-expression'
  | 'unresolved-dto'
  | 'unresolved-response-shape'
  | 'reflection-registration'
  | 'candidate-cap-exceeded'
  | 'unsupported-framework-construct'
  | 'local-data-flow-exceeded'
  | 'analysis-truncated';

export type ApiCompatibilityVerdict = 'compatible' | 'potentially-breaking' | 'breaking' | 'unknown';

export type ApiCompatibilityRuleKind =
  | 'route-removed'
  | 'method-changed'
  | 'request-field-added-required'
  | 'request-field-type-changed'
  | 'response-field-removed'
  | 'response-field-type-changed'
  | 'success-status-removed'
  | 'response-field-added-optional';

export interface ApiCompatibilityFinding {
  rule: ApiCompatibilityRuleKind;
  verdict: ApiCompatibilityVerdict;
  routeFactId: string;
  affectedConsumerFactIds: readonly string[];
  fieldKey?: string;
  reason: string;
  boundaryReasons: readonly ApiBoundaryReason[];
}

export interface ContractDiffSection {
  findings: ApiCompatibilityFinding[];
  coverage: { baseRoutes: number; headRoutes: number; consumerCoverageComplete: boolean };
}

// ── Flow / cluster deltas ───────────────────────────────────────────────────────

export type FlowDeltaKind = 'added' | 'removed' | 'membership-changed' | 'path-changed';

export interface FlowDelta {
  kind: FlowDeltaKind;
  flowId: string;
  entryPointId?: string;
  details?: string;
}

export interface UnsupportedDiffSection {
  supported: false;
  reason: string;
}

export type FlowDiffSection = UnsupportedDiffSection | { supported: true; deltas: FlowDelta[] };
export type ClusterDiffSection = UnsupportedDiffSection;

// ── /api/v1/graph/diff request/response ─────────────────────────────────────────

export interface GraphDiffRequest {
  base_ref: string;
  head_ref: string;
  repoId?: string;
  include_contracts?: boolean;
  allow_cache?: boolean;
  nodes_offset?: number;
  nodes_limit?: number;
  relationships_offset?: number;
  relationships_limit?: number;
}

export interface GraphDiffResponse {
  base: SemanticSnapshotDescriptor;
  head: SemanticSnapshotDescriptor;
  coverage: AnalysisCoverage;
  contracts?: ContractDiffSection;
  flows: FlowDiffSection;
  clusters: ClusterDiffSection;
  nodes: EntityDelta[];
  nodesTotal: number;
  nodesOffset: number;
  nodesLimit: number;
  nodesHasMore: boolean;
  relationships: RelationshipDelta[];
  relationshipsTotal: number;
  relationshipsOffset: number;
  relationshipsLimit: number;
  relationshipsHasMore: boolean;
  baseSnapshot: GraphDiffSnapshotStatus;
  headSnapshot: GraphDiffSnapshotStatus;
}

/** 422 body: one or both refs could not be built into a trustworthy snapshot. */
export interface GraphDiffUnavailableResponse {
  error: { code: string; message: string; requestId?: string };
  baseSnapshot: GraphDiffSnapshotStatus;
  headSnapshot: GraphDiffSnapshotStatus;
}

/**
 * Discriminated result for `ApiClient.graphDiff`. A 422 is a legitimate,
 * expected outcome (unresolvable ref, analysis failure, etc.) — not an
 * exception — so callers must handle `status: 'unavailable'` explicitly
 * rather than via try/catch.
 */
export type GraphDiffOutcome =
  | { status: 'ok'; diff: GraphDiffResponse }
  | { status: 'unavailable'; detail: GraphDiffUnavailableResponse };
