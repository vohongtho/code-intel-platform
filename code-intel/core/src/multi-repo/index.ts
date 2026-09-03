export type {
  RepoGroup,
  GroupMember,
  Contract,
  ContractLink,
  ContractKind,
  GroupSyncResult,
  LinkKind,
  ContractRole,
  GroupContractVersion,
  ContractConsumerRef,
  KnownConsumerCoverage,
  ContractDriftCompatibility,
  ContractDriftFinding,
  ContractDriftSummary,
  ContractConsumerIndex,
  ContractDriftTestSuggestion,
} from './types.js';
export { loadGroup, saveGroup, listGroups, deleteGroup, groupExists, addMember, removeMember, saveSyncResult, loadSyncResult, verifySyncResultReadBack } from './group-registry.js';
export { syncGroup } from './group-sync.js';
export { queryGroup } from './group-query.js';
export type { GroupQueryResult } from './group-query.js';
export { loadGraphFromDB, loadGraphSnapshotFromDbPath } from './graph-from-db.js';
export { canonicalContractIdentity, getStableContractId, contractIdentityFromContract } from './contract-identity.js';
export {
  GROUP_CONTRACT_SCHEMA_VERSION,
  canonicalContractFingerprintInput,
  computeSemanticContractFingerprint,
  contractFingerprintFromContract,
} from './contract-fingerprint.js';
export { compareHttpContracts } from './contract-drift/http-comparator.js';
export { compareSchemaContracts } from './contract-drift/schema-comparator.js';
export { compareEventContracts } from './contract-drift/event-comparator.js';
export { compareContractVersions } from './contract-drift/comparator.js';
export { getGroupContractDrift } from './contract-drift/service.js';
export type { GroupContractDriftRequest, GroupContractDriftResult, GroupContractDriftMetrics } from './contract-drift/service.js';

// Legacy export kept for backwards compatibility
export { mergeSearchResults } from './cross-repo-search.js';
