import type { AnalysisCertainty, AnalysisCoverage } from '../shared/index.js';

// ─── Group model ─────────────────────────────────────────────────────────────

/** A member of a repo group, located at a hierarchy path. */
export interface GroupMember {
  /** Hierarchy path inside the group, e.g. "hr/hiring/backend" */
  groupPath: string;
  /** Stable repo identity for rename-safe persistence */
  repoId?: string;
  /** Name from the global registry (`code-intel list`) */
  registryName: string;
}

/** A named collection of repos treated as a logical system. */
export interface RepoGroup {
  name: string;
  createdAt: string;
  members: GroupMember[];
  lastSync?: string;
  schemaVersion?: string;
}

// ─── Contract model ──────────────────────────────────────────────────────────

export type ContractKind = 'export' | 'route' | 'schema' | 'event' | 'graphql' | 'grpc';

/**
 * A contract is an observable boundary point of a repo:
 * an exported symbol, HTTP route, event, or schema type.
 */
export type ContractRole = 'producer' | 'consumer' | 'both' | 'unknown';

export interface Contract {
  repoName: string;
  repoPath: string;
  repositoryId?: string;
  kind: ContractKind;
  name: string;
  nodeId: string;
  nodeKind: string;
  filePath: string;
  signature?: string;
  parameters?: Array<{ name: string; type?: string }>;
  returnType?: string;
  exported?: boolean;
  /** HTTP method, present only for `kind: 'route'` contracts backed by an HttpRouteFact
   * (semantic/api-contracts) — additive evidence used for method+normalized-path matching
   * instead of route-name equality/substring. */
  method?: string;
  /** Normalized route path (parameter segments collapsed to `{}`), present only for
   * `kind: 'route'` contracts backed by an HttpRouteFact. */
  normalizedPath?: string;
  /** Additive drift metadata — absent on legacy persisted group state. */
  contractId?: string;
  snapshotId?: string;
  semanticFingerprint?: string;
  sourceCanonicalId?: string;
  role?: ContractRole;
  certainty?: AnalysisCertainty | 'legacy';
  coverage?: AnalysisCoverage;
}

export type LinkKind = 'name-match' | 'route-match' | 'import-match';

/**
 * A cross-repo link: a contract in one repo matched to a contract
 * (or consumer node) in another repo.
 */
export interface ContractConsumerRef {
  repositoryId: string;
  repositoryName?: string;
  consumerId: string;
  sourceCanonicalId?: string;
  sourceAnchor?: string;
  certainty: AnalysisCertainty | 'legacy';
  confidence?: number;
  consumedFields?: readonly string[];
  callSites?: readonly string[];
  coverage?: AnalysisCoverage;
}

export interface ContractLink {
  providerRepo: string;
  providerContract: string;   // Contract name
  consumerRepo: string;
  consumerContract: string;   // Matching name in consumer repo
  matchKind: LinkKind;
  confidence: number;         // 0.0 – 1.0
  providerContractId?: string;
  consumerContractId?: string;
  providerSourceCanonicalId?: string;
  consumerSourceCanonicalId?: string;
  callSites?: readonly string[];
  consumedFields?: readonly string[];
  certainty?: AnalysisCertainty | 'legacy';
  coverage?: AnalysisCoverage;
}

export interface GroupContractVersion {
  contractId: string;
  kind: ContractKind;
  repositoryId: string;
  repositoryName?: string;
  snapshotId: string;
  semanticFingerprint: string;
  sourceCanonicalId?: string;
  role: ContractRole;
  certainty: AnalysisCertainty | 'legacy';
  coverage: AnalysisCoverage;
}

export interface KnownConsumerCoverage {
  complete: boolean;
  inScope: 'group-sync' | 'partial-group-sync' | 'unknown';
  certainty: AnalysisCertainty | 'legacy';
  examinedConsumerCount: number;
  totalKnownConsumerCount?: number;
  incompleteReasons: readonly string[];
}

export type ContractDriftCompatibility = 'compatible' | 'potentially-breaking' | 'breaking' | 'unknown';

/**
 * Test/flow guidance for one exact-certainty affected consumer. Only ever
 * populated from exact consumer evidence — heuristic/unknown consumers remain
 * visible in `affectedConsumers` as candidates but never gain a suggestion here.
 */
export interface ContractDriftTestSuggestion {
  repositoryId: string;
  consumerId: string;
  symbol: string;
  relatedFlowIds: readonly string[];
  suggestedCases: readonly string[];
  existingTests: readonly string[];
}

export interface ContractDriftFinding {
  contractId: string;
  kind: ContractKind;
  repositoryId: string;
  compatibility: ContractDriftCompatibility;
  changeKind: string;
  summary: string;
  baseVersion?: GroupContractVersion;
  headVersion?: GroupContractVersion;
  affectedConsumers: readonly ContractConsumerRef[];
  evidenceRefs: readonly string[];
  certainty: AnalysisCertainty | 'legacy';
  coverage: AnalysisCoverage;
  knownConsumerCoverage: KnownConsumerCoverage;
  /** Additive: flow/test guidance for exact-certainty consumers of breaking/potentially-breaking findings. */
  suggestedTests?: readonly ContractDriftTestSuggestion[];
}

export interface ContractDriftSummary {
  totalFindings: number;
  byCompatibility: Record<ContractDriftCompatibility, number>;
  byKind?: Partial<Record<ContractKind, number>>;
  coverage: AnalysisCoverage;
  knownConsumerCoverage: KnownConsumerCoverage;
}

export interface ContractConsumerIndex {
  byContractId: Record<string, readonly ContractConsumerRef[]>;
  bySemanticFingerprint: Record<string, readonly ContractConsumerRef[]>;
}

/** Persisted result of a `group sync` run. */
export interface GroupSyncResult {
  groupName: string;
  syncedAt: string;
  memberCount: number;
  contracts: Contract[];
  links: ContractLink[];
  schemaVersion?: string;
  contractVersions?: GroupContractVersion[];
  changedContractIds?: string[];
  consumerIndex?: ContractConsumerIndex;
  driftSummary?: ContractDriftSummary;
}
