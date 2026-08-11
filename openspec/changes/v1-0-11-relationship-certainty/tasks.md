# Tasks

- [ ] Add shared `RelationshipTrust`, `AnalysisCertainty`, `AnalysisCoverage`, and `AnalysisBoundary` contracts under a focused evidence/trust module; add discriminated-union unit tests.
- [ ] Extend shared `CodeEdge` additively with call-site/confidence/certainty/strategy/resolver/evidence/ambiguity fields while retaining legacy `weight`/`label`.
- [ ] Modify `code-intel/core/src/storage/schema.ts` relation DDL and all CSV/bulk/load/export paths to persist/reopen compact trust fields.
- [ ] Create `code-intel/core/src/evidence/store.ts` and a versioned evidence-record schema for verbose resolution outcomes and unresolved/boundary cases.
- [ ] Integrate the evidence-based resolver so every materialized semantic relationship writes compact trust and every unresolved/truncated outcome writes an addressable evidence record.
- [ ] Update `code-intel/core/src/query/explain-relationship.ts` to return evidence/strategy/coverage on demand without parsing free-form labels.
- [ ] Update MCP `blast_radius` internals to propagate weakest-edge certainty, coverage, and boundaries; remove count-only `LOW` when coverage is incomplete.
- [ ] Update path/flow/context/PR-impact/suggested-test consumers to preserve trust and never upgrade uncertain input to exact output.
- [ ] Update dead-code/orphan analysis to distinguish `not-observed` from proven unused.
- [ ] Add additive MCP schemas, OpenAPI fields, web/shared types, and UI wording only where user-visible trust status is exposed.
- [ ] Add exact-empty proof tests for direct complete graphs and unresolved-interface/dynamic/import/public-surface counterexamples.
- [ ] Add fan-out/depth/result-limit tests proving truncation changes coverage/certainty.
- [ ] Add persistence/reopen tests for trust/evidence and failure-injection tests for required evidence write failure.
- [ ] Add evidence schema/fingerprint to Generation compatibility and semantic read-back receipts.
- [ ] Run 15-language semantic gates, full tests, packed package validation, and OpenSpec validation.
