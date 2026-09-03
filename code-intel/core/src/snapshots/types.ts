import type { NodeKind, EdgeKind } from '../shared/index.js';
import type { AnalysisBoundaryKind, AnalysisCoverage, RelationshipCertainty } from '../shared/evidence-types.js';

/**
 * Schema/version marker for on-disk snapshot cache entries and their descriptors.
 * Bump whenever the descriptor shape, fingerprint formula, or cache layout changes
 * in a way that makes previously-cached entries unsafe to reuse.
 */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * Identifies one independently-analyzed semantic state of a repository at a Git
 * ref. `snapshotId` is derived entirely from content/config (repository identity,
 * Git tree, and analyzer/schema fingerprints) — never from `createdAt`, machine
 * paths, or anything else that would make equal semantic states hash differently
 * across machines or runs.
 */
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
  /** Metadata only — excluded from `snapshotId` and from cache-key equality. */
  createdAt: string;
}

export type SnapshotRefKind = 'commit' | 'branch' | 'tag' | 'working-tree';

export interface SnapshotBuildRequest {
  /** The real repository being diffed; also where the on-disk snapshot cache lives. */
  repoDir: string;
  /** A Git ref (branch, tag, or commit SHA). Passed only as an argv element, never shell-interpolated. */
  ref: string;
  /**
   * When `ref` resolves to the currently checked-out branch and the working tree is
   * dirty, whether to include uncommitted changes in the snapshot. Defaults to false:
   * dirty working-tree snapshots are explicitly unsupported unless requested, and the
   * caller gets an `unsupported` boundary rather than a silently-wrong clean snapshot.
   */
  includeDirtyWorkingTree?: boolean;
  contractFingerprint?: string;
  /** Reuse a cache hit if one validates; set false to force a rebuild. */
  allowCache?: boolean;
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

export interface SnapshotBuildResult {
  status: SnapshotBuildStatus;
  descriptor: SemanticSnapshotDescriptor | null;
  /** Directory containing graph.db/bm25.db/meta.json/... for this snapshot, or null on failure. */
  artifactsDir: string | null;
  fromCache: boolean;
  boundaries: SnapshotBoundary[];
  durationMs: number;
  error?: string;
}

export type EntityChangeKind = 'added' | 'removed' | 'changed' | 'moved' | 'renamed' | 'unknown';

/**
 * A node-level delta between base and head. `moved`/`renamed` are only ever
 * produced by continuity.ts with proven evidence (see continuity certainty);
 * anything ambiguous is reported as `unknown` alongside a candidate pairing,
 * never silently upgraded to a rename.
 */
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
  /**
   * Present when continuity.ts found evidence linking this delta to one on
   * the opposite side. `certainty: 'proven'` only ever appears together with
   * `kind: 'moved' | 'renamed'` (the pair is merged into one delta).
   * `certainty: 'candidate'` appears on a `kind: 'removed' | 'added'` delta
   * left as-is because continuity was ambiguous — `continuityCandidates`
   * lists the opposite-side IDs that could not be told apart, so a caller can
   * show them without the diff ever silently guessing which one is right.
   */
  continuity?: EntityContinuity;
  continuityCandidates?: string[];
}

export type ContinuityCertainty = 'proven' | 'candidate';

export interface EntityContinuity {
  certainty: ContinuityCertainty;
  reason: string;
  /** Evidence that contributed to the correlation, e.g. 'content-fingerprint', 'git-rename-detection'. */
  evidenceKinds: string[];
}

export type RelationshipChangeKind = 'added' | 'removed' | 'changed';

export interface RelationshipEndpointState {
  certainty?: RelationshipCertainty;
  strategy?: string;
  evidenceRef?: string;
  confidence?: number;
}

/**
 * A relationship-level delta keyed by (canonical source ID, canonical target ID,
 * edge kind, call-site identity) — never by display name alone. Certainty/
 * strategy/evidence changes with identical endpoints still produce a `changed`
 * delta (see RelationshipDelta.changedFields).
 */
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

/**
 * Wraps `getApiDrift`'s own output (semantic/api-contracts/service.ts)
 * verbatim rather than re-deriving route identity or compatibility verdicts
 * here — this module never duplicates the pairing/verdict rules that
 * `semantic/api-contracts/compatibility.ts` already owns.
 */
export interface ContractDiffSection {
  findings: import('../semantic/api-contracts/types.js').ApiCompatibilityFinding[];
  coverage: { baseRoutes: number; headRoutes: number; consumerCoverageComplete: boolean };
}

export type FlowDeltaKind = 'added' | 'removed' | 'membership-changed' | 'path-changed';

export interface FlowDelta {
  kind: FlowDeltaKind;
  flowId: string;
  entryPointId?: string;
  details?: string;
}

/**
 * Both flow and cluster node IDs (pipeline/phases/flow-phase.ts,
 * cluster-phase.ts) are generated from an accumulating per-run enumeration
 * index rather than a fingerprint of their membership, so the same logical
 * flow/cluster is not guaranteed to get the same ID across two independent
 * analysis runs — even of the identical commit — whenever unrelated entry
 * points or directories elsewhere shift that count. Diffing them by ID today
 * would fabricate spurious added/removed deltas. Until that upstream ID
 * scheme is content-derived, both sections always report `supported: false`
 * rather than a diff a caller could mistake for a real one.
 */
export interface UnsupportedDiffSection {
  supported: false;
  reason: string;
}

export type FlowDiffSection = UnsupportedDiffSection | { supported: true; deltas: FlowDelta[] };
export type ClusterDiffSection = UnsupportedDiffSection;

export interface SemanticGraphDiff {
  base: SemanticSnapshotDescriptor;
  head: SemanticSnapshotDescriptor;
  nodes: EntityDelta[];
  relationships: RelationshipDelta[];
  contracts?: ContractDiffSection;
  flows: FlowDiffSection;
  clusters: ClusterDiffSection;
  coverage: AnalysisCoverage;
}

export interface CacheEntryMetadata {
  schemaVersion: number;
  descriptor: SemanticSnapshotDescriptor;
  createdAt: string;
  lastAccessedAt: string;
  sizeBytes: number;
}
