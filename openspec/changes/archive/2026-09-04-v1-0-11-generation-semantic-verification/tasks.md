# Tasks

- [x] Add `AnalyzerCompatibilityReceipt`, `ArtifactStatus`, `ArtifactVerification`, and `EvolutionAction` types under storage/generation ownership.
- [x] Derive deterministic DDL fingerprint from `storage/schema.ts` node/relation DDL and relationship properties.
- [x] Add deterministic fingerprints for language registry, semantic fact schema/projector, identity, resolver, evidence schema, and existing embedding descriptor/runtime configuration.
- [x] Extend generation manifest normalization additively while preserving generation-v1/v2 reading.
- [x] Add producer receipts for graph nodes/relationships and required BM25/vector/evidence membership/versions.
- [x] Add staging read-back verification through normal LadybugDB/BM25/vector/evidence loaders before final rename/pointer replacement.
- [x] Detect produced-vs-persisted collapse and reject publication even when files are non-empty.
- [x] Modify `storage/index-trust.ts` to report artifact-specific verified/partial/stale/unverified/collapsed/corrupt/unavailable states.
- [x] Modify `pipeline/analysis-plan.ts` so compatibility receipts select reuse/metadata migration/artifact rebuild/full reanalysis/reject-corrupt automatically.
- [x] Reuse existing embedding-model selector/vector-runtime-state logic for vector compatibility rather than duplicating it.
- [x] Add identity/resolver/fact/evidence fingerprint mismatch tests that automatically select full semantic reanalysis.
- [x] Add failure-injection tests proving current Generation V2 remains byte-identical/active after read-back failure.
- [x] Add non-empty-but-corrupt/collapsed graph/BM25/evidence fixtures.
- [x] Audit mutable control-file writers outside generation directories and replace any fixed shared temp path with writer-private atomic staging; add concurrency tests where applicable.
- [x] Preserve no-op generation semantics and legacy flat artifacts as migration inputs.
- [x] Run integration/e2e, package validation, index-trust tests, and OpenSpec validation.
