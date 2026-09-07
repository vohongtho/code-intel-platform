# Design: Generation V2 Semantic Verification and Derived Compatibility

## Observed v1.0.10 ownership

Generation V2 is the sole publication boundary. `IndexSnapshot` pins query artifacts from one generation. v1.0.11 must not bypass these owners.

## Compatibility receipt

```ts
interface AnalyzerCompatibilityReceipt {
  ddlFingerprint: string;
  analyzerFingerprint: string;
  languageRegistryFingerprint: string;
  factSchemaFingerprint: string;
  identityFingerprint: string;
  resolverFingerprint: string;
  evidenceFingerprint?: string;
  embeddingFingerprint?: string;
}
```

Each fingerprint is deterministic from the actual artifact/configuration that changes compatibility. A single manually incremented number is insufficient.

## Artifact verification

```ts
type ArtifactStatus =
  | 'verified'
  | 'partial-recoverable'
  | 'stale'
  | 'interrupted'
  | 'unverified'
  | 'collapsed'
  | 'corrupt'
  | 'unavailable';

interface ArtifactVerification {
  status: ArtifactStatus;
  producedCount?: number;
  persistedCount?: number;
  contentFingerprint?: string;
  reason?: string;
}
```

Generation metadata carries verification for graph, BM25, vector when required, and evidence when required.

## Publication pipeline

```text
analyzer produces staging artifacts + producer receipts
  -> reopen staging LadybugDB through normal loader
  -> verify canonical node/relationship counts/fingerprint
  -> reopen BM25 and verify expected document membership/count
  -> reopen vector when required and verify descriptor/dimension/membership receipt
  -> reopen evidence store when required and verify version/record receipt
  -> validate generation identity + compatibility receipt
  -> rename staging to immutable final generation
  -> atomically replace current.json
```

`current.json` replacement remains last.

## Graph verification

At minimum compare produced/persisted counts plus stable semantic fingerprints. Release/corpus tests compare full canonical sets. Production large-repo verification may stream deterministic fingerprints rather than materialize every row twice.

A non-empty graph with a suspicious produced-vs-persisted collapse is not publishable.

## Compatibility action

```ts
type EvolutionAction =
  | 'reuse'
  | 'metadata-migrate'
  | 'artifact-rebuild'
  | 'full-reanalysis'
  | 'reject-corrupt';
```

Examples:

- unchanged compatibility receipt + trusted artifacts -> reuse/noop.
- metadata-only compatible schema change -> metadata migrate/publication as existing rules allow.
- embedding descriptor mismatch -> vector rebuild using existing vector runtime/selector logic.
- identity/resolver/fact fingerprint mismatch -> full semantic reanalysis.
- corrupt required graph/evidence -> reject current trust and rebuild if source is available.

## Index trust

`storage/index-trust.ts` exposes artifact-level state. Overall `trusted` requires every required artifact for the requested capability to be verified/current. A vector-unavailable state does not invalidate BM25-only capability when embeddings are optional; capability-specific trust matters.

## Atomic control files

Audit mutable files outside immutable generation directories. Any multi-process mutable control file must use writer-private temporary paths before atomic rename; a fixed shared `.tmp` filename is insufficient under concurrent writers.

## Failure semantics

Any required semantic read-back failure aborts candidate publication. The previous generation remains current. An unreachable final directory created before pointer failure may be cleaned later but is never considered active.

## Observability

Health/trust diagnostics may expose compact artifact states/fingerprint mismatch reasons. Avoid leaking filesystem internals in normal public responses.

## Test strategy

- non-empty but intentionally missing relationship artifact;
- produced/persisted count collapse;
- valid file with incompatible resolver/identity fingerprint;
- graph/BM25/vector/evidence reopen failures;
- candidate failure preserves old snapshot;
- generation-v1/v2 normalization;
- no-op preserves generation bytes/mtime;
- concurrent control-file writer audit tests where applicable.
