/**
 * types.ts
 *
 * Cross-repository system flows: repository-local stable flows stitched
 * together across *evidence-backed* provider/consumer contract boundaries.
 *
 * A system flow is a static, graph-derived trace — never a runtime trace —
 * and only crosses a repository boundary through a modeled contract link.
 * Name-only matches (same method/class/event name) never produce an exact
 * continuation; they are reported separately as candidates.
 */

import type { AnalysisCertainty, AnalysisCoverage } from '../../shared/index.js';
import type { ContractKind } from '../types.js';

/** Bump when system-flow identity inputs or semantics change. */
export const SYSTEM_FLOW_VERSION = 'system-flow-v1';
/** Bump when stitching rules change in a way that can change results for equal inputs. */
export const STITCHER_VERSION = 'system-flow-stitcher-v1';
/** Bump when the persisted cache file shape changes. */
export const SYSTEM_FLOW_CACHE_SCHEMA_VERSION = 1;

/** One repository-local stable flow (from `flow-detection`, `flow-identity-v1`). */
export interface LocalFlowRecord {
  repositoryId: string;
  flowId: string;
  flowFingerprint?: string;
  /** Canonical entry symbol ID. */
  entrySymbolId: string;
  /** Ordered canonical step symbol IDs (entry first). */
  stepSymbolIds: string[];
}

/**
 * What proves a boundary. Only non-`name-match` evidence can yield an exact
 * continuation; `name-match` (e.g. same-named export/event types) is always a
 * candidate regardless of the link's own certainty label.
 */
export type BoundaryEvidence = 'http-route-fact' | 'event-topic' | 'graphql-operation' | 'grpc-method' | 'name-match';

/**
 * A directed cross-repository hop: control/data leaves `fromSymbolId` in one
 * repository and enters `toSymbolId` in another, through `contractId`.
 * For HTTP the hop is consumer -> provider (call site to route handler); for
 * events it is producer -> consumer (publisher to handler).
 */
export interface ContractBoundaryEdge {
  contractId: string;
  kind: ContractKind;
  providerRepositoryId: string;
  consumerRepositoryId: string;
  consumerId: string;
  fromRepositoryId: string;
  fromSymbolId?: string;
  toRepositoryId: string;
  toSymbolId?: string;
  certainty: AnalysisCertainty | 'legacy';
  evidence: BoundaryEvidence;
  /** Why an endpoint symbol could not be resolved, when one is missing. */
  unresolvedReason?: string;
}

export interface StitchRepositoryInput {
  repositoryId: string;
  /** Generation/snapshot identity the local flows were read from. */
  snapshotId: string;
  flowIdentityVersion?: string;
  /** False when this member's index/flows/contracts are stale, missing or partial. */
  coverageComplete: boolean;
  incompleteReason?: string;
  flows: LocalFlowRecord[];
}

export interface StitchLimits {
  /** Maximum repository hops (boundaries) in one system flow. */
  maxHops: number;
  /** Maximum segments in one system flow. */
  maxSegments: number;
  /** Maximum system flows emitted for the group. */
  maxSystemFlows: number;
  /** Maximum candidate continuations emitted for the group. */
  maxCandidates: number;
}

export const DEFAULT_STITCH_LIMITS: StitchLimits = Object.freeze({ maxHops: 4, maxSegments: 5, maxSystemFlows: 500, maxCandidates: 500 });

export interface StitchInput {
  repositories: StitchRepositoryInput[];
  boundaries: ContractBoundaryEdge[];
  limits?: Partial<StitchLimits>;
}

export interface SystemFlowBoundary {
  contractId: string;
  kind: ContractKind;
  providerRepositoryId: string;
  consumerRepositoryId: string;
  consumerId: string;
  certainty: AnalysisCertainty;
  evidence: BoundaryEvidence;
}

export interface SystemFlowSegment {
  repositoryId: string;
  /** Absent when the continuation entered a symbol that starts/belongs to no stable local flow. */
  localFlowId?: string;
  localFlowFingerprint?: string;
  entrySymbolId: string;
  exitSymbolId?: string;
  /** Ordered canonical step IDs of the local flow (entry only when `localFlowId` is absent). */
  stepSymbolIds: string[];
  boundaryToNext?: SystemFlowBoundary;
}

export type SystemFlowStopReason = 'end' | 'cycle' | 'hop-cap' | 'segment-cap' | 'partial-coverage' | 'missing-local-flow';

export interface SystemFlowStitchBoundary {
  kind: SystemFlowStopReason | 'unresolved-endpoint' | 'system-flow-cap' | 'candidate-cap';
  message: string;
  repositoryId?: string;
}

export interface SystemFlow {
  id: string;
  fingerprint: string;
  algorithmVersion: typeof SYSTEM_FLOW_VERSION;
  segments: SystemFlowSegment[];
  certainty: AnalysisCertainty;
  coverage: AnalysisCoverage;
  boundaries: SystemFlowStitchBoundary[];
}

/** A cross-repository continuation that is *not* exact enough to stitch. */
export interface CandidateContinuation {
  fromRepositoryId: string;
  fromFlowId: string;
  fromSymbolId?: string;
  toRepositoryId: string;
  toSymbolId?: string;
  contractId: string;
  kind: ContractKind;
  certainty: AnalysisCertainty | 'legacy';
  evidence: BoundaryEvidence;
  reason: string;
}

export interface StitchCounters {
  localFlows: number;
  boundaryEdges: number;
  /** Index probes for outgoing boundaries — proves indexed (not all-by-all) stitching. */
  boundaryLookups: number;
  segments: number;
  repositoryHops: number;
  candidates: number;
  capHits: number;
}

export interface StitchResult {
  stitcherVersion: typeof STITCHER_VERSION;
  flows: SystemFlow[];
  candidates: CandidateContinuation[];
  counters: StitchCounters;
  coverage: AnalysisCoverage;
  boundaries: SystemFlowStitchBoundary[];
}
