# Tasks

- [x] Add shared `RelationshipTrust`, `AnalysisCertainty`, `AnalysisCoverage`, and `AnalysisBoundary` contracts under a focused evidence/trust module; add discriminated-union unit tests.
- [x] Extend shared `CodeEdge` additively with call-site/confidence/certainty/strategy/resolver/evidence/ambiguity fields while retaining legacy `weight`/`label`.
- [x] Modify `code-intel/core/src/storage/schema.ts` relation DDL and all CSV/bulk/load/export paths to persist/reopen compact trust fields.
- [x] Create `code-intel/core/src/evidence/store.ts` and a versioned evidence-record schema for verbose resolution outcomes and unresolved/boundary cases.
- [x] Integrate the evidence-based resolver so every materialized semantic relationship writes compact trust and every unresolved/truncated outcome writes an addressable evidence record.
- [x] Update `code-intel/core/src/query/explain-relationship.ts` to return evidence/strategy/coverage on demand without parsing free-form labels.
- [x] Update MCP `blast_radius` internals to propagate weakest-edge certainty, coverage, and boundaries; remove count-only `LOW` when coverage is incomplete.
- [x] Update path/flow/context/PR-impact/suggested-test consumers to preserve trust and never upgrade uncertain input to exact output.
- [x] Update dead-code/orphan analysis to distinguish `not-observed` from proven unused.
- [x] Add additive MCP schemas, OpenAPI fields, web/shared types, and UI wording only where user-visible trust status is exposed.
- [x] Add exact-empty proof tests for direct complete graphs and unresolved-interface/dynamic/import/public-surface counterexamples.
- [x] Add fan-out/depth/result-limit tests proving truncation changes coverage/certainty.
- [x] Add persistence/reopen tests for trust/evidence and failure-injection tests for required evidence write failure.
- [x] Add evidence schema/fingerprint to Generation compatibility and semantic read-back receipts.
- [x] Run 15-language semantic gates, full tests, packed package validation, and OpenSpec validation.
