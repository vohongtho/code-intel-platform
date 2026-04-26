import type { CodeNode, CodeEdge, NodeKind, EdgeKind } from '@code-intel/shared';

export type AppView = 'connect' | 'loading' | 'exploring';

export interface SearchResult {
  nodeId: string;
  name: string;
  kind: string;
  filePath: string;
  score: number;
  snippet?: string;
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

export interface AppState {
  view: AppView;
  serverUrl: string;
  connected: boolean;
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
  groupMembers: { groupPath: string; registryName: string }[];
  groupContracts: { kind: string; name: string; repoName: string; filePath: string; signature?: string }[];
  groupLinks: { providerRepo: string; providerContract: string; consumerRepo: string; consumerContract: string; matchKind: string; confidence: number }[];
  groupSyncedAt: string | null;
}
