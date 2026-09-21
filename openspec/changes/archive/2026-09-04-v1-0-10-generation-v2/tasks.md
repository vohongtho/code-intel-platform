# Tasks

## Implementation note

The proposal described the full Generation V2 target architecture. The accepted v1.0.10 implementation keeps the same external guarantees while reusing existing storage, search, HTTP, MCP, and CLI modules where that reduced migration risk. The completed checklist below records the behavior and evidence delivered by the release.

## 1. Analysis planning and true no-op

- [x] Add `code-intel/core/src/pipeline/analysis-plan.ts` with deterministic no-op and publication plans.
- [x] Resolve graph, BM25, vector, metadata, changed paths, and seed artifacts before creating staging.
- [x] Preserve the v1.0.9 contract: known source changes use correctness-first full graph/BM25 work and incremental vector work when vector state is healthy.
- [x] Choose safe full work for initial, forced, missing-artifact, stale-vector, legacy, or unknown states.
- [x] Return a true no-op only when source and required index state are stable.
- [x] Ignore unrelated Git changes whose paths are neither previously indexed nor supported source files.
- [x] Detect tracked, staged, unstaged, untracked, mtime-changed, and deleted source paths.
- [x] Add regression coverage proving untracked `status.json` does not publish a generation while untracked `src/*.ts` does.
- [x] Preserve `current.json`, generation ID, generation count, and staging state on no-op.

## 2. Repository analysis serialization

- [x] Add `code-intel/core/src/storage/analyze-lock.ts`.
- [x] Acquire `.code-intel/analyze.lock` using atomic exclusive creation.
- [x] Record owner token, PID, hostname, start time, base generation, and staging generation.
- [x] Reject a second concurrent analysis before staging creation.
- [x] Preserve a live same-host owner regardless of lock age.
- [x] Recover a dead same-host owner safely.
- [x] Fail closed for unverifiable cross-host ownership.
- [x] Release only a lock that still belongs to the current owner token.
- [x] Add concurrency, live-lock, dead-owner, and release tests.

## 3. Immutable generation snapshots

- [x] Add `code-intel/core/src/storage/index-snapshot.ts`.
- [x] Resolve `current.json` once per snapshot and derive graph, BM25, vector, and metadata paths from one generation.
- [x] Normalize generation-v1 and generation-v2 manifests.
- [x] Support a cohesive legacy-flat snapshot without mixing flat and generation paths.
- [x] Reject malformed generation IDs, path traversal, absolute paths, null bytes, and symlink escapes.
- [x] Add `requireIndexSnapshot`, explicit artifact-path access, and current-generation checks.
- [x] Add race coverage proving a pinned operation remains on generation A after generation B publishes.

## 4. Snapshot-aware readers

- [x] Make metadata helpers accept an `IndexSnapshot` for published reads.
- [x] Make graph and vector path helpers snapshot-aware.
- [x] Make BM25 loading accept an explicit pinned snapshot/path.
- [x] Refactor index trust verification to inspect one snapshot.
- [x] Pin scoped search graph, BM25, vector, and metadata to one generation.
- [x] Pin multi-repository group members independently for each group operation.
- [x] Pin MCP repository cache, graph reload, and search context to one generation.
- [x] Pin HTTP startup and search operations to one cohesive snapshot.
- [x] Preserve existing CLI, HTTP, MCP, and search response contracts.
- [x] Add manifest, trust, scoped-search, MCP reload, and MCP search regression coverage.

## 5. Generation manifest V2 and compatibility

- [x] Add backward-compatible generation-v1 and generation-v2 manifest types.
- [x] Preserve top-level `generationId`, `publishedAt`, and artifact names for v1 readers.
- [x] Add v2 version, base generation, schema/parser, and artifact detail fields.
- [x] Add strict manifest normalization.
- [x] Keep generation-v1 manifests readable without rewriting them on no-op.
- [x] Publish a version-2 manifest on the next real generation.
- [x] Keep legacy flat indexes readable and migratable.
- [x] Add compatibility and unsafe-identifier tests.

## 6. Selective staging and copy-on-write cloning

- [x] Replace unconditional full seeding with `AnalysisPlan.seedArtifacts`.
- [x] Avoid graph/BM25 copies when those artifacts will be rebuilt.
- [x] Seed `vector.db` only when incremental vector mutation requires prior state.
- [x] Seed metadata where the atomic child needs previous commit and embedding state.
- [x] Implement clone order: forced reflink, normal reflink, then physical-copy fallback.
- [x] Clone required SQLite sidecars with their selected artifact.
- [x] Print clone modes in verbose analysis output.
- [x] Add selected-artifact, metadata, reflink/copy, and forced-rebuild tests.

## 7. Staging ownership and cleanup

- [x] Write `staging.json` with PID, hostname, base generation, creation time, and last activity time.
- [x] Touch staging activity around significant parent operations.
- [x] Remove only the current process's staging on abort.
- [x] Replace blanket staging deletion with stale-age and active-generation checks.
- [x] Preserve recent staging and staging referenced by active analysis.
- [x] Remove abandoned stale staging only.
- [x] Keep published generations outside staging cleanup rules.
- [x] Add active, recent, stale, and published-generation protection tests.

## 8. Atomic publication and rollback

- [x] Validate required graph, BM25, metadata, and vector artifacts before publication.
- [x] Write generation identity into metadata.
- [x] Rename staging to the final generation before swapping `current.json`.
- [x] Atomically replace `current.json` only after validation succeeds.
- [x] Keep the previous generation reachable after child, validation, or publication failure.
- [x] Retain current plus previous published generation by default.
- [x] Preserve generation-v1 and legacy rollback compatibility.
- [x] Add publication-success, validation-failure, and previous-generation tests.

## 9. Atomic analyze orchestration

- [x] Acquire the repository lock before staging or artifact mutation.
- [x] Resolve the pinned snapshot, prior metadata, source state, and complete plan in the parent.
- [x] Return from no-op before generation creation or child spawn.
- [x] Create staging only for publication plans.
- [x] Pass staging and serialized plan context to the atomic child.
- [x] Preserve remembered embedding behavior.
- [x] Abort staging and propagate non-zero child status on failure.
- [x] Publish only after metadata and required artifacts validate.
- [x] Release the repository lock in all parent exit paths.
- [x] Add verbose plan, reason, work mode, seed list, and clone diagnostics.

## 10. Maintenance and retention

- [x] Add `code-intel index cleanup [path]`.
- [x] Add cleanup options `--dry-run`, `--keep`, `--stale-hours`, and `--remove-legacy`.
- [x] Never remove the active generation.
- [x] Require a valid trusted generation before explicit legacy-flat removal.
- [x] Print planned removals without modifying files in dry-run mode.
- [x] Add `code-intel index unlock [path]` and forced recovery behavior.
- [x] Add `index.keepGenerations` with default `2`.
- [x] Add `index.staleStagingHours` with default `24`.
- [x] Validate positive retention and stale-age configuration.
- [x] Add maintenance, config, cleanup, and unlock tests.

## 11. Release and package metadata

- [x] Set the core package version to `1.0.10`.
- [x] Keep `package-lock.json` workspace version aligned without unrelated lockfile churn.
- [x] Update `CHANGELOG.md`.
- [x] Add `docs/releases/v1.0.10.md`.
- [x] Update Release Readiness for version, packaging, no-op, setup hygiene, dirty working tree, graph equivalence, vector regression, and audit validation.

## 12. Required validation evidence

- [x] Quality workflow passes.
- [x] Full Test workflow passes.
- [x] Code Intel PR Impact workflow passes.
- [x] Export Source Snapshot workflow passes.
- [x] Release Readiness workflow passes.
- [x] Release metadata and lockfile version checks pass.
- [x] Core build and packed npm distribution validation pass.
- [x] CLI reports version `1.0.10`.
- [x] True no-op keeps `current.json` byte-identical and does not create staging.
- [x] Cursor-only setup dry-run excludes unselected integrations and creates no project instruction files.
- [x] Dirty tracked and untracked source files are indexed.
- [x] Changed-source graph output matches a subsequent forced full rebuild.
- [x] Incremental embedding regression tests pass.
- [x] High/critical npm audit gate passes.

## 13. Completion criteria

- [x] Generation-based publication remains crash-safe and rollback-capable.
- [x] Healthy zero-change analysis performs no publication.
- [x] Staging copies only artifacts needed for preserve/incremental work.
- [x] Multi-artifact readers use one pinned generation snapshot.
- [x] Concurrent analysis cannot interfere with active staging or publication.
- [x] Cleanup cannot delete the active generation or active staging.
- [x] Generation-v1 and legacy-flat indexes remain compatible.
- [x] The final release candidate passes all required workflows on the same commit.
