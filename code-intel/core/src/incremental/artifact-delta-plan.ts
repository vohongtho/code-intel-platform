/**
 * artifact-delta-plan.ts
 *
 * One shared plan, derived from a single SemanticDelta, that decides how
 * graph, BM25, vector, evidence, flow/cluster, and program-analysis artifacts
 * are each updated. No artifact independently guesses its own changed scope.
 */
import { resolveEmbeddingUpdatePlan, type EmbeddingUpdatePlan } from '../search/embedding-update-plan.js';
import type { AffectedArtifact, SemanticDelta } from './semantic-delta.js';

export type ArtifactUpdateMode = 'full' | 'incremental' | 'preserve';

export interface ArtifactDeltaPlan {
  requiresFullResolution: boolean;
  reason?: string;
  /** Files whose graph nodes/edges must be replaced (changed, deleted, or containing an invalidated fact). */
  affectedFiles: readonly string[];
  invalidatedFactIds: readonly string[];
  graph: ArtifactUpdateMode;
  bm25: ArtifactUpdateMode;
  evidence: ArtifactUpdateMode;
  flows: ArtifactUpdateMode;
  clusters: ArtifactUpdateMode;
  programAnalysis: ArtifactUpdateMode;
  vector: EmbeddingUpdatePlan;
}

export interface BuildArtifactDeltaPlanArgs {
  delta: SemanticDelta;
  vector: {
    enabled: boolean;
    force: boolean;
    hasVectorDb: boolean;
    embeddingsNeedRebuild: boolean;
  };
}

function modeFor(delta: SemanticDelta, artifact: AffectedArtifact): ArtifactUpdateMode {
  if (delta.requiresFullResolution) return 'full';
  return delta.affectedArtifacts.has(artifact) ? 'incremental' : 'preserve';
}

export function buildArtifactDeltaPlan(args: BuildArtifactDeltaPlanArgs): ArtifactDeltaPlan {
  const { delta, vector } = args;

  const affectedFileSet = new Set<string>([
    ...delta.changedFiles,
    ...delta.deletedFiles,
  ]);
  // invalidatedSymbols/References/CallSites carry factId only in this module's contract;
  // callers resolve factId -> filePath via the reverse-dependency index when materializing.

  const embeddingPlan = resolveEmbeddingUpdatePlan({
    enabled: vector.enabled,
    force: vector.force,
    changeSetKnown: !delta.requiresFullResolution,
    changedPaths: [...delta.changedFiles],
    deletedPaths: [...delta.deletedFiles],
    hasVectorDb: vector.hasVectorDb,
    embeddingsNeedRebuild: vector.embeddingsNeedRebuild,
  });

  return {
    requiresFullResolution: delta.requiresFullResolution,
    reason: delta.reason,
    affectedFiles: [...affectedFileSet].sort(),
    invalidatedFactIds: [...delta.invalidatedReferences, ...delta.invalidatedCallSites, ...delta.invalidatedSymbols].sort(),
    graph: modeFor(delta, 'graph'),
    bm25: modeFor(delta, 'bm25'),
    evidence: modeFor(delta, 'evidence'),
    flows: modeFor(delta, 'flows'),
    clusters: modeFor(delta, 'clusters'),
    programAnalysis: modeFor(delta, 'program-analysis'),
    vector: embeddingPlan,
  };
}
