import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { textSearch } from './text-search.js';
import { hybridSearch } from './hybrid-search.js';
import type { Bm25Index } from './bm25-index.js';
import { getVectorDbPath } from '../storage/index.js';
import { loadRegistry } from '../storage/repo-registry.js';
import { loadGroup } from '../multi-repo/group-registry.js';
import { queryGroup } from '../multi-repo/group-query.js';
import type { QueryScope, ResolvedQueryScope } from 'code-intel-shared';
import { resolveVectorRuntimeState, type VectorRuntimeState } from './vector-runtime-state.js';
import { loadMetadata } from '../storage/metadata.js';
import { getEmbeddingFingerprint } from './embedder.js';
import { getDefaultEmbeddingModel, getEmbeddingModel } from './embedding-model-registry.js';
import type { EmbeddingModelDescriptor } from './embedding-model-registry.js';
import { loadConfig, DEFAULT_CONFIG } from '../cli/init-wizard.js';
import { normalizeConfigEmbeddingModel } from '../cli/config-manager.js';

export type SearchMode = 'auto' | 'bm25' | 'vector' | 'hybrid';
export type RequestedSearchMode = 'auto' | 'bm25' | 'vector';
export type ActualSearchMode = 'bm25' | 'vector' | 'hybrid';
export type SearchScope = QueryScope;

export type SearchFallbackReason =
  | 'VECTOR_INDEX_UNAVAILABLE'
  | 'VECTOR_QUERY_FAILED';

export type SearchExplanation = {
  requestedMode: RequestedSearchMode;
  actualMode: ActualSearchMode;
  fallbackReason?: SearchFallbackReason;
  vectorReady: boolean;
  ranking: 'BM25' | 'VECTOR' | 'RECIPROCAL_RANK_FUSION';
  summary: string;
};

export function buildSearchExplanation(
  requestedMode: RequestedSearchMode,
  actualMode: ActualSearchMode,
  vectorReady: boolean,
  fallbackReason?: SearchFallbackReason,
): SearchExplanation {
  const ranking = actualMode === 'hybrid'
    ? 'RECIPROCAL_RANK_FUSION'
    : actualMode === 'vector' ? 'VECTOR' : 'BM25';
  const summary = fallbackReason
    ? `Requested ${requestedMode}; executed ${actualMode} because ${fallbackReason}.`
    : `Requested ${requestedMode}; executed ${actualMode} using ${ranking}.`;
  return { requestedMode, actualMode, fallbackReason, vectorReady, ranking, summary };
}

export type SearchExecResult =
  | { error: { status: number; message: string; hint?: string } }
  | {
    body: {
      results: unknown[];
      perRepo?: unknown[];
      requestedMode: RequestedSearchMode;
      actualMode: ActualSearchMode;
      searchMode: ActualSearchMode;
      fallbackReason?: SearchFallbackReason;
      explanation?: SearchExplanation;
      scope: ResolvedQueryScope;
      vectorReady: boolean;
      deprecated: boolean;
      deprecation?: string;
      total: number;
      offset: number;
      limit: number;
      hasMore: boolean;
    };
  };

export type SearchRequest = {
  query?: string;
  limit?: number;
  mode?: SearchMode;
  scope?: SearchScope | Record<string, unknown>;
  repoId?: string;
  repo?: string;
  group?: string;
  explain?: boolean;
};

export type SelectorSource =
  | 'none'
  | 'canonical-scope'
  | 'canonical-repo-id'
  | 'legacy-repo'
  | 'legacy-group';

function normalizeRequestedMode(mode: SearchMode | undefined): RequestedSearchMode {
  if (!mode || mode === 'hybrid') return 'auto';
  return mode;
}

export function validateSearchScope(scope: unknown):
  | { value: SearchScope }
  | { error: { status: number; message: string; hint?: string } } {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    return { error: { status: 400, message: 'Invalid scope', hint: 'scope must be an object' } };
  }
  const raw = scope as Record<string, unknown>;
  if (raw.type !== 'repo' && raw.type !== 'group') {
    return { error: { status: 400, message: 'Invalid scope.type', hint: 'scope.type must be "repo" or "group"' } };
  }
  if (raw.type === 'repo') {
    if (typeof raw.repoId !== 'string' || raw.repoId.trim().length === 0) {
      return { error: { status: 400, message: 'Invalid scope.repoId', hint: 'scope.repoId is required for repo scope' } };
    }
    return { value: { type: 'repo', repoId: raw.repoId } };
  }
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
    return { error: { status: 400, message: 'Invalid scope.name', hint: 'scope.name is required for group scope' } };
  }
  return { value: { type: 'group', name: raw.name } };
}

export function normalizeSearchRequest(body: SearchRequest) {
  const { query, limit, mode, scope, repoId, repo, group, explain } = body;
  if (!query) {
    return { error: { status: 400, message: 'Missing query', hint: 'Provide { "query": "..." } in request body' } } as const;
  }
  if (scope && (repoId || repo || group)) {
    return { error: { status: 400, message: 'Ambiguous request shape', hint: 'Use either scope or flat scope fields, not both' } } as const;
  }
  if (repoId && (repo || group)) {
    return { error: { status: 400, message: 'Ambiguous flat scope', hint: 'Use repoId or legacy repo/group, not both' } } as const;
  }
  if (repo && group) {
    return { error: { status: 400, message: 'Ambiguous legacy scope', hint: 'Use either repo or group, not both' } } as const;
  }
  
  let normalizedScope: SearchScope | undefined;
  let selectorSource: SelectorSource;
  
  if (scope !== undefined) {
    const validated = validateSearchScope(scope);
    if ('error' in validated) return { error: validated.error } as const;
    normalizedScope = validated.value;
    selectorSource = 'canonical-scope';
  } else if (group) {
    normalizedScope = { type: 'group' as const, name: group };
    selectorSource = 'legacy-group';
  } else if (repoId) {
    normalizedScope = { type: 'repo' as const, repoId };
    selectorSource = 'canonical-repo-id';
  } else if (repo) {
    normalizedScope = { type: 'repo' as const, repoId: repo };
    selectorSource = 'legacy-repo';
  } else {
    normalizedScope = undefined;
    selectorSource = 'none';
  }
  
  return {
    query,
    limit: limit ?? 20,
    mode: normalizeRequestedMode(mode),
    scope: normalizedScope,
    selectorSource,
    deprecated: Boolean(repo || group || mode === 'hybrid'),
    explain: explain === true,
  } as const;
}

export function deprecationFor(req: { deprecated?: boolean }, endpoint?: string): string | undefined {
  if (!req.deprecated && !endpoint) return undefined;
  return endpoint
    ? `${endpoint} is deprecated; use POST /api/v1/search with { query, limit, mode, scope }.`
    : 'Legacy repo/group request shape or hybrid mode is deprecated; use { query, limit, mode: auto|bm25|vector, scope }.';
}

/**
 * Resolve vector runtime state for a repository path.
 * 
 * This is the authoritative vector readiness check for repo-scoped search.
 * Loads metadata, gets the configured embedding descriptor, and validates
 * vector execution eligibility through the runtime state contract.
 * 
 * @param repoPath - repository workspace root
 * @param vectorDbPath - path to vector.db
 * @returns resolved runtime state with ready flag and reason
 */
async function resolveRepoVectorRuntimeState(
  repoPath: string,
  vectorDbPath: string,
): Promise<VectorRuntimeState> {
  try {
    // Load repository metadata
    const metadata = loadMetadata(repoPath);

    // Get configured embedding descriptor
    const config = normalizeConfigEmbeddingModel(loadConfig() ?? DEFAULT_CONFIG);
    const descriptor = getEmbeddingModel(config.embeddings.model) ?? getDefaultEmbeddingModel();

    // Calculate runtime fingerprint
    const runtimeFingerprint = getEmbeddingFingerprint({ descriptor });

    // Resolve vector runtime state
    return await resolveVectorRuntimeState({
      vectorDbPath,
      descriptor,
      runtimeFingerprint,
      metadata: metadata ?? undefined,
    });
  } catch (err) {
    // If anything fails, return unavailable state
    return {
      status: 'unavailable',
      ready: false,
      vectorDbPath,
      reason: `Failed to resolve vector runtime state: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export interface RepoSearchContext {
  graph: KnowledgeGraph;
  bm25Index: Bm25Index | null;
  vectorDbPath?: string;
}

export type ExecuteScopedSearchDeps = {
  repoName: string;
  workspaceRoot?: string;
  ensureBm25Index: () => Bm25Index | null;
  getGraphForRepo: (requestedRepo: string | undefined) => Promise<KnowledgeGraph>;
  getRepoSearchContext?: (requestedRepo: string | undefined) => Promise<RepoSearchContext>;
};

export async function executeSearchRequest(
  body: SearchRequest,
  deps: ExecuteScopedSearchDeps,
  extra: { endpoint?: string; forceDeprecated?: boolean } = {},
): Promise<SearchExecResult> {
  const normalized = normalizeSearchRequest(body);
  if ('error' in normalized && normalized.error) return { error: normalized.error };

  const { query, limit, mode: requestedMode, scope, selectorSource, deprecated, explain } = normalized;
  const endpointDeprecated = extra.forceDeprecated || Boolean(extra.endpoint);
  const deprecatedFlag = deprecated || endpointDeprecated;
  const deprecation = deprecationFor({ deprecated: deprecatedFlag }, extra.endpoint);

  if (scope?.type === 'group') {
    const grp = loadGroup(scope.name);
    if (!grp) {
      return { error: { status: 404, message: `Group '${scope.name}' not found`, hint: 'Use /api/v1/groups to list available groups' } } as const;
    }
    const groupMode = requestedMode === 'auto' ? 'hybrid' : requestedMode;
    const { perRepo, merged, searchMode, vectorReady } = await queryGroup(grp, query, limit, { mode: groupMode });
    const actualMode = searchMode as ActualSearchMode;
    const fallbackReason = requestedMode !== 'bm25' && actualMode === 'bm25'
      ? 'VECTOR_INDEX_UNAVAILABLE' as const
      : undefined;
    return {
      body: {
        results: merged,
        perRepo,
        requestedMode,
        actualMode,
        searchMode: actualMode,
        fallbackReason,
        explanation: explain ? buildSearchExplanation(requestedMode, actualMode, vectorReady, fallbackReason) : undefined,
        scope,
        vectorReady,
        deprecated: deprecatedFlag,
        deprecation,
        total: merged.length,
        offset: 0,
        limit,
        hasMore: false,
      },
    } as const;
  }

  const registry = loadRegistry();
  const defaultRepoId = registry.find((repo) => repo.name === deps.repoName || (deps.workspaceRoot && repo.path === deps.workspaceRoot))?.id ?? deps.repoName;
  let requestedRepo: string | undefined;
  let resolvedScope: ResolvedQueryScope;
  
  if (!scope) {
    requestedRepo = undefined;
    resolvedScope = { type: 'repo', repoId: defaultRepoId, repoName: deps.repoName };
  } else if (scope.type === 'repo') {
    // Try exact stable ID match first (works for all selector sources)
    const exactRepo = registry.find((repo) => repo.id === scope.repoId);
    
    if (exactRepo) {
      // Found by stable ID
      requestedRepo = exactRepo.id;
      resolvedScope = { type: 'repo', repoId: exactRepo.id, repoName: exactRepo.name };
    } else if (selectorSource === 'legacy-repo') {
      // Legacy repo selector: allow compatibility fallback to name/path
      const matches = registry.filter((repo) => repo.name === scope.repoId || repo.path === scope.repoId);
      if (matches.length > 1) {
        return { error: { status: 400, message: `Repo selector '${scope.repoId}' is ambiguous`, hint: 'Use stable repoId instead of repo name/path' } } as const;
      }
      if (matches.length === 0) {
        return { error: { status: 404, message: `Repo '${scope.repoId}' not found`, hint: 'Use /api/v1/repos to list available repositories' } } as const;
      }
      const entry = matches[0]!;
      requestedRepo = entry.id;
      resolvedScope = { type: 'repo', repoId: entry.id, repoName: entry.name };
    } else {
      // Canonical selectors (canonical-scope, canonical-repo-id): stable ID only, no fallback
      return { error: { status: 404, message: `Repo '${scope.repoId}' not found`, hint: 'Use /api/v1/repos to list available repositories' } } as const;
    }
  } else {
    requestedRepo = undefined;
    const groupScope = scope as Extract<SearchScope, { type: 'group' }>;
    resolvedScope = { type: 'group', name: groupScope.name };
  }
  const searchContext = deps.getRepoSearchContext
    ? await deps.getRepoSearchContext(requestedRepo)
    : null;
  const graph = searchContext?.graph ?? await deps.getGraphForRepo(requestedRepo);
  const repoEntry = requestedRepo && requestedRepo !== deps.repoName
    ? registry.find((repo) => repo.id === requestedRepo)
    : null;
  const vectorDbPath = searchContext?.vectorDbPath ?? (repoEntry
    ? getVectorDbPath(repoEntry.path)
    : deps.workspaceRoot
      ? getVectorDbPath(deps.workspaceRoot)
      : undefined);
  const bm25 = searchContext?.bm25Index
    ?? ((!requestedRepo || requestedRepo === deps.repoName) ? deps.ensureBm25Index() : null);
  const bm25Results = bm25 ? bm25.search(query, limit * 3) : null;

  // Resolve vector runtime state for accurate readiness and fallback reporting
  const repoPath = repoEntry?.path ?? deps.workspaceRoot;
  const vectorRuntimeState = vectorDbPath && repoPath
    ? await resolveRepoVectorRuntimeState(repoPath, vectorDbPath)
    : null;

  if (requestedMode === 'bm25') {
    const compactResults = (bm25Results ?? textSearch(graph, query, limit)).slice(0, limit);
    const results = compactResults.map((result, rank) => explain
      ? { ...result, evidence: { lexicalScore: result.score, bm25Rank: rank + 1, finalScore: result.score } }
      : result);
    return {
      body: {
        results,
        requestedMode,
        actualMode: 'bm25',
        searchMode: 'bm25',
        explanation: explain ? buildSearchExplanation(requestedMode, 'bm25', vectorRuntimeState?.ready ?? false) : undefined,
        scope: resolvedScope,
        vectorReady: vectorRuntimeState?.ready ?? false,
        deprecated: deprecatedFlag,
        deprecation,
        total: results.length,
        offset: 0,
        limit,
        hasMore: false,
      },
    } as const;
  }

  // Call hybridSearch with validated descriptor if vector is ready
  const { results, searchMode, vectorStatus } = await hybridSearch(graph, query, limit, {
    vectorDbPath: vectorRuntimeState?.ready ? vectorDbPath : undefined,
    descriptor: vectorRuntimeState?.descriptor,
    bm25Results: bm25Results ?? undefined,
    explainResults: explain,
  });
  const actualMode = searchMode as ActualSearchMode;
  
  // Map runtime state status to fallback reason
  let fallbackReason: SearchFallbackReason | undefined;
  if (actualMode === 'bm25' && requestedMode !== 'bm25') {
    if (vectorRuntimeState?.status === 'missing' || vectorRuntimeState?.status === 'empty') {
      fallbackReason = 'VECTOR_INDEX_UNAVAILABLE';
    } else if (vectorRuntimeState?.status === 'corrupt' || vectorRuntimeState?.status === 'unavailable' || vectorStatus === 'failed') {
      fallbackReason = 'VECTOR_QUERY_FAILED';
    } else if (vectorRuntimeState?.status === 'incompatible' || vectorRuntimeState?.status === 'stale') {
      fallbackReason = 'VECTOR_INDEX_UNAVAILABLE';
    } else {
      fallbackReason = vectorStatus === 'failed' ? 'VECTOR_QUERY_FAILED' : 'VECTOR_INDEX_UNAVAILABLE';
    }
  }
  
  const vectorReady = vectorRuntimeState?.ready ?? false;

  return {
    body: {
      results,
      requestedMode,
      actualMode,
      searchMode: actualMode,
      fallbackReason,
      explanation: explain ? buildSearchExplanation(requestedMode, actualMode, vectorReady, fallbackReason) : undefined,
      scope: resolvedScope,
      vectorReady,
      deprecated: deprecatedFlag,
      deprecation,
      total: results.length,
      offset: 0,
      limit,
      hasMore: false,
    },
  } as const;
}
