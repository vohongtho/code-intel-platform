import path from 'node:path';
import { createKnowledgeGraph, type KnowledgeGraph } from '../graph/knowledge-graph.js';
import { DbManager } from '../storage/db-manager.js';
import { loadGraphFromDB } from '../multi-repo/graph-from-db.js';
import { getApiDrift } from '../semantic/api-contracts/service.js';
import { detectRenamedFiles } from './git-materializer.js';
import { DEFAULT_SNAPSHOT_CACHE_POLICY, getOrBuildSnapshot, type SnapshotCachePolicy } from './cache.js';
import { diffEntitiesWithContinuity, diffRelationships } from './graph-diff.js';
import { normalizeGraphForDiff } from './normalizer.js';
import { readContentFingerprints } from './content-fingerprints.js';
import type { SemanticGraphDiff, SnapshotBoundary, SnapshotBuildRequest, SnapshotBuildResult } from './types.js';

export interface GraphDiffRequest {
  repoDir: string;
  base: string;
  head: string;
  /** Include API-contract deltas (delegated to semantic/api-contracts). Default true. */
  includeContracts?: boolean;
  /** Default true; set false to force a full rebuild of both sides. */
  allowCache?: boolean;
  cachePolicy?: SnapshotCachePolicy;
}

export interface GraphDiffResponse {
  /**
   * Non-null only when both sides built/loaded successfully. A failed or
   * unsupported side never produces a diff object — see `base`/`head` for the
   * reason — so a caller cannot mistake "we couldn't compare" for "nothing
   * changed."
   */
  diff: SemanticGraphDiff | null;
  base: SnapshotBuildResult;
  head: SnapshotBuildResult;
}

async function loadSnapshotGraph(artifactsDir: string): Promise<KnowledgeGraph> {
  const graph = createKnowledgeGraph();
  const db = new DbManager(path.join(artifactsDir, 'graph.db'), true);
  await db.init();
  try {
    await loadGraphFromDB(graph, db);
  } finally {
    db.close();
  }
  return graph;
}

function boundaryReasons(result: SnapshotBuildResult, side: 'base' | 'head'): string[] {
  const reasons = result.boundaries.map((boundary: SnapshotBoundary) => `${side} ${boundary.kind}: ${boundary.message}`);
  if (result.error) reasons.push(`${side}: ${result.error}`);
  return reasons;
}

function isUsable(result: SnapshotBuildResult): result is SnapshotBuildResult & { artifactsDir: string; descriptor: NonNullable<SnapshotBuildResult['descriptor']> } {
  return (result.status === 'built' || result.status === 'cached') && Boolean(result.artifactsDir) && Boolean(result.descriptor);
}

function buildRequest(repoDir: string, ref: string, allowCache: boolean | undefined): SnapshotBuildRequest {
  return { repoDir, ref, allowCache };
}

/**
 * Builds/loads both sides (in parallel; each independently cached) and, only
 * if both are trustworthy, produces the normalized semantic diff between
 * them. Read-only throughout: nothing here calls any Generation V2
 * publication code path, and both snapshot builds are isolated (see
 * snapshot-builder.ts) — this function cannot mutate `repoDir`'s current
 * generation, its working tree, or its Git HEAD/index, on success or failure.
 */
export async function computeSemanticGraphDiff(request: GraphDiffRequest): Promise<GraphDiffResponse> {
  const policy = request.cachePolicy ?? DEFAULT_SNAPSHOT_CACHE_POLICY;
  const [base, head] = await Promise.all([
    getOrBuildSnapshot(buildRequest(request.repoDir, request.base, request.allowCache), policy),
    getOrBuildSnapshot(buildRequest(request.repoDir, request.head, request.allowCache), policy),
  ]);

  const incompleteReasons = [...boundaryReasons(base, 'base'), ...boundaryReasons(head, 'head')];

  if (!isUsable(base) || !isUsable(head)) {
    // Never fabricate a diff (and never fall back to "no semantic impact")
    // when either side failed or is unsupported — `base`/`head` boundaries say why.
    return { diff: null, base, head };
  }

  const baseGraph = await loadSnapshotGraph(base.artifactsDir);
  const headGraph = await loadSnapshotGraph(head.artifactsDir);
  const baseNormalized = normalizeGraphForDiff(baseGraph, readContentFingerprints(base.artifactsDir));
  const headNormalized = normalizeGraphForDiff(headGraph, readContentFingerprints(head.artifactsDir));

  let renamedFiles: Map<string, string> | undefined;
  if (base.descriptor.commit && head.descriptor.commit) {
    try {
      renamedFiles = detectRenamedFiles(request.repoDir, base.descriptor.commit, head.descriptor.commit);
    } catch {
      // Best-effort corroborating evidence only; continuity still works without it.
    }
  }

  const nodes = diffEntitiesWithContinuity(baseNormalized, headNormalized, renamedFiles);
  const relationships = diffRelationships(baseNormalized, headNormalized);

  let contracts: SemanticGraphDiff['contracts'];
  if (request.includeContracts !== false) {
    try {
      const drift = getApiDrift(baseGraph, headGraph, request.repoDir);
      contracts = { findings: drift.findings, coverage: drift.coverage };
      if (!drift.coverage.consumerCoverageComplete) {
        incompleteReasons.push('api-contract consumer coverage is incomplete');
      }
    } catch (error) {
      incompleteReasons.push(`api-contract diff failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const diff: SemanticGraphDiff = {
    base: base.descriptor,
    head: head.descriptor,
    nodes,
    relationships,
    contracts,
    flows: { supported: false, reason: 'Flow node identity (pipeline/phases/flow-phase.ts) is a per-run enumeration index, not a content fingerprint, so it is not guaranteed stable across independent analysis runs.' },
    clusters: { supported: false, reason: 'Cluster node identity (pipeline/phases/cluster-phase.ts) is a per-run enumeration index, not a content fingerprint, so it is not guaranteed stable across independent analysis runs.' },
    coverage: {
      complete: incompleteReasons.length === 0,
      examinedCount: nodes.length + relationships.length,
      incompleteReasons,
    },
  };

  return { diff, base, head };
}
