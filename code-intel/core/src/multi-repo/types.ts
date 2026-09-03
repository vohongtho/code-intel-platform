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
}

// ─── Contract model ──────────────────────────────────────────────────────────

export type ContractKind = 'export' | 'route' | 'schema' | 'event' | 'graphql' | 'grpc';

/**
 * A contract is an observable boundary point of a repo:
 * an exported symbol, HTTP route, event, or schema type.
 */
export interface Contract {
  repoName: string;
  repoPath: string;
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
}

export type LinkKind = 'name-match' | 'route-match' | 'import-match';

/**
 * A cross-repo link: a contract in one repo matched to a contract
 * (or consumer node) in another repo.
 */
export interface ContractLink {
  providerRepo: string;
  providerContract: string;   // Contract name
  consumerRepo: string;
  consumerContract: string;   // Matching name in consumer repo
  matchKind: LinkKind;
  confidence: number;         // 0.0 – 1.0
}

/** Persisted result of a `group sync` run. */
export interface GroupSyncResult {
  groupName: string;
  syncedAt: string;
  memberCount: number;
  contracts: Contract[];
  links: ContractLink[];
}
