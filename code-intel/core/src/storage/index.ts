export { DbManager } from './db-manager.js';
export { ALL_NODE_TABLES, NODE_TABLE_MAP, getCreateNodeTableDDL, getCreateEdgeTableDDL } from './schema.js';
export { writeNodeCSVs, writeEdgeCSV } from './csv-writer.js';
export type { EdgeCSVGroup } from './csv-writer.js';
export { loadGraphToDB, upsertNode, upsertNodes, removeNodesForFile, removeEdgesForFile } from './graph-loader.js';
export { loadRegistry, saveRegistry, findRepoById, findRepoByName, findRepoByPath, findRepo, upsertRepo, renameRepo, relinkRepo, removeRepo } from './repo-registry.js';
export type { RepoEntry } from './repo-registry.js';
export { saveMetadata, loadMetadata, getDbPath, getVectorDbPath, computeIndexVersion, computeIndexVersionForPaths } from './metadata.js';
export type { IndexMetadata } from './metadata.js';
export { normalizeIndexGenerationManifest } from './index-generation.js';
export { verifyIndexTrust, upgradeLegacyIndexMetadata } from './index-trust.js';
export type { IndexTrustState, IndexTrustResult, IndexArtifactState } from './index-trust.js';
export {
  createIndexGeneration,
  publishIndexGeneration,
  abortIndexGeneration,
  cleanupOldGenerations,
  migrateLegacyIndexToGeneration,
  loadCurrentGenerationManifest,
  getPublishedGenerationDir,
  resolvePublishedArtifactPath,
  getCurrentManifestPath,
} from './index-generation.js';
export type {
  IndexGeneration,
  IndexGenerationManifest,
  IndexArtifactName,
} from './index-generation.js';
