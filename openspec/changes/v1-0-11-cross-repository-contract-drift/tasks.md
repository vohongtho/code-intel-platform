# Tasks: Cross-Repository Contract Drift

## 1. Baseline inventory

- [ ] 1.1 Inspect `code-intel/core/src/multi-repo/types.ts`, `group-config.ts`, `group-registry.ts`, `group-manager.ts`, `group-sync.ts`, `group-query.ts`, `cross-repo-search.ts`, `schema-parsers/*`, `type-similarity.ts`, `graph-from-db.ts`, plus group-related MCP handlers in `code-intel/core/src/mcp-server/server.ts` and HTTP handlers in `code-intel/core/src/http/app.ts`.
- [ ] 1.2 Document the current persisted/group contract shape for export/route/schema/event/OpenAPI/GraphQL/Protobuf extraction and identify which fields can be extended without breaking existing serialized group state.
- [ ] 1.3 Record existing group identity, repo identity, sync status, cross-repo link and RRF query semantics; drift MUST reuse these identities instead of inventing a parallel workspace registry.

## 2. Contract identity and version model

- [ ] 2.1 Extend `code-intel/core/src/multi-repo/types.ts` with `GroupContractVersion`, `ContractConsumerRef`, `ContractDriftFinding`, `ContractDriftSummary`, `KnownConsumerCoverage`, and discriminated compatibility states.
- [ ] 2.2 Create `code-intel/core/src/multi-repo/contract-identity.ts` for stable contract IDs. HTTP identity MUST use service/repository identity + normalized method/path; schema/event identities MUST use canonical declared identity rather than display-name-only matching.
- [ ] 2.3 Create `code-intel/core/src/multi-repo/contract-fingerprint.ts` to hash semantic content only. Exclude timestamps, row order and absolute machine paths. Include schema version in fingerprint inputs.
- [ ] 2.4 Add explicit `snapshotId`, `semanticFingerprint`, producer/consumer role, source canonical ID, certainty and coverage fields. Older group state without these fields must load conservatively as legacy/unknown, not exact.

## 3. Persisted group state

- [ ] 3.1 Update `code-intel/core/src/multi-repo/group-sync.ts` to write contract versions/fingerprints after each repository sync and preserve existing `group_contracts` output fields.
- [ ] 3.2 Update the group registry/config persistence path (`group-registry.ts`, `group-config.ts`, and related storage helper if ownership is elsewhere) with a versioned migration/read strategy. Never overwrite unreadable group state in place.
- [ ] 3.3 Add read-back validation after group sync: reload persisted contracts and compare stable IDs/fingerprints/consumer references before reporting sync success.
- [ ] 3.4 Update `graph-from-db.ts` only where drift needs reopened graph evidence; do not duplicate graph loading logic inside the comparator.

## 4. Consumer reverse index

- [ ] 4.1 Create `code-intel/core/src/multi-repo/contract-consumer-index.ts` mapping contract IDs/fingerprints to known in-group consumer repository IDs, canonical source IDs, call sites/property usage, and certainty.
- [ ] 4.2 Build the index during/after `group-sync.ts` from existing cross-repo links and graph-aware API contract consumer links. For schemas/events, use exact parser/type references where available.
- [ ] 4.3 Bound reverse expansion with configurable caps and deterministic sorting. Cap hit MUST set lower-bound/partial coverage and MUST NOT be reported as `no consumers`.
- [ ] 4.4 Add tests proving two same-name schemas/events/routes in different repositories/services do not collide.

## 5. Compatibility comparators

- [ ] 5.1 Create `code-intel/core/src/multi-repo/contract-drift/http-comparator.ts` delegating to `semantic/api-contracts/compatibility.ts`; do not reimplement HTTP shape rules.
- [ ] 5.2 Create `code-intel/core/src/multi-repo/contract-drift/schema-comparator.ts` for removed property, newly required property, type-category change, enum narrowing where modeled, and consumer-property usage evidence.
- [ ] 5.3 Create `code-intel/core/src/multi-repo/contract-drift/event-comparator.ts` for topic/name removal, payload-field removal/type change and subscriber usage. Dynamic payloads MUST remain unknown/partial.
- [ ] 5.4 Create `code-intel/core/src/multi-repo/contract-drift/comparator.ts` to dispatch by contract kind and normalize findings to `compatible | potentially-breaking | breaking | unknown` with evidence and coverage.
- [ ] 5.5 Reserve extension interfaces for GraphQL and protobuf/gRPC but do not claim 1.0.11 compatibility support unless implementation/tests are complete.

## 6. Base/head semantic state

- [ ] 6.1 Consume the immutable snapshot API from `v1-0-11-branch-aware-semantic-graph-diff`; do not create another Git checkout/snapshot implementation inside multi-repo.
- [ ] 6.2 Create `code-intel/core/src/multi-repo/contract-drift/service.ts` accepting group ID plus base/head refs or snapshot IDs and loading each repository state independently.
- [ ] 6.3 If any synchronized repository cannot produce requested state, continue only when safe and return `partial` coverage with exact missing repo/ref reasons. Never compare current state as a silent substitute.
- [ ] 6.4 Distinguish presentation `limit` from analysis completeness; calculate total findings before output truncation whenever the underlying analysis is complete.

## 7. Public surfaces

- [ ] 7.1 Register `group_contract_drift` in `code-intel/core/src/mcp-server/server.ts` using existing group selector resolution, stable group IDs, auth/error conventions, pagination style, and additive certainty/coverage fields.
- [ ] 7.2 Add equivalent HTTP endpoint in `code-intel/core/src/http/app.ts` and OpenAPI schema in `code-intel/core/src/http/openapi.ts`.
- [ ] 7.3 Keep `group_list`, `group_sync`, `group_contracts`, `group_query`, and `group_status` backward compatible; no existing tool may require new input solely because drift exists.
- [ ] 7.4 Extend existing `pr_impact` service/handler so a changed repository that belongs to a synchronized group can include a `crossRepositoryContracts` section. Failure to load group drift MUST reduce that section's coverage rather than corrupt local PR impact.
- [ ] 7.5 Connect exact findings to existing flows and `suggest_tests`; heuristic/unknown links may be shown as candidates but cannot upgrade risk to exact without evidence.

## 8. Incremental recomparison

- [ ] 8.1 During `group-sync.ts`, compare previous/new semantic fingerprints and produce changed contract IDs.
- [ ] 8.2 Recompute only changed contracts plus reverse-indexed consumers when dependency closure is known. If fingerprint/index state is legacy/corrupt/unknown, fall back to full group comparison.
- [ ] 8.3 Add convergence tests: incremental group sync + drift must equal fresh full group rebuild for producer change, consumer change, schema rename, repository move/relink and deletion.

## 9. Fixtures and negative cases

- [ ] 9.1 Add integration fixture group with at least four temp Git repositories: backend producer, frontend HTTP consumer, shared schema producer/consumer, and event publisher/subscriber.
- [ ] 9.2 Add exact breaking fixtures: removed HTTP response field used by frontend, required schema field addition, consumed schema field removal, event payload field removal, route deletion and method change.
- [ ] 9.3 Add compatible fixtures: implementation-only change, optional response field addition, unused optional schema field addition, non-consumed field modification where compatibility rules prove safety.
- [ ] 9.4 Add unknown/partial fixtures: unsynchronized repo, missing base ref, dynamic URL, dynamic event payload, ambiguous same-name contract, candidate cap hit and corrupted stored group state.
- [ ] 9.5 Assert `no known in-scope consumer` is never serialized/rendered as `proven unused` unless analysis scope explicitly establishes that stronger guarantee.

## 10. Performance and observability

- [ ] 10.1 Add counters/timers for contracts loaded, fingerprints changed, consumers expanded, comparisons executed, full-fallback count, cap hits, partial repositories and elapsed drift time.
- [ ] 10.2 Add 10/100/1000-contract benchmarks. Large contract/consumer ID sets MUST be bound/processed in batches; do not generate query syntax proportional to contract count.
- [ ] 10.3 Verify deterministic output sorting by repository ID, contract kind, stable contract ID, consumer ID and source anchor.

## 11. Documentation and release notes — mandatory Definition of Done

- [ ] 11.1 Update root `README.md` Repository Groups/Features sections with cross-repository contract drift, supported 1.0.11 contract kinds, `group_contract_drift` usage example, base/head semantics, known-consumer scope and limitations.
- [ ] 11.2 Update root `CHANGELOG.md` under `## [1.0.11]` with group drift capability, compatibility classifications, PR-impact integration, incremental behavior and known limitations/unsupported contract kinds.
- [ ] 11.3 Update any MCP tool inventory and agent-generated multi-repo instructions that enumerate group tools so `group_contract_drift` and its certainty/coverage fields are accurate.
- [ ] 11.4 Documentation is part of completion: README/CHANGELOG MUST be updated in the same release before checking this OpenSpec change complete.

## 12. Release gate

- [ ] 12.1 Run unit/integration/e2e tests for group sync/query/contract drift, build/typecheck/lint and affected MCP benchmarks.
- [ ] 12.2 Reopen persisted group state and repository graph artifacts after sync and compare normalized contract/finding content.
- [ ] 12.3 Run malformed/unknown group scope tests and verify existing fail-closed selector behavior remains unchanged.
- [ ] 12.4 Verify full-vs-incremental convergence and stable output on repeated identical base/head requests before marking all tasks complete.
