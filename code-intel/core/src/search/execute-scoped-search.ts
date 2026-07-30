import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { textSearch } from './text-search.js';
import { hybridSearch } from './hybrid-search.js';
import type { Bm25Index } from './bm25-index.js';
import { getVectorDbPath } from '../storage/index.js';
import { loadRegistry } from '../storage/repo-registry.js';
import { loadGroup } from '../multi-repo/group-registry.js';
import { queryGroup } from '../multi-repo/group-query.js';

export type SearchMode = 'auto' | 'bm25' | 'vector' | 'hybrid';
export type RequestedSearchMode = 'auto' | 'bm25' | 'vector';
export type ActualSearchMode = 'bm25' | 'vector' | 'hybrid';
export type SearchScope = { type: 'repo' | 'group'; name: string };

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
      scope: SearchScope;
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
  scope?: SearchScope;
  repo?: string;
  group?: string;
  /** Include execution and ranking evidence in the response. */
  explain?: boolean;
};

function normalizeRequestedMode(mode: SearchMode | undefined): RequestedSearchMode {
  if (!mode || mode === 'hybrid') return 'auto';
  return mode;
}

export function normalizeSearchRequest(body: SearchRequest) {
  const { query, limit, mode, scope, repo, group, explain } = body;
  if (!query) {
    return {
      error: {
        status: 400,
        message: 'Missing query',
        hint: 'Provide { "query": "..." } in request body',
      },
    } as const;
  }
  if (scope && (repo || group)) {
    return {
      error: {
        status: 400,
        message: 'Ambiguous request shape',
        hint: 'Use either scope or legacy repo/group fields, not both',
      },
    } as const;
  }
  if (repo && group) {
    return {
      error: {
        status: 400,
        message: 'Ambiguous legacy scope',
        hint: 'Use either repo or group, not both',
      },
    } as const;
  }
  const normalizedScope = scope ?? (group ? { type: 'group' as const, name: group } : repo ? { type: 'repo' as const, name: repo } : undefined);
  return {
    query,
    limit: limit ?? 20,
    mode: normalizeRequestedMode(mode),
    scope: normalizedScope,
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

export type ExecuteScopedSearchDeps = {
  repoName: string;
  workspaceRoot?: string;
  ensureBm25Index: () => Bm25Index | null;
  getGraphForRepo: (requestedRepo: string | undefined) => Promise<KnowledgeGraph>;
};

export async function executeSearchRequest(
  body: SearchRequest,
  deps: ExecuteScopedSearchDeps,
  extra: { endpoint?: string; forceDeprecated?: boolean } = {},
): Promise<SearchExecResult> {
  const normalized = normalizeSearchRequest(body);
  if ('error' in normalized && normalized.error) {
    return { error: normalized.error };
  }

  const { query, limit, mode: requestedMode, scope, deprecated, explain } = normalized;
  const endpointDeprecated = extra.forceDeprecated || Boolean(extra.endpoint);
  const deprecatedFlag = deprecated || endpointDeprecated;
  const deprecation = deprecationFor({ deprecated: deprecatedFlag }, extra.endpoint);

  if (scope?.type === 'group') {
    const grp = loadGroup(scope.name);
    if (!grp) {
      return {
        error: {
          status: 404,
          message: `Group '${scope.name}' not found`,
          hint: 'Use /api/v1/groups to list available groups',
        },
      } as const;
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

  const requestedRepo = scope?.type === 'repo' ? scope.name : undefined;
  const g = await deps.getGraphForRepo(requestedRepo);
  const resolvedScope = scope ?? { type: 'repo' as const, name: requestedRepo ?? deps.repoName };
  const repoEntry = requestedRepo && requestedRepo !== deps.repoName
    ? loadRegistry().find((r) => r.id === requestedRepo || r.name === requestedRepo || r.path === requestedRepo)
    : null;
  const vdbPath = repoEntry ? getVectorDbPath(repoEntry.path) : (deps.workspaceRoot ? getVectorDbPath(deps.workspaceRoot) : undefined);
  const bm25 = (!requestedRepo || requestedRepo === deps.repoName) ? deps.ensureBm25Index() : null;
  const bm25Results = bm25 ? bm25.search(query, limit * 3) : null;

  if (requestedMode === 'bm25') {
    const results = (bm25Results ?? textSearch(g, query, limit)).slice(0, limit);
    return {
      body: {
        results,
        requestedMode,
        actualMode: 'bm25',
        searchMode: 'bm25',
        explanation: explain ? buildSearchExplanation(requestedMode, 'bm25', Boolean(vdbPath)) : undefined,
        scope: resolvedScope,
        vectorReady: Boolean(vdbPath),
        deprecated: deprecatedFlag,
        deprecation,
        total: results.length,
        offset: 0,
        limit,
        hasMore: false,
      },
    } as const;
  }

  const { results, searchMode } = await hybridSearch(g, query, limit, {
    vectorDbPath: vdbPath,
    bm25Results: bm25Results ?? undefined,
  });
  const actualMode = searchMode as ActualSearchMode;
  const fallbackReason = actualMode === 'bm25'
    ? 'VECTOR_INDEX_UNAVAILABLE' as const
    : undefined;

  return {
    body: {
      results,
      requestedMode,
      actualMode,
      searchMode: actualMode,
      fallbackReason,
      explanation: explain ? buildSearchExplanation(requestedMode, actualMode, actualMode !== 'bm25', fallbackReason) : undefined,
      scope: resolvedScope,
      vectorReady: actualMode !== 'bm25',
      deprecated: deprecatedFlag,
      deprecation,
      total: results.length,
      offset: 0,
      limit,
      hasMore: false,
    },
  } as const;
}
