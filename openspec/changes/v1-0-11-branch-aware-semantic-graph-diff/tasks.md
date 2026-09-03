# Tasks: Branch-Aware Semantic Graph Diff

## 1. Baseline inventory

- [x] 1.1 Inspect `code-intel/core/src/storage/index-generation.ts`, `index-snapshot.ts`, `index-trust.ts`, `metadata.ts`, `analyze-lock.ts`, `code-intel/core/src/cli/atomic-analyze.ts`, `code-intel/core/src/pipeline/analysis-plan.ts`, `incremental.ts`, `incremental-indexer.ts`, Git change helpers used by `detect_changes`, `code-intel/core/src/multi-repo/graph-from-db.ts`, `code-intel/core/src/mcp-server/server.ts`, `code-intel/core/src/http/app.ts`, and `code-intel/core/src/cli/app.ts`.
- [x] 1.2 Document the exact owner of the current Generation V2 pointer and staging publication contract. Snapshot analysis MUST never call code paths that advance the current-generation pointer. — `publishIndexGeneration` (storage/index-generation.ts) has exactly two call sites in the whole codebase (its own legacy-migration path, and `atomic-analyze.ts`'s parent process); `src/snapshots/*` never imports it. Isolation is enforced two ways: (a) snapshot builds run in a throwaway `git worktree`, entirely outside the real repo's `.code-intel/`, and (b) the snapshot cache lives at `<repoDir>/.code-intel/snapshots/`, a sibling of (never inside) `generations/`, so there is no code path here that can write `current.json` or `generations/<id>`. Verified end-to-end in `tests/integration/snapshots/graph-diff-safety.test.ts` against a real repo, both on success and on failure.
- [x] 1.3 Identify existing commit/tree/ref normalization and Git process helpers. Reuse safe argument-array process execution; do not shell-interpolate refs or paths. — No prior ref-resolution/export helper existed (only `HEAD`-only helpers in `pipeline/incremental.ts`); built from scratch in `snapshots/git-materializer.ts` following that module's `execFileSync('git', [argv], {cwd})` convention. Also independently found and avoided an existing unsafe pattern (`execSync` with string-interpolated `baseRef`) in `detect_changes` (`mcp-server/server.ts`) — noted as a pre-existing issue, not fixed here (out of scope).

## 2. Snapshot descriptor and storage

- [x] 2.1 `code-intel/core/src/snapshots/types.ts`
- [x] 2.2 `code-intel/core/src/snapshots/fingerprint.ts` — reuses the exact same formula as the post-build `AnalyzerCompatibilityReceipt` (extracted into shared `pipeline/compatibility-receipt.ts`, used by both `cli/app.ts` and fingerprinting) so a pre-build cache key and a post-build receipt never drift apart.
- [x] 2.3 `code-intel/core/src/snapshots/paths.ts`
- [x] 2.4 Schema/version metadata (`SNAPSHOT_SCHEMA_VERSION`) — cache.ts rejects and rebuilds any entry whose `schemaVersion` doesn't match, rather than opening it as healthy.

## 3. Safe Git materialization

- [x] 3.1 `code-intel/core/src/snapshots/git-materializer.ts`
- [x] 3.2 Uses `git worktree add --detach`; cleanup (`removeGitWorktree`) is idempotent and scoped only to the worktree directory it created.
- [x] 3.3 Fixtures for spaces/`--`/quotes/shell metacharacters/argument-injection-shaped refs: `tests/unit/snapshots/git-materializer.test.ts`.
- [x] 3.4 Only clean committed refs are supported. `includeDirtyWorkingTree: true` returns an explicit `dirty-working-tree-unsupported` boundary rather than attempting it — a deliberate scope decision (see design.md's "prefer correctness" guidance); no dirty-state fingerprinting was implemented.

## 4. Isolated semantic analysis

- [x] 4.1 `code-intel/core/src/snapshots/snapshot-builder.ts`
- [x] 4.2 No refactor of `atomic-analyze.ts`'s publish path was needed (build vs. publish were already separate); added a `CODE_INTEL_SNAPSHOT_BUILD` internal coordination env var (same idiom as `CODE_INTEL_ATOMIC_CHILD`) so a snapshot build's child `analyze` run skips repo-registry registration for its throwaway worktree path.
- [x] 4.3 Reuses the real `analyze` CLI pipeline via child process (same parser/fact/identity/resolver/graph/BM25 decisions as a normal run) — no forked semantic logic.
- [x] 4.4 Read-back validation reopens graph.db/bm25.db/vector.db/evidence.db via the same primitives `verifyStagingReadBack` uses (DbManager, Bm25Index, VectorIndex, evidence store), parameterized by explicit paths rather than the ambient `CODE_INTEL_INDEX_STAGING_DIR` env var (unsafe to mutate in a shared server process). One check was deliberately loosened from the original: BM25 doc-count vs. graph node-count is not compared, because that comparison has a pre-existing false-positive (`producedCount` counts `cluster`/`flow` nodes that BM25 never indexes) — reproduced independently against plain `code-intel analyze` on a small fixture, unrelated to this feature.
- [x] 4.5 Failed/interrupted builds never leave cache metadata claiming a valid snapshot — staging dirs are removed on any failure path; the cache only promotes a staging dir to a real entry after read-back succeeds.

## 5. Normalized entity and relationship diff

- [x] 5.1 `code-intel/core/src/snapshots/normalizer.ts` — also computes per-node content fingerprints via a new sidecar (`content-fingerprints.ts`, see note below), since the persisted `CodeNode.content` field turned out to be `undefined` for virtually every symbol node kind and truncated to 2000 characters for `file` nodes — discovered via the integration test suite, not assumed.
- [x] 5.2 `code-intel/core/src/snapshots/graph-diff.ts`
- [x] 5.3 Relationships keyed by (canonical source ID, target ID, kind, call-site identity); multiple call sites preserved as distinct deltas — covered in `tests/unit/snapshots/graph-diff.test.ts`.
- [x] 5.4 Certainty/strategy/evidence/confidence/ambiguous changes on otherwise-identical endpoints produce a `changed` relationship delta — covered by test.
- [x] 5.5 Stable-sorted output by canonical ID / relationship key.

**Notable addition beyond the original task list:** `code-intel/core/src/snapshots/content-fingerprints.ts`. Body-only edits and rename/move continuity both depend on a real per-symbol content fingerprint; the graph's own `startLine`/`endLine` also turned out to mark a single anchor line for most node kinds, not a body span. This module computes each node's span heuristically (from its own line to the next node's line, per file, while the build worktree's source is still on disk) and persists it as a `content-fingerprints.json` sidecar per snapshot. Verified against a real analyze run in `tests/integration/snapshots/graph-diff-scenarios.test.ts`. Documented limitation: a container's own content (e.g. a class's `extends` clause) can be under-captured if its span gets truncated by its first member — the common "did this function/method body change" case is unaffected.

## 6. Rename and move correlation

- [x] 6.1 `code-intel/core/src/snapshots/continuity.ts` — content-fingerprint + optional Git rename-detection evidence (`git-materializer.ts` `detectRenamedFiles`). No `DeclarationFragment`/`signatureDiscriminator`-based matching was implemented (no existing rename-detection infrastructure to build on; content-fingerprint matching was judged sufficient and more conservative for an initial implementation).
- [x] 6.2 Display-name match alone never produces `renamed`/`moved` — enforced by construction (correlation groups only by content fingerprint) and covered by test.
- [x] 6.3 Ambiguous candidates (e.g. multiple identical-body overloads) are annotated with `continuity: {certainty: 'candidate'}` and `continuityCandidates` on the original remove/add deltas, never merged.
- [x] 6.4 Overload/same-name fixtures: `tests/unit/snapshots/continuity.test.ts`.

## 7. Higher-level semantic deltas

- [x] 7.1 API contract deltas delegate entirely to `getApiDrift`/`semantic/api-contracts/compatibility.ts` (`SemanticGraphDiff.contracts` wraps its output verbatim — no re-derivation of route pairing/verdicts).
- [x] 7.2 Flow deltas: **not implemented as a comparison** — `flow-detection/*` has no existing diff function (confirmed by inspection), and flow node IDs (`pipeline/phases/flow-phase.ts`) are generated from a per-run enumeration index, not a content fingerprint, so they are not stable across independent analysis runs even when nothing changed. `flow`/`step_of` are excluded from the generic node/edge diff for the same reason clusters are (see 7.3), and `SemanticGraphDiff.flows` always reports `{supported: false, reason: ...}` rather than fabricating deltas.
- [x] 7.3 Cluster deltas: same finding independently confirmed for `cluster`/`belongs_to` (`pipeline/phases/cluster-phase.ts`) — always reports `{supported: false, reason: ...}`.

## 8. Snapshot cache

- [x] 8.1 `code-intel/core/src/snapshots/cache.ts` — max-age/max-count/max-bytes LRU policy (`DEFAULT_SNAPSHOT_CACHE_POLICY`).
- [x] 8.2 Cache lookup reopens and validates (graph/bm25/vector/evidence read-back) before returning a hit; a directory existing with parseable metadata is not sufficient.
- [x] 8.3 Concurrent builds for the same fingerprint: a per-fingerprint lock file coordinates the common case, but a losing request never blocks — it builds independently into its own staging dir and, at promotion time, prefers whatever the lock owner already published (content-equivalent by definition of the fingerprint) rather than racing a directory replace.
- [x] 8.4 Corruption/stale-metadata/missing-artifact/incompatible-schema/interrupted-eviction/stale-lock tests: `tests/integration/snapshots/cache-failure-modes.test.ts`. Found and fixed a real bug during this: a missing `graph.db` on a cache-hit check threw instead of failing validation cleanly (fixed in `cache.ts`'s `loadValidCacheEntry`).

## 9. Existing impact integration

- [x] 9.1 `code-intel/core/src/snapshots/service.ts` — `computeSemanticGraphDiff`, the transport-independent build/load/diff API used by CLI, MCP, and HTTP.
- [x] 9.2 `pr_impact` extended with optional `analysisMode: 'current-graph' | 'semantic-snapshot'` (+ `base_ref`/`head_ref`); default behavior/contract unchanged.
- [x] 9.3 In `semantic-snapshot` mode, the textual-hunk blast radius (`computePRImpact`) is computed and returned alongside the semantic diff, never replaced by it.
- [x] 9.4 A failed/partial base or head never collapses to `diff: null` being mistaken for "no impact" — `SnapshotBuildResult.boundaries`/`.error` are always returned, and `SemanticGraphDiff.coverage.complete`/`.incompleteReasons` propagate partial coverage on the success path.

## 10. CLI, MCP and HTTP surface

- [x] 10.1 `code-intel graph diff --base <ref> --head <ref> [--json] [--no-contracts] [--no-cache]` (`cli/app.ts`) — calls `snapshots/service.ts` only.
- [x] 10.2 New MCP tool `graph_diff` (paginated `nodes`/`relationships`, `offset`/`limit`/`total`/`hasMore` — the codebase's real pagination convention; `_tokenProp` is an auth token, not a cursor). Judged to carry unique value over `pr_impact`'s enrichment: dedicated pagination for large diffs, and no need to frame the request as PR-shaped.
- [x] 10.3 HTTP route `POST /api/v1/graph/diff` (`http/app.ts`, gated `requireAuth` + `requireRole('analyst')` like other compute-heavy routes) + `openapi.ts` schema entry.
- [x] 10.4 Refs are resolved (`resolveGitRef`) before any expensive analysis, and resolution failures produce an `unknown-ref`/`failed` result rather than falling back to the ambient/currently-active repo graph — verified by test (`graph-diff-safety.test.ts`'s unknown-ref and unsafe-ref cases).

## 11. Web UI

- [x] 11.1 Wire types (`code-intel/web/src/api/graph-diff-types.ts`, mirroring `snapshots/types.ts` field-for-field) and `ApiClient.graphDiff()` (`code-intel/web/src/api/client.ts`) — a 422 "diff unavailable" response is a discriminated `{status:'unavailable'}` outcome, not a thrown exception.
- [x] 11.2 `code-intel/web/src/pages/GraphDiffPage.tsx` (routed at `/diff`, reachable from the header user menu): base/head ref inputs, added/removed/changed/moved/renamed node deltas, added/removed/changed relationship deltas, a visually distinct treatment for certainty degradation, and a coverage banner.
- [x] 11.3 Filters by entity kind, relationship kind, contract/flow presence, and certainty; the coverage banner remains visible regardless of active filters.
- [x] 11.4 `code-intel/web/src/pages/GraphDiffPage.test.tsx` + `client.test.ts` additions: empty/exact diff, partial coverage, the 422 unavailable case, and paginated large-diff `hasMore` behavior.

Implemented in an isolated worktree, then manually reconciled onto the current tree (the worktree's base commit predated most of this session's and several prior sessions' work, so it could not be merged directly — its 7 changed/added files were applied by hand file-by-file). Verified after reconciliation: `tsc -b` clean, `vitest run` 48/48 passing.

## 12. Incremental/full convergence

- [ ] 12.1 **Not implemented.** The snapshot builder always performs a full temporary analysis; there is no seeding from a cached parent snapshot. This is a deliberate initial-scope decision, not an oversight: `incremental/rollout-gate.ts`'s own comments describe dependency-aware incremental resolution as not proven in production today, and design.md/proposal.md both call for preferring correctness over unsafe incremental shortcuts as the initial implementation.
- [x] 12.2 Trivially satisfied by 12.1: with no incremental seeding path at all, there is no way to publish a truncated snapshot via that path.
- [~] 12.3 Convergence fixtures implemented in the sense of "the one build path is correct across these change categories end-to-end" (body-only edit, added/removed function, added/removed call — this last one currently unverifiable: see note), not "full build == incremental build" (no incremental build exists to compare against). See `tests/integration/snapshots/graph-diff-scenarios.test.ts`. Rename/move fixtures are covered separately under §6 (unit-level, `continuity.test.ts`) since they don't require change-detection through a real pipeline run.
- [ ] 12.4 Not applicable given 12.1's scope decision (no incremental build output to compare against a full build's).

## 13. Scale, failure and safety tests

- [ ] 13.1 **Not implemented at 10k/100k scale.** Given the resources available for this pass, large-scale synthetic benchmarking was deferred; what exists instead is correctness testing (§5/§6/§8 unit + integration tests) and the architectural guarantee that node/relationship diffing is `Map`-keyed (O(n) merge, no per-item query expressions), so it does not grow linearly in *expression depth* with item count by construction — but this has not been empirically benchmarked at the specified scale.
- [ ] 13.2 Memory/time counters per phase: not implemented. `SnapshotBuildResult.durationMs` exists (whole-build wall time only), not broken out per phase (materialization/build/reopen/normalize/diff).
- [x] 13.3 Failure tests implemented for: unknown ref, ref that looks like a CLI flag (argument-injection shape), analysis failure (via corrupted cache entries forcing rebuild — `cache-failure-modes.test.ts`), corrupt cache, missing artifact, incompatible schema, stale build lock. **Not implemented:** candidate cap, read-only cache directory, mid-build process interruption (SIGKILL of the child).
- [x] 13.4 Explicitly asserted before/after every test: Git HEAD, tracked working-tree status, `current.json` existence, `generations/` existence, and the global repo registry are unchanged — on both the success path and every failure path (`graph-diff-safety.test.ts`).

## 14. Documentation and release notes — mandatory Definition of Done

- [x] 14.1 README.md updated with the semantic graph diff capability, `code-intel graph diff` example, `pr_impact` snapshot mode, exact-vs-partial semantics, cache behavior, and limitations.
- [x] 14.2 CHANGELOG.md updated under `## [1.0.11]`.
- [~] 14.3 CLI help text (`--help` output) documents the new command directly (`addHelpText`); no separately-generated agent-instruction doc enumerating impact/change commands was found to need updating.
- [x] 14.4 Completed as part of this update.

## 15. Release gate

- [~] 15.1 Full unit/integration suite for the new `snapshots/` module passes (49/49 — grew from 46 after the Web UI reconciliation added no new core tests, count includes the cache-failure-modes suite). Also ran a targeted regression pass (`--test-concurrency=1`, matching the official test script) over every existing test file for modules this change touched (`cli/app.ts`, `mcp-server/server.ts`, `http/app.ts`): 260 tests, 259 passing. The one failure (`pr-impact.test.ts` "assigns LOW risk to a leaf function with no callers") is confirmed pre-existing and unrelated — `git diff` against this change's base commit shows zero diff in `query/pr-impact.ts`, `query/trust.ts`, or its test file. `code-intel/web`: `tsc -b` clean, `vitest run` 48/48 passing. Whole-repository `npm test` (which also runs a 15-language semantic gate and MCP benchmarks) was not run in full as part of this pass.
- [x] 15.2 Snapshot reopen/read-back is exercised by every test in `graph-diff-safety.test.ts` and `cache-failure-modes.test.ts`; a repeated build against the same commit is proven byte-identical for its `snapshotId` (`fingerprint.test.ts`) and served from cache on the second call (`graph-diff-safety.test.ts`).
- [x] 15.3 Proven by test: Generation V2's `current.json` and `generations/` are asserted absent/unchanged after every read-only diff, success or failure (`graph-diff-safety.test.ts`).
- [x] 15.4 Proven by test: an unresolvable or unsafe base ref never produces a diff object — `diff` is `null` and `base.status === 'failed'` (`graph-diff-safety.test.ts`).
