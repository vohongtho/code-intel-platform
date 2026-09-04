# Design: Incremental Semantic-Snapshot Seeding

Status: proposed
Author: Claude (session with thomas.vo), 2026-09-04
Relates to: `v1-0-11-branch-aware-semantic-graph-diff` (archived; this is deliberately a new, separate change, not a reopening)

## Problem

Every semantic snapshot build (`buildIsolatedSnapshot`, `code-intel/core/src/snapshots/snapshot-builder.ts`) runs a full temporary `analyze` in a throwaway Git worktree, even when the target ref is a small delta from a snapshot already cached for a nearby commit. `v1-0-11-branch-aware-semantic-graph-diff` deliberately deferred incremental seeding (its tasks 12.1/12.4) because the underlying dependency-aware incremental engine, while fully built (`code-intel/core/src/incremental/*`), had never been wired into any live call site — `atomic-analyze.ts` and `app.ts` both call `planAtomicAnalysis` with `dependencyAwareDelta` always `undefined`, so its success branch can never fire in production today (see `rollout-gate.ts`'s own doc comment).

This change is that first live wiring — deliberately scoped to snapshot builds (cache entries are disposable and rebuildable, never the canonical published generation) rather than the real Generation V2 pipeline, so a wrong result costs a slower fallback, never index corruption.

## Naming note

This codebase has two unrelated things called "snapshot":
- `storage/index-snapshot.ts`'s `IndexSnapshot` — a reference to the most-recently-published generation's artifacts, used today by `seedIndexGeneration` (`cli/atomic-analyze.ts`) to seed a *new generation's* staging dir.
- `snapshots/*`'s `SemanticSnapshotDescriptor` — an isolated diff-snapshot of one Git ref, cached under `.code-intel/snapshots/` (this feature's subject).

This design reuses `seedIndexGeneration`'s *pattern* (clone named artifacts into a fresh staging dir before the child `analyze` runs) but is not that function — the new function is named `seedFromParentSnapshot` to stay textually distinct.

## Goals

- Seed a snapshot build for ref `head` from an already-cached snapshot for a nearby ref, when both are eligible, cutting a re-run diff request's cost from two full analyses to (ideally) one or zero.
- Prove correctness via a convergence test suite (incrementally-seeded result byte-identical to an independent full build's normalized diff output) before merging — mirroring how the real pipeline's `rollout-gate.ts` gate is meant to be earned, scoped to this feature.
- Ship behind an explicit opt-in flag, independent of and composed with the real pipeline's existing `CODE_INTEL_INCREMENTAL_SEMANTIC_ENABLED` kill-switch.

## Non-goals

- Expanding eligibility beyond the 6 fact-based languages (TS, JS, Python, Rust, HTML, Go) that `isEligibleForIncrementalPublication` already recognizes.
- Wiring `dependencyAwareDelta` into the *real* Generation V2 pipeline's own publication path (`atomic-analyze.ts`'s parent-process call, `app.ts`'s `decideIncremental`). This change proves the engine out via the lower-stakes snapshot path only; wiring the real pipeline stays a separate future decision, to be made with this change's production data in hand.
- Dirty-working-tree seeding (still explicitly unsupported for snapshots at all, unrelated to this change).
- Chained incremental seeding (incremental-from-incremental) — see "Seed-chain depth" below.
- Cross-schema-version seeding — already impossible by construction: a different analyzer/schema fingerprint is a different, uncached `snapshotId`, so it can never match an existing cache entry to seed from.

## Architecture

### Data flow

`buildIsolatedSnapshot` gains a pre-materialization step, only attempted when `isSnapshotIncrementalSeedingEnabled()` is true (see "Flags" below):

1. **Find a seed candidate.** `findNearestCachedAncestor(repoDir, targetCommit)` scans `.code-intel/snapshots/` cache entries (bounded by `DEFAULT_SNAPSHOT_CACHE_POLICY.maxCount`, default 20 — cheap, no query-scaling concern per design.md's existing "Query scaling" principle), filters to entries with `builtVia: 'full'` (see "Seed-chain depth"), and picks the one with the fewest commits between it and `targetCommit` via `git rev-list --count $(git merge-base A B)..A` + `...B` (a commit-count heuristic, not a byte-diff-size one — documented as a known limitation: a single commit touching thousands of files ranks "close" by this metric even though its actual delta is large; the eligibility/closure computation still bounds cost correctly in that case, it's only the *candidate selection* that's heuristic).
2. **Compute eligibility and delta.** If a candidate exists: `git diff --name-status <parent>..<target>` gives the changed-file set. `isEligibleForIncrementalPublication(changedFiles)` gates on it (all touched files must be fact-based-language). If eligible: load the parent's `semantic-index.json` (`loadSemanticIndexArtifact`), compute `SemanticDelta` via the existing `computeInvalidationClosure` + `computeSemanticDelta`.
3. **Seed the staging dir.** `seedFromParentSnapshot(parentArtifactsDir, stagingDir)` clones `graph.db`/`bm25.db`/`semantic-index.json` into the new staging dir (same clone semantics `seedIndexGeneration` uses today).
4. **Run the child with the delta wired through.** The child `analyze` invocation (`runAnalyzeChild`) gets one new optional env var, `CODE_INTEL_DEPENDENCY_AWARE_DELTA_PATH`, pointing at a temp file containing the serialized delta (see "Delta serialization"). `cli/app.ts`'s `analyze` action reads it, deserializes, and forwards it into the existing `planAtomicAnalysis(..., dependencyAwareDelta)` parameter — this is the actual first live wiring; everything downstream of that parameter (seeded-artifact detection, incremental re-resolution plan) already exists and is unchanged.
5. **Verify.** Same `verifySnapshotReadBack` as today — unchanged. Semantic-correctness assurance comes from the pre-merge convergence suite (see "Testing"), not a runtime double-check.
6. **Fall back on any failure.** No cached candidate, ineligible files, delta computation failure, parent artifacts missing (evicted mid-use — see "Concurrency"), or child failure all fall back to today's unseeded full-build path. This pre-step is purely additive; nothing about the existing full-build path changes.

### Delta serialization

`SemanticDelta.affectedArtifacts` is a `ReadonlySet<AffectedArtifact>` — `JSON.stringify` silently drops a `Set` (`{}`), so this needs an explicit serializer, matching the codebase's existing idiom for exactly this problem (`semantic-index-store.ts`'s `serializeSemanticSnapshot`/`parseSemanticSnapshot`, `serializeReverseDependencyIndex`/`parseReverseDependencyIndex`). New: `serializeSemanticDelta`/`parseSemanticDelta` in `incremental/semantic-delta.ts`, converting `affectedArtifacts` to/from a sorted array. Round-trip is covered by a dedicated unit test, not just exercised incidentally by the integration tests.

### Seed-chain depth

Only a snapshot whose own `CacheEntryMetadata.builtVia === 'full'` may be used as a seed parent. `CacheEntryMetadata` (`snapshots/types.ts`) gains a `builtVia: 'full' | 'incremental'` field, written by `writeCacheEntryMetadata` (`cache.ts`) based on whether the build that produced it went through the seeding path. An incrementally-built snapshot is a perfectly valid, fully-verified cache entry for serving diffs — it just can't itself be a seed source. This keeps the correctness argument single-hop: the convergence suite only ever needs to prove "full parent + incremental child == full rebuild," never a multi-hop chain, and bounds how far a subtly-wrong result (if the convergence proof ever had a gap) could compound before the next full rebuild resets it.

### Concurrency

The chosen parent could be evicted (LRU) between selection and use by a concurrent request. `seedFromParentSnapshot` checks each source artifact's existence immediately before cloning (mirroring `loadValidCacheEntry`'s existing defensive pattern) and returns a "seed unavailable" result rather than throwing if anything is missing; the caller falls back to a full build. Covered by a new test alongside the existing `cache-failure-modes.test.ts` suite.

### Flags

- `CODE_INTEL_SNAPSHOT_INCREMENTAL_SEEDING` (new, `snapshots/incremental-rollout-gate.ts`, default off) — the single switch for this feature, mirroring `incremental/rollout-gate.ts`'s "one auditable switch" pattern.
- Composes with (requires) the existing `isDependencyAwareIncrementalEnabled()` (`CODE_INTEL_INCREMENTAL_SEMANTIC_ENABLED`, default **on** today) — both must be true. This means the existing engine-wide kill-switch also disables snapshot seeding, since they share the same underlying engine; there is no way to keep snapshot seeding running while that kill-switch is off.
- Eligibility is still `isEligibleForIncrementalPublication` per-request, reused as-is (not a separate/stricter check) — an ineligible file (non-fact-based language) in the changed set forces a full build for that snapshot, identical to today's behavior on the eligible slice.

### The one touch outside `snapshots/` and `incremental/`

`cli/app.ts`'s `analyze` action reads `CODE_INTEL_DEPENDENCY_AWARE_DELTA_PATH` (only ever set by the snapshot builder's own child invocation) and forwards the deserialized delta into its existing `planAtomicAnalysis` call, exactly where it already reads `CODE_INTEL_ATOMIC_CHILD`/`CODE_INTEL_SNAPSHOT_BUILD` today — one new optional field threaded through the same mechanism, not a new branch of control flow. Acceptance criterion: the existing `analyze` action test suite passes completely unchanged, plus a new test asserts the action's behavior is bit-for-bit identical to today's when the env var is absent.

## Testing

- **Unit:** `findNearestCachedAncestor` (candidate selection, ties, empty cache, all-incremental cache i.e. no eligible `full` parent), `computeSeedDelta` eligibility outcomes, `seedFromParentSnapshot` cloning, `serializeSemanticDelta`/`parseSemanticDelta` round-trip.
- **Convergence integration tests (the correctness proof):** build a snapshot fully for commit A, incrementally seed commit B (a small change) from A's cache entry, and assert the resulting graph-diff output (`diffEntitiesWithContinuity`/`diffRelationships` against a *third*, independently fully-built snapshot for B) is identical. Explicit fixtures for TypeScript and Python (matching what's already convergence-proven for the underlying engine); JavaScript/Rust/HTML/Go are exercised too but inherit the same "eligible but not independently proven beyond this suite" caveat `rollout-gate.ts` already documents for those languages.
- **Safety:** seeding never mutates the parent snapshot's own cache entry (read-only source, cloned into a fresh staging dir) — extends the existing `graph-diff-safety.test.ts` assertions to the seeded path.
- **Failure modes:** parent evicted mid-use, corrupt/missing parent `semantic-index.json`, ineligible file in the delta, delta computation throwing — every case falls back to a full build rather than failing the request. Alongside the existing `cache-failure-modes.test.ts` suite.
- **CLI action:** existing `analyze` action tests pass unchanged; new test proves behavior is identical when `CODE_INTEL_DEPENDENCY_AWARE_DELTA_PATH` is absent.

## Open questions for the OpenSpec proposal stage

- Exact perf target/claim (this design deliberately doesn't promise a number — "ideally" a smaller-than-full-rebuild cost — since it depends on real repo change patterns not yet measured).
- Whether to add a metric/log line recording seeded-vs-full outcome per build, to build production confidence data ahead of any future decision to wire the real Generation V2 pipeline (explicitly out of scope for *doing* that wiring here, but cheap observability now would inform that future decision).
