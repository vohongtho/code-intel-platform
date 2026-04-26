export type { RepoGroup, GroupMember, Contract, ContractLink, ContractKind, GroupSyncResult, LinkKind } from './types.js';
export { loadGroup, saveGroup, listGroups, deleteGroup, groupExists, addMember, removeMember, saveSyncResult, loadSyncResult } from './group-registry.js';
export { syncGroup } from './group-sync.js';
export { queryGroup } from './group-query.js';
export type { GroupQueryResult } from './group-query.js';
export { loadGraphFromDB } from './graph-from-db.js';

// Legacy export kept for backwards compatibility
export { mergeSearchResults } from './cross-repo-search.js';
