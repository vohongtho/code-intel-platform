import type { CodeNode, CodeEdge } from '@code-intel/shared';
import type { SearchResult } from '../state/types';

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

  async fetchGraph(repo: string): Promise<{ nodes: CodeNode[]; edges: CodeEdge[] }> {
    const res = await fetch(`${this.baseUrl}/api/graph/${repo}`);
    if (!res.ok) throw new Error(`Failed to fetch graph: ${res.statusText}`);
    return res.json() as Promise<{ nodes: CodeNode[]; edges: CodeEdge[] }>;
  }

  async search(query: string, limit = 20): Promise<{ results: SearchResult[] }> {
    const res = await fetch(`${this.baseUrl}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit }),
    });
    if (!res.ok) throw new Error(`Search failed: ${res.statusText}`);
    return res.json() as Promise<{ results: SearchResult[] }>;
  }

  async vectorSearch(query: string, limit = 10): Promise<{ results: SearchResult[]; source: string; vectorReady: boolean }> {
    const res = await fetch(`${this.baseUrl}/api/vector-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit }),
    });
    if (!res.ok) throw new Error(`Vector search failed: ${res.statusText}`);
    return res.json() as Promise<{ results: SearchResult[]; source: string; vectorReady: boolean }>;
  }

  async vectorStatus(): Promise<{ ready: boolean; building: boolean }> {
    const res = await fetch(`${this.baseUrl}/api/vector-status`);
    if (!res.ok) return { ready: false, building: false };
    return res.json() as Promise<{ ready: boolean; building: boolean }>;
  }

  async listRepos(): Promise<{ name: string; path: string; nodes: number; edges: number; indexedAt: string | null; active?: boolean }[]> {
    const res = await fetch(`${this.baseUrl}/api/repos`);
    if (!res.ok) throw new Error(`Failed to list repos: ${res.statusText}`);
    return res.json() as Promise<{ name: string; path: string; nodes: number; edges: number; indexedAt: string | null; active?: boolean }[]>;
  }

  async readFile(filePath: string): Promise<{ content: string }> {
    const res = await fetch(`${this.baseUrl}/api/files/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath }),
    });
    if (!res.ok) throw new Error(`Failed to read file: ${res.statusText}`);
    return res.json() as Promise<{ content: string }>;
  }

  async inspectNode(nodeId: string): Promise<NodeInspectInfo> {
    const res = await fetch(`${this.baseUrl}/api/nodes/${encodeURIComponent(nodeId)}`);
    if (!res.ok) throw new Error(`Inspect failed: ${res.statusText}`);
    return res.json() as Promise<NodeInspectInfo>;
  }

  async blastRadius(
    target: string,
    direction: 'callers' | 'callees' | 'both' = 'both',
    maxHops = 3,
  ): Promise<BlastRadiusResult> {
    const res = await fetch(`${this.baseUrl}/api/blast-radius`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, direction, max_hops: maxHops }),
    });
    if (!res.ok) throw new Error(`Blast radius failed: ${res.statusText}`);
    return res.json() as Promise<BlastRadiusResult>;
  }

  async grep(pattern: string): Promise<{ results: GrepHit[] }> {
    const res = await fetch(`${this.baseUrl}/api/grep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern }),
    });
    if (!res.ok) throw new Error(`Grep failed: ${res.statusText}`);
    return res.json() as Promise<{ results: GrepHit[] }>;
  }

  async listFlows(): Promise<{ flows: { id: string; name: string; steps: unknown }[] }> {
    const res = await fetch(`${this.baseUrl}/api/flows`);
    if (!res.ok) throw new Error(`List flows failed: ${res.statusText}`);
    return res.json() as Promise<{ flows: { id: string; name: string; steps: unknown }[] }>;
  }

  async listGroups(): Promise<{ name: string; memberCount: number; lastSync: string | null; createdAt: string }[]> {
    const res = await fetch(`${this.baseUrl}/api/groups`);
    if (!res.ok) throw new Error(`Failed to list groups: ${res.statusText}`);
    return res.json() as Promise<{ name: string; memberCount: number; lastSync: string | null; createdAt: string }[]>;
  }

  async getGroup(name: string): Promise<{ name: string; members: { groupPath: string; registryName: string }[]; lastSync?: string; createdAt: string }> {
    const res = await fetch(`${this.baseUrl}/api/groups/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`Group not found: ${res.statusText}`);
    return res.json() as Promise<{ name: string; members: { groupPath: string; registryName: string }[]; lastSync?: string; createdAt: string }>;
  }

  async getGroupContracts(name: string): Promise<{ contracts: unknown[]; links: unknown[]; syncedAt: string } | null> {
    const res = await fetch(`${this.baseUrl}/api/groups/${encodeURIComponent(name)}/contracts`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to get contracts: ${res.statusText}`);
    return res.json() as Promise<{ contracts: unknown[]; links: unknown[]; syncedAt: string }>;
  }

  async syncGroup(name: string): Promise<{ contracts: unknown[]; links: unknown[]; syncedAt: string; memberCount: number }> {
    const res = await fetch(`${this.baseUrl}/api/groups/${encodeURIComponent(name)}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`Sync failed: ${res.statusText}`);
    return res.json() as Promise<{ contracts: unknown[]; links: unknown[]; syncedAt: string; memberCount: number }>;
  }

  async searchGroup(name: string, q: string, limit = 20): Promise<{ perRepo: { repoName: string; groupPath: string; results: SearchResult[] }[]; merged: SearchResult[] }> {
    const res = await fetch(`${this.baseUrl}/api/groups/${encodeURIComponent(name)}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, limit }),
    });
    if (!res.ok) throw new Error(`Group search failed: ${res.statusText}`);
    return res.json() as Promise<{ perRepo: { repoName: string; groupPath: string; results: SearchResult[] }[]; merged: SearchResult[] }>;
  }

  async fetchGroupGraph(name: string): Promise<{ nodes: import('@code-intel/shared').CodeNode[]; edges: import('@code-intel/shared').CodeEdge[] }> {
    const res = await fetch(`${this.baseUrl}/api/groups/${encodeURIComponent(name)}/graph`);
    if (!res.ok) throw new Error(`Failed to fetch group graph: ${res.statusText}`);
    return res.json() as Promise<{ nodes: import('@code-intel/shared').CodeNode[]; edges: import('@code-intel/shared').CodeEdge[] }>;
  }
}
