export { DbManager } from './db-manager.js';
export { ALL_NODE_TABLES, NODE_TABLE_MAP, getCreateNodeTableDDL, getCreateEdgeTableDDL } from './schema.js';
export { writeNodeCSVs, writeEdgeCSV } from './csv-writer.js';
export type { EdgeCSVGroup } from './csv-writer.js';
export { loadGraphToDB, upsertNode, upsertNodes, removeNodesForFile, removeEdgesForFile } from './graph-loader.js';
export { loadRegistry, saveRegistry, upsertRepo, removeRepo } from './repo-registry.js';
export type { RepoEntry } from './repo-registry.js';
export { saveMetadata, loadMetadata, getDbPath, getVectorDbPath } from './metadata.js';
export type { IndexMetadata } from './metadata.js';
