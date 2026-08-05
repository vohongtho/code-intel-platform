import type { CodeNode, CodeEdge, CountGroup, GQLResult, GQLResultKind, QueryScope, ResolvedQueryScope } from 'code-intel-shared';
import type { SearchResult, CurrentUser, AppConfig, SearchMode, SearchScope, EmbeddingModelCatalog } from '../state/types';

export class InvalidGQLResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGQLResultError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeCountGroup(value: unknown): CountGroup {
  if (!isRecord(value) || typeof value.key !== 'string' || typeof value.count !== 'number' || !Number.isInteger(value.count) || value.count < 0) {
    throw new InvalidGQLResultError('Invalid GQL result: malformed group entry');
  }
  return { key: value.key, count: value.count };
}

function inferLegacyGQLResultKind(value: Record<string, unknown>): GQLResultKind {
  if (typeof value.kind === 'string') {
    if (value.kind === 'nodes' || value.kind === 'traversal' || value.kind === 'path' || value.kind === 'aggregate') return value.kind;
    throw new InvalidGQLResultError(`Invalid GQL result: unknown kind "${value.kind}"`);
  }
  if (Array.isArray(value.groups)) return 'aggregate';
  if (Array.isArray(value.path) || value.path === null) return 'path';
  if (Array.isArray(value.edges) && value.edges.length > 0) return 'traversal';
  return 'nodes';
}

export function normalizeGQLResult(value: unknown): GQLResult {
  if (!isRecord(value)) throw new InvalidGQLResultError('Invalid GQL result: expected object');

  const executionTimeMs = value.executionTimeMs;
  const truncated = value.truncated;
  const totalCount = value.totalCount;

  if (typeof executionTimeMs !== 'number' || !Number.isFinite(executionTimeMs) || executionTimeMs < 0) {
    throw new InvalidGQLResultError('Invalid GQL result: executionTimeMs must be a non-negative number');
  }
  if (typeof truncated !== 'boolean') {
    throw new InvalidGQLResultError('Invalid GQL result: truncated must be a boolean');
  }
  if (typeof totalCount !== 'number' || !Number.isInteger(totalCount) || totalCount < 0) {
    throw new InvalidGQLResultError('Invalid GQL result: totalCount must be a non-negative integer');
  }

  const nodes = Array.isArray(value.nodes) ? value.nodes as CodeNode[] : [];
  const edges = Array.isArray(value.edges) ? value.edges as CodeEdge[] : [];
  const groups = Array.isArray(value.groups) ? value.groups.map(normalizeCountGroup) : [];
  const rawPath = value.path;
  const path = Array.isArray(rawPath) ? rawPath as CodeNode[] : rawPath == null ? null : (() => {
    throw new InvalidGQLResultError('Invalid GQL result: path must be an array or null');
  })();
  const kind = inferLegacyGQLResultKind(value);

  return {
    kind,
    nodes,
    edges,
    groups,
    path,
    executionTimeMs,
    truncated,
    totalCount,
    format: value.format === 'json' ? 'json' : undefined,
  };
}

export interface AuthStatus {
  authenticated: boolean;
  user?: CurrentUser;
  authMethod?: 'session' | 'token';
}

export interface NodeInspectInfo {
  node: CodeNode;
  callers: { id: string; name?: string; weight?: number }[];
  callees: { id: string; name?: string; weight?: number }[];
  imports: { id: string; name?: string }[];
  importedBy: { id: string; name?: string }[];
  extends: { id: string; name?: string }[];
  implementsEdges: { id: string; name?: string }[];
  members: { id: string; name?: string; kind?: string }[];
  cluster?: string;
}

export interface BlastRadiusResult {
  target: string;
  affectedCount: number;
  affected: { id: string; name: string; kind: string; depth: number }[];
}

export interface GrepHit {
  file: string;
  line: number;
  text: string;
}

export interface SearchResponse {
  results: SearchResult[];
  searchMode: SearchMode;
  scope?: ResolvedQueryScope;
  deprecated?: boolean;
  deprecation?: string;
  vectorReady?: boolean;
  hasMore?: boolean;
  total?: number;
  offset?: number;
  limit?: number;
}

export interface SearchRequest {
  query: string;
  limit?: number;
  mode?: SearchMode;
  scope?: SearchScope;
}

export interface ResolvedRepoRef {
  repoId: string;
  repoName: string;
}

export interface ConfigValidationError {
  path: string;
  reason: string;
  hint: string;
}

export class ApiClient {
  constructor(private baseUrl: string) {}

  private csrfToken: string | null = null;

  private async getCsrfToken(): Promise<string> {
    if (this.csrfToken) return this.csrfToken;
    const res = await fetch(`${this.baseUrl}/auth/csrf-token`, { credentials: 'include' });
    const data = await res.json() as { csrfToken: string };
    this.csrfToken = data.csrfToken;
    return this.csrfToken;
  }

  // ── Auth ───────────────────────────────────────────────────────────────────

  async bootstrapStatus(): Promise<{ needsBootstrap: boolean }> {
    const res = await fetch(`${this.baseUrl}/auth/bootstrap-status`, { credentials: 'include' });
    if (!res.ok) return { needsBootstrap: false };
    return res.json() as Promise<{ needsBootstrap: boolean }>;
  }

  async bootstrap(username: string, password: string): Promise<{ user: CurrentUser }> {
    const csrfToken = await this.getCsrfToken();
    const res = await fetch(`${this.baseUrl}/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(body?.error?.message ?? 'Bootstrap failed');
    }
    return res.json() as Promise<{ user: CurrentUser }>;
  }

  async login(username: string, password: string, rememberMe = false): Promise<{ user: CurrentUser }> {
    const csrfToken = await this.getCsrfToken();
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ username, password, rememberMe }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(body?.error?.message ?? 'Login failed');
    }
    return res.json() as Promise<{ user: CurrentUser }>;
  }

  async logout(): Promise<void> {
    const csrfToken = await this.getCsrfToken();
    await fetch(`${this.baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken },
      credentials: 'include',
    });
    this.csrfToken = null;
  }

  async authStatus(): Promise<AuthStatus> {
    const res = await fetch(`${this.baseUrl}/auth/status`, {
      credentials: 'include',
    });
    if (!res.ok) return { authenticated: false };
    return res.json() as Promise<AuthStatus>;
  }

  async getConfig(): Promise<{ config: AppConfig }> {
    const res = await fetch(`${this.baseUrl}/api/v1/config`, { credentials: 'include' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(body?.error?.message ?? 'Failed to load config');
    }
    return res.json() as Promise<{ config: AppConfig }>;
  }

  async saveConfig(config: AppConfig): Promise<{ config: AppConfig }> {
    const csrfToken = await this.getCsrfToken();
    const res = await fetch(`${this.baseUrl}/api/v1/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ config }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: { message?: string }; validationErrors?: ConfigValidationError[] };
      const error = new Error(body?.error?.message ?? 'Failed to save config') as Error & { validationErrors?: ConfigValidationError[] };
      error.validationErrors = body.validationErrors ?? [];
      throw error;
    }
    return res.json() as Promise<{ config: AppConfig }>;
  }

  async listEmbeddingModels(): Promise<EmbeddingModelCatalog> {
    const res = await fetch(`${this.baseUrl}/api/v1/embeddings/models`, { credentials: 'include' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(body?.error?.message ?? 'Failed to load embedding models');
    }
    const data = await res.json() as Partial<EmbeddingModelCatalog>;
    if (!Array.isArray(data.models) || typeof data.defaultModel !== 'string') {
      throw new Error('Malformed embedding model catalog response');
    }
    return data as EmbeddingModelCatalog;
  }

  // ── Graph & repos ──────────────────────────────────────────────────────────

  async fetchGraph(repoId: string): Promise<{ nodes: CodeNode[]; edges: CodeEdge[] }> {
    const res = await fetch(`${this.baseUrl}/api/v1/graph/${encodeURIComponent(repoId)}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to fetch graph: ${res.statusText}`);
    return res.json() as Promise<{ nodes: CodeNode[]; edges: CodeEdge[] }>;
  }

  /**
   * Fetch a paginated page of nodes from the server.
   * Used for progressive graph loading (Epic 1.2).
   */
  async fetchGraphNodes(
    repoId: string,
    offset: number,
    limit: number,
  ): Promise<{ nodes: CodeNode[]; offset: number; limit: number; total: number; hasMore: boolean }> {
    const url = `${this.baseUrl}/api/v1/graph/${encodeURIComponent(repoId)}/nodes?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to fetch graph nodes: ${res.statusText}`);
    return res.json() as Promise<{ nodes: CodeNode[]; offset: number; limit: number; total: number; hasMore: boolean }>;
  }

  async search(queryOrRequest: string | SearchRequest, limit = 20, options?: { repoId?: string; group?: string }): Promise<SearchResponse> {
    const csrfToken = await this.getCsrfToken();
    const request = typeof queryOrRequest === 'string'
      ? { query: queryOrRequest, limit, ...(options?.group ? { scope: { type: 'group' as const, name: options.group } } : options?.repoId ? { scope: { type: 'repo' as const, repoId: options.repoId } } : {}) }
      : queryOrRequest;
    const res = await fetch(`${this.baseUrl}/api/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(`Search failed: ${res.statusText}`);
    return res.json() as Promise<SearchResponse>;
  }

  async vectorSearch(queryOrRequest: string | SearchRequest, limit = 10): Promise<SearchResponse> {
    const csrfToken = await this.getCsrfToken();
    const request = typeof queryOrRequest === 'string'
      ? { query: queryOrRequest, limit, mode: 'vector' as const }
      : { ...queryOrRequest, mode: 'vector' as const };
    const res = await fetch(`${this.baseUrl}/api/v1/vector-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(`Vector search failed: ${res.statusText}`);
    return res.json() as Promise<SearchResponse>;
  }

  async vectorStatus(): Promise<{ ready: boolean; building: boolean }> {
    const res = await fetch(`${this.baseUrl}/api/v1/vector-status`, { credentials: 'include' });
    if (!res.ok) return { ready: false, building: false };
    return res.json() as Promise<{ ready: boolean; building: boolean }>;
  }

  async listRepos(): Promise<{ id: string; name: string; path: string; nodes: number; edges: number; indexedAt: string | null; active?: boolean }[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/repos`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to list repos: ${res.statusText}`);
    return res.json() as Promise<{ id: string; name: string; path: string; nodes: number; edges: number; indexedAt: string | null; active?: boolean }[]>;
  }

  async readFile(filePath: string): Promise<{ content: string }> {
    const csrfToken = await this.getCsrfToken();
    const res = await fetch(`${this.baseUrl}/api/v1/files/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ file_path: filePath }),
    });
    if (!res.ok) throw new Error(`Failed to read file: ${res.statusText}`);
    return res.json() as Promise<{ content: string }>;
  }

  async inspectNode(nodeId: string, repoId?: string): Promise<NodeInspectInfo> {
    const url = `${this.baseUrl}/api/v1/nodes/${encodeURIComponent(nodeId)}${repoId ? `?repoId=${encodeURIComponent(repoId)}` : ''}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Inspect failed: ${res.statusText}`);
    return res.json() as Promise<NodeInspectInfo>;
  }

  async blastRadius(
    target: string,
    direction: 'callers' | 'callees' | 'both' = 'both',
    maxHops = 3,
    repoId?: string,
  ): Promise<BlastRadiusResult> {
    const csrfToken = await this.getCsrfToken();
    const res = await fetch(`${this.baseUrl}/api/v1/blast-radius`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ target, direction, max_hops: maxHops, repoId }),
    });
    if (!res.ok) throw new Error(`Blast radius failed: ${res.statusText}`);
    return res.json() as Promise<BlastRadiusResult>;
  }

  async grep(pattern: string): Promise<{ results: GrepHit[] }> {
    const csrfToken = await this.getCsrfToken();
    const res = await fetch(`${this.baseUrl}/api/v1/grep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ pattern }),
    });
    if (!res.ok) throw new Error(`Grep failed: ${res.statusText}`);
    return res.json() as Promise<{ results: GrepHit[] }>;
  }

  async listFlows(): Promise<{ flows: { id: string; name: string; steps: unknown }[] }> {
    const res = await fetch(`${this.baseUrl}/api/v1/flows`, { credentials: 'include' });
    if (!res.ok) throw new Error(`List flows failed: ${res.statusText}`);
    return res.json() as Promise<{ flows: { id: string; name: string; steps: unknown }[] }>;
  }

  async listGroups(): Promise<{ name: string; memberCount: number; lastSync: string | null; createdAt: string }[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/groups`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to list groups: ${res.statusText}`);
    return res.json() as Promise<{ name: string; memberCount: number; lastSync: string | null; createdAt: string }[]>;
  }

  async getGroup(name: string): Promise<{ name: string; members: { groupPath: string; repoId?: string; registryName: string }[]; lastSync?: string; createdAt: string }> {
    const res = await fetch(`${this.baseUrl}/api/v1/groups/${encodeURIComponent(name)}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Group not found: ${res.statusText}`);
    return res.json() as Promise<{ name: string; members: { groupPath: string; repoId?: string; registryName: string }[]; lastSync?: string; createdAt: string }>;
  }

  async getGroupContracts(name: string): Promise<{ contracts: unknown[]; links: unknown[]; syncedAt: string } | null> {
    const res = await fetch(`${this.baseUrl}/api/v1/groups/${encodeURIComponent(name)}/contracts`, { credentials: 'include' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to get contracts: ${res.statusText}`);
    return res.json() as Promise<{ contracts: unknown[]; links: unknown[]; syncedAt: string }>;
  }

  async syncGroup(name: string): Promise<{ contracts: unknown[]; links: unknown[]; syncedAt: string; memberCount: number }> {
    const csrfToken = await this.getCsrfToken();
    const res = await fetch(`${this.baseUrl}/api/v1/groups/${encodeURIComponent(name)}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Sync failed: ${res.statusText}`);
    return res.json() as Promise<{ contracts: unknown[]; links: unknown[]; syncedAt: string; memberCount: number }>;
  }

  async searchGroup(name: string, q: string, limit = 20): Promise<SearchResponse> {
    const csrfToken = await this.getCsrfToken();
    const res = await fetch(`${this.baseUrl}/api/v1/groups/${encodeURIComponent(name)}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ query: q, limit, mode: 'hybrid', scope: { type: 'group', name } }),
    });
    if (!res.ok) throw new Error(`Group search failed: ${res.statusText}`);
    return res.json() as Promise<SearchResponse>;
  }

  async fetchGroupGraph(name: string): Promise<{ nodes: import('code-intel-shared').CodeNode[]; edges: import('code-intel-shared').CodeEdge[] }> {
    const res = await fetch(`${this.baseUrl}/api/v1/groups/${encodeURIComponent(name)}/graph`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to fetch group graph: ${res.statusText}`);
    return res.json() as Promise<{ nodes: import('code-intel-shared').CodeNode[]; edges: import('code-intel-shared').CodeEdge[] }>;
  }

  async sourcePreview(file: string, startLine?: number, endLine?: number, repoId?: string): Promise<{ content: string; language: string; startLine: number; endLine: number }> {
    const params = new URLSearchParams({ file });
    if (startLine !== undefined) params.set('startLine', String(startLine));
    if (endLine !== undefined) params.set('endLine', String(endLine));
    if (repoId) params.set('repoId', repoId);
    const res = await fetch(`${this.baseUrl}/api/v1/source?${params.toString()}`, { credentials: 'include' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(body?.error?.message ?? `Source preview failed: ${res.statusText}`);
    }
    return res.json() as Promise<{ content: string; language: string; startLine: number; endLine: number }>;
  }

  async getGroupTopology(name: string): Promise<{
    repos: { name: string; groupPath: string; nodeCount: number; edgeCount: number }[];
    edges: { source: string; target: string; contractName: string; confidence: number; kind: string }[];
  }> {
    const res = await fetch(`${this.baseUrl}/api/v1/groups/${encodeURIComponent(name)}/topology`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to get topology: ${res.statusText}`);
    return res.json() as Promise<{
      repos: { name: string; groupPath: string; nodeCount: number; edgeCount: number }[];
      edges: { source: string; target: string; contractName: string; confidence: number; kind: string }[];
    }>;
  }

  async createGroup(name: string): Promise<{ name: string; members: { groupPath: string; repoId?: string; registryName: string }[]; createdAt: string }> {
    const csrfToken = await this.getCsrfToken();
    const res = await fetch(`${this.baseUrl}/api/v1/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ name }),
    });
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    if (!res.ok) throw new Error(body?.error?.message ?? `Create group failed: ${res.statusText}`);
    return body as { name: string; members: { groupPath: string; repoId?: string; registryName: string }[]; createdAt: string };
  }

  async renameGroup(oldName: string, newName: string): Promise<{ name: string; members: { groupPath: string; repoId?: string; registryName: string }[] }> {
    const csrfToken = await this.getCsrfToken();
    const res = await fetch(`${this.baseUrl}/api/v1/groups/${encodeURIComponent(oldName)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ name: newName }),
    });
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    if (!res.ok) throw new Error(body?.error?.message ?? `Rename failed: ${res.statusText}`);
    return body as { name: string; members: { groupPath: string; repoId?: string; registryName: string }[] };
  }

  async deleteGroup(name: string): Promise<void> {
    const csrfToken = await this.getCsrfToken();
    const res = await fetch(`${this.baseUrl}/api/v1/groups/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': csrfToken },
      credentials: 'include',
    });
    if (!res.ok && res.status !== 204) {
      const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(body?.error?.message ?? `Delete failed: ${res.statusText}`);
    }
  }

  async addGroupMember(groupName: string, groupPath: string, repoId: string, registryName: string): Promise<{ name: string; members: { groupPath: string; repoId?: string; registryName: string }[] }> {
    const csrfToken = await this.getCsrfToken();
    const res = await fetch(`${this.baseUrl}/api/v1/groups/${encodeURIComponent(groupName)}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ groupPath, repoId, registryName }),
    });
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    if (!res.ok) throw new Error(body?.error?.message ?? `Add member failed: ${res.statusText}`);
    return body as { name: string; members: { groupPath: string; repoId?: string; registryName: string }[] };
  }

  async removeGroupMember(groupName: string, groupPath: string): Promise<{ name: string; members: { groupPath: string; repoId?: string; registryName: string }[] }> {
    const csrfToken = await this.getCsrfToken();
    const res = await fetch(`${this.baseUrl}/api/v1/groups/${encodeURIComponent(groupName)}/members`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ groupPath }),
    });
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    if (!res.ok) throw new Error(body?.error?.message ?? `Remove member failed: ${res.statusText}`);
    return body as { name: string; members: { groupPath: string; repoId?: string; registryName: string }[] };
  }

  async queryGQL(gql: string, scope?: QueryScope): Promise<GQLResult> {
    const csrfToken = await this.getCsrfToken();
    const res = await fetch(`${this.baseUrl}/api/v1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ gql, scope }),
    });
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } } | unknown;
    if (!res.ok) {
      if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') {
        throw new Error(body.error.message);
      }
      throw new Error(`Query failed: ${res.statusText}`);
    }
    return normalizeGQLResult(body);
  }
}
