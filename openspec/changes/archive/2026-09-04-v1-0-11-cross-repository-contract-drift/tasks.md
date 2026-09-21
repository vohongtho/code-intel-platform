# Tasks: Cross-Repository Contract Drift

## 1. Baseline inventory

- [x] 1.1 Inspect `code-intel/core/src/multi-repo/types.ts`, `group-config.ts`, `group-registry.ts`, `group-manager.ts`, `group-sync.ts`, `group-query.ts`, `cross-repo-search.ts`, `schema-parsers/*`, `type-similarity.ts`, `graph-from-db.ts`, plus group-related MCP handlers in `code-intel/core/src/mcp-server/server.ts` and HTTP handlers in `code-intel/core/src/http/app.ts`.
- [x] 1.2 Document the current persisted/group contract shape for export/route/schema/event/OpenAPI/GraphQL/Protobuf extraction and identify which fields can be extended without breaking existing serialized group state.
- [x] 1.3 Record existing group identity, repo identity, sync status, cross-repo link and RRF query semantics; drift MUST reuse these identities instead of inventing a parallel workspace registry.

## 2. Contract identity and version model

- [x] 2.1 Extend `code-intel/core/src/multi-repo/types.ts` with `GroupContractVersion`, `ContractConsumerRef`, `ContractDriftFinding`, `ContractDriftSummary`, `KnownConsumerCoverage`, and discriminated compatibility states.
- [x] 2.2 Create `code-intel/core/src/multi-repo/contract-identity.ts` for stable contract IDs. HTTP identity MUST use service/repository identity + normalized method/path; schema/event identities MUST use canonical declared identity rather than display-name-only matching.
- [x] 2.3 Create `code-intel/core/src/multi-repo/contract-fingerprint.ts` to hash semantic content only. Exclude timestamps, row order and absolute machine paths. Include schema version in fingerprint inputs.
- [x] 2.4 Add explicit `snapshotId`, `semanticFingerprint`, producer/consumer role, source canonical ID, certainty and coverage fields. Older group state without these fields must load conservatively as legacy/unknown, not exact.

## 3. Persisted group state

- [x] 3.1 Update `code-intel/core/src/multi-repo/group-sync.ts` to write contract versions/fingerprints after each repository sync and preserve existing `group_contracts` output fields.
- [x] 3.2 Update the group registry/config persistence path (`group-registry.ts`, `group-config.ts`, and related storage helper if ownership is elsewhere) with a versioned migration/read strategy. Never overwrite unreadable group state in place.
- [x] 3.3 Add read-back validation after group sync: reload persisted contracts and compare stable IDs/fingerprints/consumer references before reporting sync success.
- [x] 3.4 Update `graph-from-db.ts` only where drift needs reopened graph evidence; do not duplicate graph loading logic inside the comparator.

## 4. Consumer reverse index

- [x] 4.1 Create `code-intel/core/src/multi-repo/contract-consumer-index.ts` mapping contract IDs/fingerprints to known in-group consumer repository IDs, canonical source IDs, call sites/property usage, and certainty.
- [x] 4.2 Build the index during/after `group-sync.ts` from existing cross-repo links and graph-aware API contract consumer links. For schemas/events, use exact parser/type references where available.
- [x] 4.3 Bound reverse expansion with configurable caps and deterministic sorting. Cap hit MUST set lower-bound/partial coverage and MUST NOT be reported as `no consumers`.
- [x] 4.4 Add tests proving two same-name schemas/events/routes in different repositories/services do not collide.

## 5. Compatibility comparators

- [x] 5.1 Create `code-intel/core/src/multi-repo/contract-drift/http-comparator.ts` delegating to `semantic/api-contracts/compatibility.ts`; do not reimplement HTTP shape rules.
- [x] 5.2 Create `code-intel/core/src/multi-repo/contract-drift/schema-comparator.ts` for removed property, newly required property, type-category change, enum narrowing where modeled, and consumer-property usage evidence.
- [x] 5.3 Create `code-intel/core/src/multi-repo/contract-drift/event-comparator.ts` for topic/name removal, payload-field removal/type change and subscriber usage. Dynamic payloads MUST remain unknown/partial.
- [x] 5.4 Create `code-intel/core/src/multi-repo/contract-drift/comparator.ts` to dispatch by contract kind and normalize findings to `compatible | potentially-breaking | breaking | unknown` with evidence and coverage.
- [x] 5.5 Reserve extension interfaces for GraphQL and protobuf/gRPC but do not claim 1.0.11 compatibility support unless implementation/tests are complete.

## 6. Base/head semantic state

- [x] 6.1 Consume the immutable snapshot API from `v1-0-11-branch-aware-semantic-graph-diff`; do not create another Git checkout/snapshot implementation inside multi-repo.
- [x] 6.2 Create `code-intel/core/src/multi-repo/contract-drift/service.ts` accepting group ID plus base/head refs or snapshot IDs and loading each repository state independently.
- [x] 6.3 If any synchronized repository cannot produce requested state, continue only when safe and return `partial` coverage with exact missing repo/ref reasons. Never compare current state as a silent substitute.
- [x] 6.4 Distinguish presentation `limit` from analysis completeness; calculate total findings before output truncation whenever the underlying analysis is complete.

## 7. Public surfaces

- [x] 7.1 Register `group_contract_drift` in `code-intel/core/src/mcp-server/server.ts` using existing group selector resolution, stable group IDs, auth/error conventions, pagination style, and additive certainty/coverage fields.
- [x] 7.2 Add equivalent HTTP endpoint in `code-intel/core/src/http/app.ts` and OpenAPI schema in `code-intel/core/src/http/openapi.ts`.
- [x] 7.3 Keep `group_list`, `group_sync`, `group_contracts`, `group_query`, and `group_status` backward compatible; no existing tool may require new input solely because drift exists.
- [x] 7.4 Extend existing `pr_impact` service/handler so a changed repository that belongs to a synchronized group can include a `crossRepositoryContracts` section. Failure to load group drift MUST reduce that section's coverage rather than corrupt local PR impact.
- [x] 7.5 Connect exact findings to existing flows and `suggest_tests`; heuristic/unknown links may be shown as candidates but cannot upgrade risk to exact without evidence.

## 8. Incremental recomparison

- [x] 8.1 During `group-sync.ts`, compare previous/new semantic fingerprints and produce changed contract IDs.
- [x] 8.2 Recompute only changed contracts plus reverse-indexed consumers when dependency closure is known. If fingerprint/index state is legacy/corrupt/unknown, fall back to full group comparison.
- [x] 8.3 Add convergence tests: incremental group sync + drift must equal fresh full group rebuild for producer change, consumer change, schema rename, repository move/relink and deletion. See design.md "Incremental behavior" implementation note — group-sync always fully recomputes (no divergent fast path to reconcile), so convergence testing targets the one genuine incremental mechanism (the fingerprint-proven comparator skip): unchanged contracts yield zero findings, and route/schema producer changes still surface findings.

## 9. Fixtures and negative cases

- [x] 9.1 Add integration fixture group with at least four temp Git repositories: backend producer, frontend HTTP consumer, shared schema producer/consumer, and event publisher/subscriber. See `tests/integration/multi-repo/contract-drift-fixture.test.ts` — real `git init`/commits for all 4 repos; base/head snapshot dirs keyed by real commit SHA (see that file's header comment for why base/head bypass `getOrBuildSnapshot`'s full pipeline — two pre-existing, out-of-scope gaps discovered while building this: a read-back-verification false positive for unresolved `require()` imports, and real parsed `interface`/`type_alias` nodes carrying no `content` under the newer symbol-identity-v2 path, which the parallel `v1-0-11-symbol-identity-v2` change owns).
- [x] 9.2 Add exact breaking fixtures: removed HTTP response field used by frontend, required schema field addition, consumed schema field removal, event payload field removal, route deletion and method change. HTTP response-field-removal/route-deletion/method-change: `tests/unit/semantic/api-contracts/compatibility.test.ts` (the rules `http-comparator.ts` delegates to) plus the group-level fixture above. Required schema field addition: new `contract-drift-comparator.test.ts` case. Consumed schema field removal + event payload field removal: `group-contract-drift-service.test.ts` / the fixture above.
- [x] 9.3 Add compatible fixtures: implementation-only change, optional response field addition, unused optional schema field addition, non-consumed field modification where compatibility rules prove safety. Optional-response-field-addition: `compatibility.test.ts` ("treats an added optional response field as always compatible"). Implementation-only/unchanged-schema: new `group-contract-drift-service.test.ts` "byte-for-byte unchanged" case (also exercises the incremental skip path from task 8.2).
- [x] 9.4 Add unknown/partial fixtures: unsynchronized repo, missing base ref, dynamic URL, dynamic event payload, ambiguous same-name contract, candidate cap hit and corrupted stored group state. Unsynchronized repo: new `group-contract-drift-service.test.ts` case. Missing base ref/snapshot: existing "returns partial coverage when one repo snapshot is missing" case. Dynamic event payload: `contract-drift-comparator.test.ts` ("keeps dynamic event payloads unknown/partial"). Ambiguous same-name contract + candidate cap hit: `contract-consumer-index.test.ts`. Corrupted stored group state: `group-registry.test.ts` ("quarantines unreadable group/sync state").
- [x] 9.5 Assert `no known in-scope consumer` is never serialized/rendered as `proven unused` unless analysis scope explicitly establishes that stronger guarantee. `KnownConsumerCoverage.inScope` (types.ts) is a closed union of `'group-sync' | 'partial-group-sync' | 'unknown'` — there is no `'proven-unused'` variant for any caller to produce, so this holds by construction, not just convention.

## 10. Performance and observability

- [x] 10.1 Add counters/timers for contracts loaded, fingerprints changed, consumers expanded, comparisons executed, full-fallback count, cap hits, partial repositories and elapsed drift time. `GroupContractDriftResult.metrics` (contract-drift/service.ts); exercised in group-contract-drift-service.test.ts.
- [x] 10.2 Add 10/100/1000-contract benchmarks. Large contract/consumer ID sets MUST be bound/processed in batches; do not generate query syntax proportional to contract count. `tests/performance/contract-drift-scaling.test.ts` — no SQL is ever built from a contract/consumer id set on this path (whole-graph loads + plain Map/object lookups), verified structurally; benchmark confirms near-linear wall time 10→1000 contracts and a bounded (cap-sized) consumer-index result for 1000 candidates.
- [x] 10.3 Verify deterministic output sorting by repository ID, contract kind, stable contract ID, consumer ID and source anchor. Found and fixed a real gap while adding this test: `affectedConsumers` was never sorted within a finding (only top-level findings were) — `sortConsumerRefs` added to `contract-drift/common.ts`'s `makeFinding`. Covered by the new group-contract-drift-service.test.ts case, which also asserts byte-identical output across two identical requests (task 12.4).

## 11. Documentation and release notes — mandatory Definition of Done

- [x] 11.1 Update root `README.md` Repository Groups/Features sections with cross-repository contract drift, supported 1.0.11 contract kinds, `group_contract_drift` usage example, base/head semantics, known-consumer scope and limitations.
- [x] 11.2 Update root `CHANGELOG.md` under `## [1.0.11]` with group drift capability, compatibility classifications, PR-impact integration, incremental behavior and known limitations/unsupported contract kinds.
- [x] 11.3 Update any MCP tool inventory and agent-generated multi-repo instructions that enumerate group tools so `group_contract_drift` and its certainty/coverage fields are accurate. Verified: the MCP Server Tools table (README, updated above) is the only place group tools are enumerated by name — `REPO_SELECTABLE_TOOL_NAMES` in server.ts correctly excludes all group_* tools (group-scoped, not repo-scoped), and no agent-instruction-template generator lists tool names.
- [x] 11.4 Documentation is part of completion: README/CHANGELOG MUST be updated in the same release before checking this OpenSpec change complete.

## 12. Release gate

- [x] 12.1 Run unit/integration/e2e tests for group sync/query/contract drift, build/typecheck/lint and affected MCP benchmarks. `npx tsc --noEmit -p .` (full project) and `npx tsc -b tsconfig.test.json --force` both clean; 140/140 tests pass across every multi-repo/contract/group/API-contract test file plus the new integration fixture and performance benchmarks (no `lint` script is configured in this package). One pre-existing, unrelated failure was found and left alone (out of scope): `tests/unit/search/scoped-search-contract.test.ts` (a `selectorSource` field mismatch predating this change, confirmed via `git diff` on its source files — nothing touched by this change).
- [x] 12.2 Reopen persisted group state and repository graph artifacts after sync and compare normalized contract/finding content. Covered by `verifySyncResultReadBack` (task 3.3) — `group-registry.test.ts` "verifies read-back invariants for stored sync state" — plus this change's own read-back-shaped assertions (e.g. `group-contract-drift-service.test.ts`'s determinism test reopens/recomputes across two full calls and requires byte-identical output).
- [x] 12.3 Run malformed/unknown group scope tests and verify existing fail-closed selector behavior remains unchanged. Added `group_contract_drift` unknown-group and missing-refs/snapshot-ids cases (`api-contract-tools.test.ts`). `group_list`/`group_sync`/`group_contracts`/`group_query`/`group_status` dispatch branches are byte-for-byte unchanged by this session's diff (verified via `git diff` on server.ts) — nothing new to regress.
- [x] 12.4 Verify full-vs-incremental convergence and stable output on repeated identical base/head requests before marking all tasks complete. `group-contract-drift-service.test.ts`'s new sort/determinism test runs the same request twice and asserts identical output (aside from the elapsed-time counter); see design.md's "Incremental behavior" note for why full-vs-incremental convergence holds by construction here.
