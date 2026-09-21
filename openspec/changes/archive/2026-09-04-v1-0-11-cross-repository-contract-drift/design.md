# Design: Cross-Repository Contract Drift

## Model

```ts
interface GroupContractVersion {
  contractId: string;
  kind: 'http' | 'schema' | 'event' | 'graphql' | 'rpc';
  repositoryId: string;
  producerSymbolId?: string;
  semanticFingerprint: string;
  snapshotId: string;
  coverage: AnalysisCoverage;
}

interface ContractDriftFinding {
  contractId: string;
  changeKind: string;
  compatibility: 'compatible' | 'potentially-breaking' | 'breaking' | 'unknown';
  affectedConsumers: ContractConsumerImpact[];
  evidence: EvidenceRef[];
  coverage: AnalysisCoverage;
}
```

## Identity

Contract identity must survive body-only implementation changes. HTTP identity is method + normalized route within repository/service identity; schema/event identity is canonical declared contract identity. Renames appear as remove/add unless identity/move evidence proves continuity.

## Comparison

Each contract kind owns a compatibility comparator. Shared orchestration only normalizes findings, certainty, repository membership, and ordering.

HTTP delegates to API-contract comparison. Schema comparison considers removed fields, requiredness, type-category changes, enum narrowing where modeled, and consumer usage. Event comparison treats topic/name removal and removal/type change of consumed payload fields as breaking when consumer evidence is exact.

## Unknown consumers

Group synchronization defines known analysis scope, not the universe of runtime consumers. Results include `knownConsumerCoverage` and MUST distinguish `no known consumer` from `proven unused`.

## Snapshot integration

Drift compares immutable semantic snapshots. If one repository lacks a requested base/head snapshot, the result remains partial and lists that repository. It MUST NOT compare timestamps as a substitute for semantic state identity.

## Public API

`group_contract_drift` inputs:

- group identifier;
- base/head refs or snapshot IDs;
- optional contract kind/repository filters;
- result limit used only for presentation, not analysis completeness.

Output includes changed contracts, compatibility, affected repos/symbols/flows/tests, boundaries, and deterministic summary counts.

## Incremental behavior

After group sync, only changed contract fingerprints and reverse consumer dependencies require recomparison. Group-wide full recomparison remains a safe fallback.

**Implementation note (1.0.11 scope):** contract fingerprints did not originally capture full
structural content for `route`/`schema`/`event` kinds (only name/signature-first-line/method/path
— never the response/request shape or parsed field list), so an unchanged fingerprint could not
be trusted to mean unchanged semantics. This was fixed first (`semanticFingerprintPayloadFromNode`
in `contract-fingerprint.ts` now folds in route shape-fact refs and parsed schema/event field
lists), which is what makes the incremental behavior below sound rather than an approximation.

Two independent, narrowly-scoped mechanisms implement "incremental" for 1.0.11 — there is no
incremental *link-matching* engine, and `group-sync.ts` always recomputes contracts/links/the
consumer index in full on every call (matching contracts against all other contracts is not
embarrassingly separable without risking a missed cross-repo match, so that full recompute is the
permanent, only code path — not a fallback from a divergent fast path):

1. **`GroupSyncResult.changedContractIds`** — computed once per sync by diffing this run's
   contract fingerprints against the previous sync's (by `contractId`). A contract missing from
   the previous baseline, a fingerprint mismatch, or a contract that has disappeared are all
   reported as changed. No previous baseline (first sync, or a `schemaVersion` mismatch) reports
   *every* current contract as changed — informational/tooling signal only; nothing downstream
   currently consumes it to skip work, precisely because it reflects drift between two *sync*
   runs, which is a different time axis than an arbitrary `base_ref`/`head_ref` drift request and
   cannot soundly gate that comparison.
2. **Fingerprint-proven skip inside `getGroupContractDrift`** — within a single drift call, when a
   contract's own requested base and head snapshot versions carry an identical, non-legacy
   fingerprint (for `route`/`schema`/`event` only — the fully-implemented comparator kinds), the
   kind-specific comparator is skipped rather than re-deriving the same guaranteed-empty result
   (every comparator already returns `[]` for unchanged content — see `schema-comparator.ts` /
   `event-comparator.ts`). This is self-contained per call and safe for any `base_ref`/`head_ref`
   pair, unlike (1).

Given (1) above, "incremental group sync + drift must equal fresh full group rebuild" is
satisfied by construction for the sync side (there is exactly one sync code path). Convergence
testing therefore focuses on (2): unchanged contracts must yield zero findings, and any genuine
change (producer content, route path, schema fields) must still surface findings.

## Failure semantics

A missing repository, failed snapshot, unsupported contract type, or bounded consumer expansion makes coverage partial. Presentation truncation is distinct from analysis truncation.

## Baseline inventory notes

### Current persisted group shape

`group-registry.ts` persists two JSON documents under `~/.code-intel/groups/`:

- `<group>.json` stores `RepoGroup { name, createdAt, members[], lastSync? }`
- `<group>.sync.json` stores `GroupSyncResult { groupName, syncedAt, memberCount, contracts[], links[] }`

`members[]` currently uses stable `repoId?` plus mutable `registryName` and `groupPath`. `loadGroup()` already migrates legacy members without `repoId` by consulting the global repo registry and rewriting with the stable repo identity.

### Current contract extraction shape

`group-sync.ts` emits a flat `Contract[]` union with current fields:

- common: `repoName`, `repoPath`, `kind`, `name`, `nodeId`, `nodeKind`, `filePath`
- export-only evidence: `signature`, `parameters[]`, `returnType`, `exported`
- route-only evidence: `method`, `normalizedPath`

Current extraction sources:

- graph exports: exported functions/classes/interfaces/methods/type aliases/constants/enums/structs/traits
- graph routes: `route` nodes, optionally enriched by `HttpRouteFact` method + normalized path
- graph schemas/events: heuristically inferred from interface/type-alias names containing `schema|dto|request|response|event|message`
- OpenAPI files: route contracts from JSON-only parsing; includes method/path and optional request/response schema blobs before conversion into flat group contracts
- GraphQL files: `query.*`, `mutation.*`, `subscription.*`, `type.*` names plus field lists
- Protobuf files: `service.rpc` names plus input/output type names

Only the flattened `Contract[]` persists today. OpenAPI request/response schemas, GraphQL field lists, protobuf IO types, route consumer evidence, and semantic coverage metadata are discarded before persistence.

### Current link shape

`ContractLink` persists:

- `providerRepo`, `providerContract`
- `consumerRepo`, `consumerContract`
- `matchKind: 'name-match' | 'route-match' | 'import-match'`
- `confidence`

Current links come from two paths:

- non-route contracts: exact/partial name matching with `computeContractSimilarity()`
- routes: evidence-based consumer matching from `semantic/api-contracts`, serialized back down to provider/consumer strings plus confidence

No persisted link currently carries stable contract IDs, consumer/source canonical IDs, certainty labels, coverage, snapshot identity, or semantic fingerprint.

### Current identity and query semantics

- group identity: group `name`
- repo identity: stable registry `repoId`; `registryName` remains a renameable label
- sync freshness: `group.lastSync` plus `GroupSyncResult.syncedAt`
- cross-repo route matching: semantic method + normalized path via `matchApiContracts()`
- cross-repo non-route matching: name equality / containment heuristics plus type similarity scoring
- group query: per-repo search merged with `reciprocalRankFusion()`; RRF output is ranking-only, not contract identity

### Safe additive extension surface

Backward-compatible additions can extend persisted `Contract` / `ContractLink` / `GroupSyncResult` with optional fields because current readers mostly load JSON and filter known properties at use sites. Safe additive candidates:

- contract-level: `contractId`, `snapshotId`, `semanticFingerprint`, `sourceCanonicalId`, `role`, `certainty`, `coverage`, kind-specific semantic payloads
- link-level: stable provider/consumer IDs, canonical source anchors, certainty, consumer-property usage, coverage
- result-level: schema/version marker, drift summaries, consumer reverse index, changed contract IDs

Risk surface:

- `group-config.ts` is a separate legacy YAML shape (`{ name, repos[] }`) and should not be reused as the persistence model for drift
- `loadSyncResult()` currently trusts raw JSON shape; migration/version checks must happen before save-in-place behavior
- existing APIs return full persisted sync JSON, so existing top-level fields (`groupName`, `syncedAt`, `memberCount`, `contracts`, `links`) must remain intact

### Reuse constraints for drift

Drift must reuse existing group name, member `groupPath`, stable repo `repoId`, sync artifact location, route fact method/path matching, and group-query RRF semantics. It must not introduce a second workspace/group registry parallel to `group-registry.ts` or downgrade repo identity back to mutable repo names.
