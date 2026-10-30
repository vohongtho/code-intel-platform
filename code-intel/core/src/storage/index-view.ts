import fs from 'node:fs';
import path from 'node:path';
import type { IndexSnapshot } from './index-snapshot.js';
import type { SemanticSnapshotDescriptor, SnapshotCapabilities } from '../snapshots/types.js';

/**
 * One immutable, transport-independent read source: either the active Generation
 * V2 (or legacy) index, or a semantic snapshot of a committed ref. This is an
 * adapter over artifacts that already exist — it never copies, writes, or
 * publishes anything — so every read in one request can be served from exactly
 * one coherent set of graph/BM25/vector/evidence files.
 *
 * Invariant: a `semantic-snapshot` view's artifact paths all point inside that
 * snapshot's cache entry. Nothing in a snapshot view refers to the active
 * generation, so a caller cannot accidentally mix current-index vectors or
 * evidence into an alternate-ref answer.
 */
export type ReadIndexViewKind = 'generation' | 'semantic-snapshot';

export type IndexViewBoundaryKind =
  | 'unknown-ref'
  | 'snapshot-not-built'
  | 'snapshot-build-failed'
  | 'snapshot-unsupported'
  | 'missing-index'
  | 'missing-content'
  | 'missing-vector'
  | 'missing-evidence';

export interface IndexViewBoundary {
  kind: IndexViewBoundaryKind;
  message: string;
}

export interface ReadIndexView {
  kind: ReadIndexViewKind;
  /** Generation ID for `generation`; content-derived snapshot ID for `semantic-snapshot`. */
  identity: string;
  repositoryRoot: string;
  /** Present for snapshot views (canonical Git identity); generation views leave it undefined. */
  repositoryIdentity?: string;
  /** The ref as the caller asked for it (snapshot views only). */
  ref?: string;
  commit?: string;
  gitTree?: string;
  graphDbPath: string;
  bm25DbPath?: string;
  vectorDbPath?: string;
  evidenceDbPath?: string;
  metadataPath: string;
  /** The directory every artifact path above lives in. */
  artifactsDir: string;
  descriptor: SemanticSnapshotDescriptor | null;
  capabilities: SnapshotCapabilities;
  /** How the view was obtained; `cached` means no Git materialization or analysis ran. */
  resolution: 'active' | 'cached' | 'built';
  boundaries: readonly IndexViewBoundary[];
  /** Releases the read pin (no-op for generation views). Idempotent. */
  release(): void;
}

/** Compact identity attached to responses served from a non-current view. */
export interface IndexViewSummary {
  kind: ReadIndexViewKind;
  identity: string;
  ref?: string;
  commit?: string;
  gitTree?: string;
  resolution: ReadIndexView['resolution'];
  privacyProfile: SnapshotCapabilities['privacyProfile'];
  capabilities: { sourceContent: boolean; bm25: boolean; vector: boolean; evidence: boolean };
  boundaries?: readonly IndexViewBoundary[];
}

export function summarizeIndexView(view: ReadIndexView): IndexViewSummary {
  return {
    kind: view.kind,
    identity: view.identity,
    ...(view.ref !== undefined ? { ref: view.ref } : {}),
    ...(view.commit ? { commit: view.commit } : {}),
    ...(view.gitTree ? { gitTree: view.gitTree } : {}),
    resolution: view.resolution,
    privacyProfile: view.capabilities.privacyProfile,
    capabilities: {
      sourceContent: view.capabilities.sourceContent,
      bm25: view.capabilities.bm25,
      vector: view.capabilities.vector,
      evidence: view.capabilities.evidence,
    },
    ...(view.boundaries.length > 0 ? { boundaries: view.boundaries } : {}),
  };
}

const NOOP = () => {};

/** Wraps the active generation's `IndexSnapshot` (no pin needed: generation dirs are never deleted under a reader). */
export function generationIndexView(snapshot: IndexSnapshot): ReadIndexView {
  const exists = (p: string | undefined) => (p && fs.existsSync(p) ? p : undefined);
  const bm25DbPath = exists(snapshot.bm25DbPath);
  const evidenceDbPath = exists(snapshot.evidenceDbPath);
  return Object.freeze({
    kind: 'generation' as const,
    identity: snapshot.generationId,
    repositoryRoot: snapshot.repositoryRoot,
    graphDbPath: snapshot.graphDbPath,
    bm25DbPath,
    vectorDbPath: snapshot.vectorDbPath,
    evidenceDbPath,
    metadataPath: snapshot.metadataPath,
    artifactsDir: snapshot.generationDir,
    descriptor: null,
    capabilities: {
      privacyProfile: 'full' as const,
      sourceContent: true,
      bm25: Boolean(bm25DbPath),
      bm25Content: bm25DbPath ? 'full' as const : 'none' as const,
      // Readiness is decided per query by the vector runtime state; the generation owns its vectors.
      vector: fs.existsSync(snapshot.vectorDbPath),
      evidence: Boolean(evidenceDbPath),
      protocolContracts: false,
    },
    resolution: 'active' as const,
    boundaries: [],
    release: NOOP,
  });
}

export function snapshotIndexView(args: {
  repositoryRoot: string;
  ref: string;
  artifactsDir: string;
  descriptor: SemanticSnapshotDescriptor;
  capabilities: SnapshotCapabilities;
  resolution: 'cached' | 'built';
  release: () => void;
}): ReadIndexView {
  const { artifactsDir, capabilities } = args;
  const artifact = (name: string) => path.join(artifactsDir, name);
  const boundaries: IndexViewBoundary[] = [];
  if (!capabilities.sourceContent) {
    boundaries.push({ kind: 'missing-content', message: `Snapshot was imported with privacy profile '${capabilities.privacyProfile}'; indexed source content is unavailable.` });
  }
  return Object.freeze({
    kind: 'semantic-snapshot' as const,
    identity: args.descriptor.snapshotId,
    repositoryRoot: args.repositoryRoot,
    repositoryIdentity: args.descriptor.repositoryIdentity,
    ref: args.ref,
    commit: args.descriptor.commit,
    gitTree: args.descriptor.gitTree,
    graphDbPath: artifact('graph.db'),
    bm25DbPath: capabilities.bm25 ? artifact('bm25.db') : undefined,
    // Only this snapshot's own vectors, and only when it declares them ready.
    vectorDbPath: capabilities.vector ? artifact('vector.db') : undefined,
    evidenceDbPath: capabilities.evidence ? artifact('evidence.db') : undefined,
    metadataPath: artifact('meta.json'),
    artifactsDir,
    descriptor: args.descriptor,
    capabilities,
    resolution: args.resolution,
    boundaries,
    release: args.release,
  });
}
