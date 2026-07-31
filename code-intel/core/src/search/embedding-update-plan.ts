export type EmbeddingUpdatePlan =
  | { mode: 'skip'; reason: 'disabled' | 'no-changes' }
  | { mode: 'full'; reason: 'forced' | 'change-set-unknown' | 'vector-missing' | 'fingerprint-or-state-stale' }
  | { mode: 'incremental'; paths: string[] };

export interface ResolveEmbeddingUpdatePlanArgs {
  enabled: boolean;
  force: boolean;
  changeSetKnown: boolean;
  changedPaths: string[];
  deletedPaths: string[];
  hasVectorDb: boolean;
  embeddingsNeedRebuild: boolean;
}

/** Resolve vector work independently from graph execution mode. */
export function resolveEmbeddingUpdatePlan(args: ResolveEmbeddingUpdatePlanArgs): EmbeddingUpdatePlan {
  if (!args.enabled) return { mode: 'skip', reason: 'disabled' };
  if (args.force) return { mode: 'full', reason: 'forced' };
  if (!args.changeSetKnown) return { mode: 'full', reason: 'change-set-unknown' };
  if (!args.hasVectorDb) return { mode: 'full', reason: 'vector-missing' };
  if (args.embeddingsNeedRebuild) return { mode: 'full', reason: 'fingerprint-or-state-stale' };

  const paths = [...new Set([...args.changedPaths, ...args.deletedPaths])].filter(Boolean);
  if (paths.length === 0) return { mode: 'skip', reason: 'no-changes' };
  return { mode: 'incremental', paths };
}
