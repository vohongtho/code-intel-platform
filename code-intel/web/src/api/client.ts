import type { CodeNode, CodeEdge } from 'code-intel-shared';
import type { SearchResult, CurrentUser } from '../state/types';

export interface CountGroup {
  key: string;
  count: number;
}

export interface GQLResult {
  nodes: CodeNode[];
  edges?: CodeEdge[];
  groups?: CountGroup[];
  executionTimeMs: number;
  truncated: boolean;
  totalCount: number;
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

  // ── Graph & repos ──────────────────────────────────────────────────────────

  async fetchGraph(repo: string): Promise<{ nodes: CodeNode[]; edges: CodeEdge[] }> {
    const res = await fetch(`${this.baseUrl}/api/v1/graph/${repo}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to fetch graph: ${res.statusText}`);
    return res.json() as Promise<{ nodes: CodeNode[]; edges: CodeEdge[] }>;
  }

  /**
   * Fetch a paginated page of nodes from the server.
   * Used for progressive graph loading (Epic 1.2).
   */
  async fetchGraphNodes(
    repo: string,
    offset: number,
    limit: number,
  ): Promise<{ nodes: CodeNode[]; offset: number; limit: number; total: number; hasMore: boolean }> {
    const url = `${this.baseUrl}/api/v1/graph/${encodeURIComponent(repo)}/nodes?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to fetch graph nodes: ${res.statusText}`);
    return res.json() as Promise<{ nodes: CodeNode[]; offset: number; limit: number; total: number; hasMore: boolean }>;
  }

  async search(query: string, limit = 20): Promise<{ results: SearchResult[] }> {
    const csrfToken = await this.getCsrfToken();
    const res = await fetch(`${this.baseUrl}/api/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ query, limit }),
    });
    if (!res.ok) throw new Error(`Search failed: ${res.statusText}`);
    return res.json() as Promise<{ results: SearchResult[] }>;
  }

  async vectorSearch(query: string, limit = 10): Promise<{ results: SearchResult[]; source: string; vectorReady: boolean }> {
    const csrfToken = await this.getCsrfToken();
    const res = await fetch(`${this.baseUrl}/api/v1/vector-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ query, limit }),
    });
    if (!res.ok) throw new Error(`Vector search failed: ${res.statusText}`);
    return res.json() as Promise<{ results: SearchResult[]; source: string; vectorReady: boolean }>;
  }

  async vectorStatus(): Promise<{ ready: boolean; building: boolean }> {
    const res = await fetch(`${this.baseUrl}/api/v1/vector-status`, { credentials: 'include' });
    if (!res.ok) return { ready: false, building: false };
    return res.json() as Promise<{ ready: boolean; building: boolean }>;
  }

  async listRepos(): Promise<{ name: string; path: string; nodes: number; edges: number; indexedAt: string | null; active?: boolean }[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/repos`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to list repos: ${res.statusText}`);
    return res.json() as Promise<{ name: string; path: string; nodes: number; edges: number; indexedAt: string | null; active?: boolean }[]>;
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

  async inspectNode(nodeId: string, repo?: string): Promise<NodeInspectInfo> {
    const url = `${this.baseUrl}/api/v1/nodes/${encodeURIComponent(nodeId)}${repo ? `?repo=${encodeURIComponent(repo)}` : ''}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Inspect failed: ${res.statusText}`);
    return res.json() as Promise<NodeInspectInfo>;
  }

  async blastRadius(
    target: string,
    direction: 'callers' | 'callees' | 'both' = 'both',
    maxHops = 3,
    repo?: string,
  ): Promise<BlastRadiusResult> {
    const csrfToken = await this.getCsrfToken();
    const res = await fetch(`${this.baseUrl}/api/v1/blast-radius`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ target, direction, max_hops: maxHops, repo }),
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

  async getGroup(name: string): Promise<{ name: string; members: { groupPath: string; registryName: string }[]; lastSync?: string; createdAt: string }> {
    const res = await fetch(`${this.baseUrl}/api/v1/groups/${encodeURIComponent(name)}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Group not found: ${res.statusText}`);
    return res.json() as Promise<{ name: string; members: { groupPath: string; registryName: string }[]; lastSync?: string; createdAt: string }>;
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

  async searchGroup(name: string, q: string, limit = 20): Promise<{ perRepo: { repoName: string; groupPath: string; results: SearchResult[] }[]; merged: SearchResult[] }> {
    const csrfToken = await this.getCsrfToken();
    const res = await fetch(`${this.baseUrl}/api/v1/groups/${encodeURIComponent(name)}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ q, limit }),
    });
    if (!res.ok) throw new Error(`Group search failed: ${res.statusText}`);
    return res.json() as Promise<{ perRepo: { repoName: string; groupPath: string; results: SearchResult[] }[]; merged: SearchResult[] }>;
  }

  async fetchGroupGraph(name: string): Promise<{ nodes: import('code-intel-shared').CodeNode[]; edges: import('code-intel-shared').CodeEdge[] }> {
    const res = await fetch(`${this.baseUrl}/api/v1/groups/${encodeURIComponent(name)}/graph`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to fetch group graph: ${res.statusText}`);
    return res.json() as Promise<{ nodes: import('code-intel-shared').CodeNode[]; edges: import('code-intel-shared').CodeEdge[] }>;
  }

  async sourcePreview(file: string, startLine?: number, endLine?: number, repo?: string): Promise<{ content: string; language: string; startLine: number; endLine: number }> {
    const params = new URLSearchParams({ file });
    if (startLine !== undefined) params.set('startLine', String(startLine));
    if (endLine !== undefined) params.set('endLine', String(endLine));
    if (repo) params.set('repo', repo);
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

  async queryGQL(gql: string): Promise<GQLResult> {
    const csrfToken = await this.getCsrfToken();
    const res = await fetch(`${this.baseUrl}/api/v1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ gql }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(body?.error?.message ?? `Query failed: ${res.statusText}`);
    }
    return res.json() as Promise<GQLResult>;
  }
}
