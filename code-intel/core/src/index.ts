export { createKnowledgeGraph } from './graph/index.js';
export type { KnowledgeGraph } from './graph/index.js';
export { generateNodeId, generateEdgeId } from './graph/index.js';

export { initParser, getParser, getLanguage, parseSource, runQuery, AstCache } from './parsing/index.js';
export type { QueryCapture } from './parsing/index.js';

export { getLanguageModule, getAllLanguageModules } from './languages/index.js';
export type { LanguageModule, FileSet } from './languages/index.js';

export { resolveImports, BindingTracker } from './resolver/index.js';
export type { ImportInfo, ImportResolutionResult, ImportBinding } from './resolver/index.js';

export { buildCallEdges, classifyCall } from './call-graph/index.js';
export type { CallSite, CallKind } from './call-graph/index.js';

export { buildHeritageEdges, computeMRO, detectOverrides } from './inheritance/index.js';
export type { HeritageInfo, MroStrategy } from './inheritance/index.js';

export { runPipeline, validateDAG, topologicalSort } from './pipeline/index.js';
export type { Phase, PhaseResult, PipelineContext, PipelineRunResult } from './pipeline/index.js';
export {
  scanPhase,
  structurePhase,
  parsePhase,
  resolvePhase,
  clusterPhase,
  flowPhase,
} from './pipeline/index.js';

export { createScope, resolveBinding, addBinding } from './scope-analysis/index.js';
export type { Scope, ScopeBinding } from './scope-analysis/index.js';

export { detectCommunities, addClustersToGraph } from './clustering/index.js';
export type { ClusterResult } from './clustering/index.js';

export { findEntryPoints, traceFlow } from './flow-detection/index.js';
export type { EntryPoint, FlowTrace } from './flow-detection/index.js';

export { textSearch, reciprocalRankFusion } from './search/index.js';
export type { SearchResult } from './search/index.js';

export { createMcpServer, startMcpStdio } from './mcp-server/index.js';
export { createApp, startHttpServer } from './http/index.js';

export { DbManager, loadGraphToDB, upsertRepo, loadRegistry, removeRepo, saveMetadata, loadMetadata, getDbPath } from './storage/index.js';
export type { RepoEntry, IndexMetadata } from './storage/index.js';

export { listGroups, loadGroup, saveGroup, deleteGroup, groupExists, addMember, removeMember, saveSyncResult, loadSyncResult } from './multi-repo/index.js';
export { syncGroup } from './multi-repo/index.js';
export { queryGroup } from './multi-repo/index.js';
export { mergeSearchResults } from './multi-repo/index.js';
export type { RepoGroup, GroupMember, Contract, ContractLink, GroupSyncResult } from './multi-repo/index.js';
export type { GroupQueryResult } from './multi-repo/index.js';
