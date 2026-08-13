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

## Failure semantics

A missing repository, failed snapshot, unsupported contract type, or bounded consumer expansion makes coverage partial. Presentation truncation is distinct from analysis truncation.
