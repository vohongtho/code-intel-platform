import type { CodeNode, CodeEdge, NodeKind, EdgeKind } from 'code-intel-shared';

export type AppView = 'login' | 'connect' | 'loading' | 'exploring' | 'settings';

export interface CurrentUser {
  id: string;
  username: string;
  role: 'admin' | 'analyst' | 'viewer' | 'repo-owner';
}

export interface SearchResult {
  nodeId: string;
  name: string;
  kind: string;
  filePath: string;
  score: number;
  snippet?: string;
  repoName?: string;
  groupPath?: string;
}

export type SearchMode = 'bm25' | 'vector' | 'hybrid';

export interface SearchScope {
  type: 'repo' | 'group';
  name: string;
}

export interface ChatCitation {
  filePath: string;
  startLine?: number;
  endLine?: number;
  nodeId?: string;
}

export interface ChatToolCall {
  tool: string;
  input: Record<string, unknown>;
  status: 'running' | 'done' | 'error';
  resultSummary?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  citations?: ChatCitation[];
  toolCalls?: ChatToolCall[];
}

export type FocusDepth = 'all' | 1 | 2 | 3 | 5;

export interface FilterState {
  hiddenNodeKinds: Set<NodeKind>;
  hiddenEdgeKinds: Set<EdgeKind>;
  focusDepth: FocusDepth;
}

export interface GraphLoadProgress {
  loaded: number;   // nodes fetched so far
  total: number;    // total nodes reported by server
  phase: 'edges' | 'nodes'; // what we're currently fetching
}

export interface AppConfig {
  llm: {
    provider: 'openai' | 'anthropic' | 'ollama' | 'custom' | 'none';
    model: string;
    apiKey: string;
    baseUrl?: string;
    batchSize: number;
    maxTokensPerSummary: number;
  };
  embeddings: {
    model: string;
    enabled: boolean;
  };
  analysis: {
    maxFileSizeKB: number;
    ignorePatterns: string[];
    incrementalByDefault: boolean;
  };
  serve: {
    defaultPort: number;
    openBrowser: boolean;
  };
  auth: {
    mode: 'local' | 'oidc';
    oidc?: {
      issuerUrl: string;
      clientId: string;
      clientSecret: string;
    };
  };
  updates: {
    checkOnStartup: boolean;
    intervalHours: number;
  };
  telemetry: {
    enabled: boolean;
  };
}

export interface AppState {
  view: AppView;
  serverUrl: string;
  connected: boolean;
  graphLoad: GraphLoadProgress | null;
  currentUser: CurrentUser | null;
  repoName: string;
  nodes: CodeNode[];
  edges: CodeEdge[];
  selectedNode: CodeNode | null;
  hoveredNodeId: string | null;
  filters: FilterState;
  search: { query: string; results: SearchResult[] };
  chat: { messages: ChatMessage[]; loading: boolean };
  mode: 'repo' | 'group';
  groupName: string;
  groupMembers: { groupPath: string; repoId?: string; registryName: string }[];
  groupContracts: { kind: string; name: string; repoName: string; filePath: string; signature?: string }[];
  groupLinks: { providerRepo: string; providerContract: string; consumerRepo: string; consumerContract: string; matchKind: string; confidence: number }[];
  groupSyncedAt: string | null;
  config: {
    current: AppConfig | null;
    original: AppConfig | null;
    loading: boolean;
    saving: boolean;
    error: string | null;
    validationErrors: { path: string; reason: string; hint: string }[];
  };
}
