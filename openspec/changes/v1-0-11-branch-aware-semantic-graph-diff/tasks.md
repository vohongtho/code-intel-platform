# Tasks: Branch-Aware Semantic Graph Diff

## 1. Baseline inventory

- [ ] 1.1 Inspect `code-intel/core/src/storage/index-generation.ts`, `index-snapshot.ts`, `index-trust.ts`, `metadata.ts`, `analyze-lock.ts`, `code-intel/core/src/cli/atomic-analyze.ts`, `code-intel/core/src/pipeline/analysis-plan.ts`, `incremental.ts`, `incremental-indexer.ts`, Git change helpers used by `detect_changes`, `code-intel/core/src/multi-repo/graph-from-db.ts`, `code-intel/core/src/mcp-server/server.ts`, `code-intel/core/src/http/app.ts`, and `code-intel/core/src/cli/app.ts`.
- [ ] 1.2 Document the exact owner of the current Generation V2 pointer and staging publication contract. Snapshot analysis MUST never call code paths that advance the current-generation pointer.
- [ ] 1.3 Identify existing commit/tree/ref normalization and Git process helpers. Reuse safe argument-array process execution; do not shell-interpolate refs or paths.

## 2. Snapshot descriptor and storage

- [ ] 2.1 Create `code-intel/core/src/snapshots/types.ts` defining `SemanticSnapshotDescriptor`, `SnapshotBuildRequest`, `SnapshotBuildResult`, `SnapshotBoundary`, `EntityDelta`, `RelationshipDelta`, `SemanticGraphDiff`, and cache metadata.
- [ ] 2.2 Create `code-intel/core/src/snapshots/fingerprint.ts` computing snapshot identity from repository identity, Git tree/dirty-state fingerprint, parser/fact/identity/resolver/graph schema fingerprints and optional API-contract fingerprint. Exclude `createdAt` and machine-specific paths.
- [ ] 2.3 Create `code-intel/core/src/snapshots/paths.ts` defining isolated cache/staging layout under repository-managed Code Intel data. Snapshot paths MUST be outside the published Generation V2 pointer path.
- [ ] 2.4 Add snapshot schema/version metadata and reject/rebuild incompatible cache entries instead of opening them as healthy.

## 3. Safe Git materialization

- [ ] 3.1 Create `code-intel/core/src/snapshots/git-materializer.ts` using existing Git execution helpers to resolve refs to immutable tree/commit IDs and materialize source without changing the user's checkout.
- [ ] 3.2 Prefer Git object/tree export or isolated temporary worktree. If worktrees are used, ensure cleanup is ownership-safe and interruption cannot delete a user-created directory.
- [ ] 3.3 Add fixtures for refs/paths containing spaces, `--`, quotes and shell metacharacters. All invocations MUST pass arguments without shell interpolation.
- [ ] 3.4 Support clean committed refs first. If dirty working-tree snapshot support is implemented, include staged/unstaged/untracked/deleted state in `dirtyStateFingerprint`; otherwise return an explicit unsupported boundary.

## 4. Isolated semantic analysis

- [ ] 4.1 Create `code-intel/core/src/snapshots/snapshot-builder.ts` that invokes the existing analysis pipeline against an explicit source root and explicit artifact destination.
- [ ] 4.2 Refactor `atomic-analyze.ts` / Generation V2 helpers only as needed to separate `build artifacts` from `publish current generation`; normal `analyze` still publishes, snapshot build never publishes.
- [ ] 4.3 Reuse parser, semantic fact, identity, resolver, graph, BM25/vector decisions from the selected analysis plan. Do not fork semantic logic for snapshots.
- [ ] 4.4 After build, reopen graph/evidence/metadata artifacts using existing trust/read-back helpers. Cache entry becomes usable only after reopen validation succeeds.
- [ ] 4.5 Interrupted/failed builds MUST leave no cache metadata claiming a valid snapshot. Clean only lock-owned temporary data.

## 5. Normalized entity and relationship diff

- [ ] 5.1 Create `code-intel/core/src/snapshots/normalizer.ts` to produce deterministic semantic records from reopened graph state. Remove volatile timestamps, storage IDs/order and machine-local paths.
- [ ] 5.2 Create `code-intel/core/src/snapshots/graph-diff.ts` comparing canonical node IDs and semantic properties into `added | removed | changed` deltas.
- [ ] 5.3 Compare relationships by canonical source ID, target ID, relationship kind and call-site identity from Symbol Identity V2. Preserve multiple call sites between the same source/target/kind.
- [ ] 5.4 Treat certainty/evidence strategy/coverage changes as relationship changes even when source and target IDs remain identical.
- [ ] 5.5 Stable-sort all output by canonical entity ID, relationship key and property key so repeated runs are byte/diff stable after JSON normalization.

## 6. Rename and move correlation

- [ ] 6.1 Create `code-intel/core/src/snapshots/continuity.ts` using canonical identity continuity, declaration fingerprint, content fingerprint and Git move evidence where available.
- [ ] 6.2 A display-name match alone MUST NOT produce `renamed` or `moved`.
- [ ] 6.3 When continuity is ambiguous, emit remove+add plus optional candidate-correlation metadata with reduced certainty.
- [ ] 6.4 Add overload/same-name fixtures proving unrelated symbols across refs are never merged into one rename.

## 7. Higher-level semantic deltas

- [ ] 7.1 Add optional API contract deltas by delegating to `semantic/api-contracts/compatibility.ts`; do not duplicate contract comparison rules in `graph-diff.ts`.
- [ ] 7.2 Compare existing flow nodes/relationships from `code-intel/core/src/flow-detection/*` and emit flow membership/path changes when stable identities exist.
- [ ] 7.3 Compare cluster/community assignments only if current clustering output has stable cross-run identity; otherwise mark cluster diff unsupported/heuristic rather than fabricate exact changes.

## 8. Snapshot cache

- [ ] 8.1 Create `code-intel/core/src/snapshots/cache.ts` keyed by semantic snapshot fingerprint with max-age/max-count/max-bytes policy.
- [ ] 8.2 Cache lookup MUST reopen and validate required artifacts/metadata before returning a hit. Timestamp freshness alone is insufficient.
- [ ] 8.3 Implement lock/ownership behavior so concurrent snapshot builds for the same fingerprint either share a completed entry or isolate staging safely.
- [ ] 8.4 Add corruption, stale metadata, missing graph, incompatible schema, partial deletion and interrupted-eviction tests.

## 9. Existing impact integration

- [ ] 9.1 Implement `code-intel/core/src/snapshots/service.ts` as the transport-independent API for build/load/diff.
- [ ] 9.2 Extend the existing `pr_impact` request in `code-intel/core/src/mcp-server/server.ts` with optional `analysisMode: current-graph | semantic-snapshot`, preserving the current default contract until snapshot mode is production-proven.
- [ ] 9.3 In semantic-snapshot mode, retain textual Git hunks as evidence and add semantic node/relationship/API/flow deltas. Do not replace line-diff evidence.
- [ ] 9.4 If either side is partial/failed, propagate partial/unknown coverage and never return `no semantic impact` as an exact conclusion.

## 10. CLI, MCP and HTTP surface

- [ ] 10.1 Add `code-intel graph diff --base <ref> --head <ref> [--json]` wiring in `code-intel/core/src/cli/app.ts`; implementation must call `snapshots/service.ts`, not contain diff logic.
- [ ] 10.2 Register a semantic graph-diff MCP tool only if it returns unique snapshot delta data not already expressible by `pr_impact`; use existing repo/scope resolution and pagination conventions.
- [ ] 10.3 Add equivalent HTTP route in `code-intel/core/src/http/app.ts` and schema in `code-intel/core/src/http/openapi.ts`.
- [ ] 10.4 Ensure base/head refs are validated before expensive analysis and malformed refs do not widen repository scope or fall back to ambient repo.

## 11. Web UI

- [ ] 11.1 Add Web API client types/calls under `code-intel/web/src` after HTTP schema stabilizes.
- [ ] 11.2 Add semantic diff view for added/removed/changed nodes/relationships and certainty degradation. Use current graph explorer components where possible.
- [ ] 11.3 Add filters for entity kind, relationship kind, API/flow delta and certainty. Partial coverage MUST remain visible while filtering.
- [ ] 11.4 Add Web tests for empty exact diff, partial diff, cache/build error and large paginated diff.

## 12. Incremental/full convergence

- [ ] 12.1 Where dependency-aware semantic incremental resolution is reusable, allow snapshot builder to seed from a compatible cached parent snapshot only through the shared artifact delta plan.
- [ ] 12.2 If invalidation closure cannot be proven complete, build that snapshot fully. Never publish a truncated semantic snapshot.
- [ ] 12.3 Add convergence fixtures for body-only edit, rename, move, deletion, added/removed call, overload change, route shape change and certainty degradation.
- [ ] 12.4 Compare normalized node/edge/evidence/API/flow content between full and incremental snapshot builds, not only counts.

## 13. Scale, failure and safety tests

- [ ] 13.1 Add large-diff benchmark with 1, 100, 10k and 100k Git hunks/changed entities. Graph query syntax MUST NOT grow linearly in expression depth with item count; bind/batch IDs instead.
- [ ] 13.2 Add memory/time counters for source materialization, snapshot build, reopen, normalization and diff phases.
- [ ] 13.3 Add failure tests for unknown ref, deleted ref, source materialization failure, analysis failure, corrupt cache, candidate cap, read-only cache and process interruption.
- [ ] 13.4 Assert before/after current Generation V2 pointer, user's Git HEAD/index/worktree state and active repository registry are unchanged after every read-only diff success/failure test.

## 14. Documentation and release notes — mandatory Definition of Done

- [ ] 14.1 Update root `README.md` with semantic graph diff capability, `code-intel graph diff` example, `pr_impact` snapshot mode, exact-vs-partial semantics, cache behavior and limitations.
- [ ] 14.2 Update root `CHANGELOG.md` under `## [1.0.11]` with branch-aware snapshots, semantic node/edge/API/flow deltas, new public surface, cache/isolation behavior and known limitations.
- [ ] 14.3 Update MCP/CLI documentation or generated agent instructions that enumerate impact/change commands so examples match final runtime schemas and flags.
- [ ] 14.4 README/CHANGELOG updates MUST be completed and validated against production help/schema output before this OpenSpec change is marked complete.

## 15. Release gate

- [ ] 15.1 Run unit/integration/e2e tests, build/typecheck/lint, affected MCP benchmark and canonical 15-language semantic gate.
- [ ] 15.2 Run snapshot reopen/read-back and deterministic repeated-run checks.
- [ ] 15.3 Prove read-only graph diff never advances or mutates the current Generation V2 publication pointer.
- [ ] 15.4 Prove a failed/partial base or head can never be serialized as an exact clean semantic diff.
