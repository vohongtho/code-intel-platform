import React, { createContext, useContext, useReducer } from 'react';
import type { AppState, SearchResult, ChatMessage, FocusDepth, CurrentUser, GraphLoadProgress } from './types';
import type { CodeNode, CodeEdge, NodeKind, EdgeKind } from 'code-intel-shared';

type Action =
  | { type: 'SET_VIEW'; view: AppState['view'] }
  | { type: 'SET_SERVER_URL'; url: string }
  | { type: 'SET_CONNECTED'; connected: boolean }
  | { type: 'SET_CURRENT_USER'; user: CurrentUser | null }
  | { type: 'SET_REPO_NAME'; name: string }
  | { type: 'SET_GRAPH'; nodes: CodeNode[]; edges: CodeEdge[] }
  | { type: 'SELECT_NODE'; node: CodeNode | null }
  | { type: 'HOVER_NODE'; nodeId: string | null }
  | { type: 'SET_SEARCH'; query: string; results: SearchResult[] }
  | { type: 'ADD_CHAT_MESSAGE'; message: ChatMessage }
  | { type: 'UPDATE_LAST_CHAT_MESSAGE'; message: Partial<ChatMessage> }
  | { type: 'SET_CHAT_LOADING'; loading: boolean }
  | { type: 'CLEAR_CHAT' }
  | { type: 'TOGGLE_NODE_KIND'; kind: NodeKind }
  | { type: 'TOGGLE_EDGE_KIND'; kind: EdgeKind }
  | { type: 'SET_FOCUS_DEPTH'; depth: FocusDepth }
  | { type: 'RESET_FILTERS' }
  | { type: 'SET_MODE'; mode: 'repo' | 'group' }
  | { type: 'SET_GROUP_NAME'; name: string }
  | { type: 'SET_GROUP_MEMBERS'; members: { groupPath: string; registryName: string }[] }
  | { type: 'SET_GROUP_CONTRACTS'; contracts: AppState['groupContracts']; links: AppState['groupLinks']; syncedAt: string }
  | { type: 'SET_GRAPH_LOAD'; progress: GraphLoadProgress | null };

const initialState: AppState = {
  view: 'login',
  serverUrl: 'http://localhost:4747',
  connected: false,
  graphLoad: null,
  currentUser: null,
  repoName: '',
  nodes: [],
  edges: [],
  selectedNode: null,
  hoveredNodeId: null,
  filters: {
    hiddenNodeKinds: new Set<NodeKind>(['cluster', 'flow', 'directory']),
    hiddenEdgeKinds: new Set<EdgeKind>(),
    focusDepth: 'all',
  },
  search: { query: '', results: [] },
  chat: { messages: [], loading: false },
  mode: 'repo',
  groupName: '',
  groupMembers: [],
  groupContracts: [],
  groupLinks: [],
  groupSyncedAt: null,
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_VIEW':
      return { ...state, view: action.view };
    case 'SET_SERVER_URL':
      return { ...state, serverUrl: action.url };
    case 'SET_CONNECTED':
      return { ...state, connected: action.connected };
    case 'SET_CURRENT_USER':
      return { ...state, currentUser: action.user };
    case 'SET_REPO_NAME':
      return { ...state, repoName: action.name };
    case 'SET_GRAPH':
      return { ...state, nodes: action.nodes, edges: action.edges };
    case 'SELECT_NODE':
      return { ...state, selectedNode: action.node };
    case 'HOVER_NODE':
      return { ...state, hoveredNodeId: action.nodeId };
    case 'SET_SEARCH':
      return { ...state, search: { query: action.query, results: action.results } };
    case 'ADD_CHAT_MESSAGE':
      return {
        ...state,
        chat: { ...state.chat, messages: [...state.chat.messages, action.message] },
      };
    case 'UPDATE_LAST_CHAT_MESSAGE': {
      const msgs = state.chat.messages.slice();
      if (msgs.length === 0) return state;
      msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], ...action.message };
      return { ...state, chat: { ...state.chat, messages: msgs } };
    }
    case 'SET_CHAT_LOADING':
      return { ...state, chat: { ...state.chat, loading: action.loading } };
    case 'CLEAR_CHAT':
      return { ...state, chat: { messages: [], loading: false } };
    case 'TOGGLE_NODE_KIND': {
      const next = new Set(state.filters.hiddenNodeKinds);
      if (next.has(action.kind)) next.delete(action.kind);
      else next.add(action.kind);
      return { ...state, filters: { ...state.filters, hiddenNodeKinds: next } };
    }
    case 'TOGGLE_EDGE_KIND': {
      const next = new Set(state.filters.hiddenEdgeKinds);
      if (next.has(action.kind)) next.delete(action.kind);
      else next.add(action.kind);
      return { ...state, filters: { ...state.filters, hiddenEdgeKinds: next } };
    }
    case 'SET_FOCUS_DEPTH':
      return { ...state, filters: { ...state.filters, focusDepth: action.depth } };
    case 'RESET_FILTERS':
      return { ...state, filters: initialState.filters };
    case 'SET_MODE': return { ...state, mode: action.mode };
    case 'SET_GROUP_NAME': return { ...state, groupName: action.name };
    case 'SET_GROUP_MEMBERS': return { ...state, groupMembers: action.members };
    case 'SET_GROUP_CONTRACTS': return { ...state, groupContracts: action.contracts, groupLinks: action.links, groupSyncedAt: action.syncedAt };
    case 'SET_GRAPH_LOAD': return { ...state, graphLoad: action.progress };
    default:
      return state;
  }
}

const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
}>({ state: initialState, dispatch: () => {} });

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>;
}

export function useAppState() {
  return useContext(AppContext);
}
