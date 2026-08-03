# Tasks

## 1. Analysis planning

- [ ] Create `code-intel/core/src/pipeline/analysis-plan.ts` with exported types `GraphWorkMode`, `Bm25WorkMode`, `VectorWorkMode`, `AnalysisPublishReason`, `AnalysisPlan`, and `ResolveAnalysisPlanInput`.
- [ ] Add pure function `resolveAnalysisPlan(input)` that returns either a no-op plan or a publication plan without performing filesystem writes.
- [ ] Ensure `resolveAnalysisPlan()` preserves the v1.0.9 vector contract: healthy known changed/deleted paths use incremental vector work even when graph/BM25 use correctness-first full rebuilds.
- [ ] Ensure force, initial analysis, missing vector DB, stale vector state, incompatible embedding fingerprint, schema/parser migration, and unknown change scope choose safe full work where required.
- [ ] Ensure no-op is returned only when source, schema, parser, embedding, metadata, and required-artifact state are all stable.
- [ ] Normalize, deduplicate, and deterministically sort `changedPaths` and `deletedPaths` in the returned plan.
- [ ] Derive `seedArtifacts` strictly from work modes: no graph/BM25 seed for full rebuild, vector seed only for incremental vector work, and complete preserved artifact seed for metadata-only publication.
- [ ] Create `code-intel/core/tests/unit/pipeline/analysis-plan.test.ts` with an exhaustive decision table covering every row in the design planning matrix.
- [ ] Assert in `analysis-plan.test.ts` that unknown/inconsistent input never produces unsafe incremental work.
- [ ] Assert in `analysis-plan.test.ts` that true zero-change produces `mode: 'noop'`, empty seed list, and empty required-artifact write list.

## 2. Pinned index snapshots

- [ ] Create `code-intel/core/src/storage/index-snapshot.ts` with exported `IndexSnapshot`, `resolveIndexSnapshot(repoDir)`, and `requireIndexSnapshot(repoDir)`.
- [ ] Make `resolveIndexSnapshot()` read `.code-intel/current.json` exactly once per call and derive all artifact paths from the same generation directory.
- [ ] Normalize generation-v1 and generation-v2 manifests into one in-memory snapshot representation.
- [ ] Add explicit legacy-flat snapshot handling that never mixes flat and generation-backed artifact paths in one snapshot.
- [ ] Validate generation IDs and reject path separators, `..`, null bytes, absolute paths, and paths escaping `.code-intel/generations`.
- [ ] Reject unsafe symlink/path escape conditions before returning a snapshot.
- [ ] Create `code-intel/core/tests/unit/storage/index-snapshot.test.ts`.
- [ ] Test v1 manifest normalization, v2 manifest normalization, missing manifest, missing generation directory, malformed JSON, invalid generation ID, path traversal, symlink escape, and legacy compatibility.
- [ ] Add a test hook or injected manifest reader to assert a snapshot resolution performs one manifest read even if `current.json` changes immediately afterward.

## 3. Generation manifest compatibility

- [ ] Update `code-intel/core/src/storage/index-generation.ts` to define backward-compatible `IndexGenerationManifestV1` and `IndexGenerationManifestV2` types.
- [ ] Keep top-level `generationId`, `publishedAt`, and `artifacts: IndexArtifactName[]` compatible with v1.0.9 readers.
- [ ] Add optional v2 fields `version`, `baseGenerationId`, `schemaVersion`, `parser`, and `artifactDetails`.
- [ ] Add manifest normalization function `normalizeIndexGenerationManifest(value)` and use it in published snapshot loading.
- [ ] Ensure a generation-v1 manifest is not rewritten merely because a zero-change command runs under v1.0.10.
- [ ] Ensure the next real publication writes a version-2 manifest while preserving v1-compatible top-level fields.
- [ ] Extend `code-intel/core/tests/unit/storage/index-generation.test.ts` for v1 read compatibility, v2 publication, and v1.0.9-compatible fields.

## 4. Selective artifact cloning

- [ ] Replace unconditional `seedIndexGeneration(repoDir, generation)` in `code-intel/core/src/cli/atomic-analyze.ts` with selected seeding based on `AnalysisPlan.seedArtifacts`.
- [ ] Update `code-intel/core/src/storage/index-generation.ts` with exported `CloneArtifactResult` and `cloneArtifact(source, target)`.
- [ ] Implement clone order: `COPYFILE_FICLONE_FORCE`, then `COPYFILE_FICLONE`, then normal `copyFileSync` fallback.
- [ ] Report clone mode, logical bytes, and physical bytes copied for each artifact.
- [ ] Add `seedIndexGeneration({ snapshot, generation, artifacts })` and reject duplicate/unsupported artifact names.
- [ ] Ensure graph/BM25 sidecars are not copied when graph/BM25 are scheduled for full rebuild.
- [ ] Ensure vector sidecars are copied only when the vector storage contract requires them after a clean close/checkpoint.
- [ ] Ensure `meta.json` is written from in-memory metadata rather than copied as a default seed artifact.
- [ ] Add unit tests for reflink success, reflink-force failure with reflink fallback, both reflink modes failing with normal copy fallback, source missing, target failure, and selected-artifact-only behavior.
- [ ] Add assertions that a full forced rebuild seeds zero database artifacts.
- [ ] Add assertions that one changed source file with a healthy vector index seeds only `vector.db`.

## 5. Repository analysis lock

- [ ] Create `code-intel/core/src/storage/analyze-lock.ts` with exported `AnalyzeLockOwner`, `AnalyzeLock`, `acquireAnalyzeLock()`, `readAnalyzeLock()`, and `removeStaleAnalyzeLock()`.
- [ ] Store the lock at `.code-intel/analyze.lock` and acquire it using atomic exclusive creation (`wx`).
- [ ] Record lock `version`, PID, hostname, start time, base generation ID, and staging generation ID.
- [ ] Make `AnalyzeLock.update()` replace lock content atomically while preserving owner identity.
- [ ] Make `AnalyzeLock.release()` remove the file only when it still belongs to the same owner token.
- [ ] Implement same-host process liveness checking with `process.kill(pid, 0)` and platform-aware error handling.
- [ ] Preserve cross-host locks conservatively until stale policy and staging activity permit recovery.
- [ ] Return a clear active-lock error containing PID, hostname, and start time.
- [ ] Create `code-intel/core/tests/unit/storage/analyze-lock.test.ts`.
- [ ] Test exclusive acquisition, active owner rejection, same-host dead PID recovery, cross-host conservative behavior, owner-safe release, malformed lock handling, and forced stale removal.

## 6. Staging ownership and safe cleanup

- [ ] Add `StagingManifest` to `code-intel/core/src/storage/index-generation.ts` or create `code-intel/core/src/storage/staging-cleanup.ts` if separation improves ownership.
- [ ] Write `<stagingDir>/staging.json` at generation creation with PID, hostname, base generation, creation time, and last activity time.
- [ ] Add `touchStagingActivity(generation)` and update it before child start and after child exit; add phase-boundary updates where practical.
- [ ] Split current cleanup behavior into `cleanupPublishedGenerations()` and `cleanupStaleStaging()`.
- [ ] Remove blanket deletion of all directories whose names begin with `.staging-`.
- [ ] Preserve staging referenced by the active analyze lock.
- [ ] Preserve staging younger than the configured stale timeout.
- [ ] Remove only abandoned staging that is older than the timeout and passes path-containment checks.
- [ ] Refuse to recursively delete through symlinked staging paths.
- [ ] Return a structured cleanup result containing removed, preserved, skipped-active, and invalid entries.
- [ ] Create `code-intel/core/tests/unit/storage/staging-cleanup.test.ts`.
- [ ] Test active staging preservation, recent staging preservation, stale abandoned removal, cross-host behavior, symlink/path escape rejection, and protection of successfully published generations.

## 7. Refactor atomic analyze orchestration

- [ ] Refactor `code-intel/core/src/cli/atomic-analyze.ts` so `runAtomicAnalyze()` acquires the repository lock before creating staging or writing artifacts.
- [ ] Add exported/internal `resolveAtomicAnalyzePreflight()` to resolve workspace, pinned snapshot, prior metadata, change state, migration state, embedding state, and `AnalysisPlan`.
- [ ] Add `runPlannedAnalyze()` to execute only publication plans.
- [ ] Write a versioned `<stagingDir>/analysis-plan.json` for the atomic child.
- [ ] Pass the plan path to the child through `CODE_INTEL_ANALYSIS_PLAN_PATH` and retain `CODE_INTEL_INDEX_STAGING_DIR` for write routing.
- [ ] Validate the plan version and generation identity in the child before analysis work begins.
- [ ] Return immediately for `mode: 'noop'` before staging creation, artifact cloning, child spawn, repository registry update, or metadata update.
- [ ] Ensure the no-op path preserves `current.json` bytes, mtime, generation ID, artifact mtimes, generation count, and immutable `indexedAt`.
- [ ] Ensure all parent error paths abort only the current process's staging and release only the current process's lock.
- [ ] Ensure child non-zero status is propagated when available.
- [ ] Ensure validation/publication exceptions return non-zero and leave the previous generation reachable.
- [ ] Add verbose analysis-plan output and clone diagnostics.
- [ ] Extend profile output with base/published generation IDs, plan mode/reason, seed artifacts, clone modes, logical bytes, and physical copied bytes.

## 8. Align child analyze implementation with the resolved plan

- [ ] Update `code-intel/core/src/cli/app.ts` to load and validate the parent-provided analysis plan when running as the atomic child.
- [ ] Remove duplicate child-side decisions that can conflict with the parent plan, or assert equivalence where existing functions remain responsible for lower-level execution.
- [ ] Preserve `resolveEmbeddingUpdatePlan()` as the vector work authority or explicitly compose it into `resolveAnalysisPlan()` without duplicating vector rules.
- [ ] Ensure full graph/BM25 work creates new staging artifacts without requiring seeded copies.
- [ ] Ensure incremental vector work opens the staged vector clone, removes deleted/changed paths, embeds changed paths only, and persists a healthy vector state.
- [ ] Ensure full vector work builds a new staged vector DB without reading the prior vector artifact.
- [ ] Ensure disabled vector mode does not accidentally carry an old `vector.db` into a newly published generation unless compatibility policy explicitly requires it.
- [ ] Ensure staged metadata records the exact generation ID, work modes, embedding status, parser provenance, schema/index version, changed/deleted paths, and final artifact readiness.

## 9. Publication validation

- [ ] Add `validateIndexGeneration({ generation, metadata, requiredArtifacts })` in `code-intel/core/src/storage/index-generation.ts`.
- [ ] Validate required file existence and non-zero size.
- [ ] Validate every artifact is contained under the expected staging directory.
- [ ] Validate `metadata.generationId === generation.generationId`.
- [ ] Reject metadata claiming embeddings `ready` when `vector.db` is missing or empty.
- [ ] Validate graph/BM25/vector database integrity using existing safe checks where available.
- [ ] Ensure final staging rename occurs before `current.json` replacement.
- [ ] Ensure manifest-write failure leaves the old manifest unchanged and an unreachable final generation eligible for later cleanup.
- [ ] Extend publication unit tests for each validation failure and reopen the previously published artifacts after failure.

## 10. Migrate metadata and path helpers to pinned reads

- [ ] Update `code-intel/core/src/storage/metadata.ts` with `loadMetadataFromSnapshot(snapshot)` and clearly separate published-read paths from staging-write paths.
- [ ] Update `getDbPath`, `getVectorDbPath`, and metadata helpers so published reads may accept `IndexSnapshot` without re-reading `current.json`.
- [ ] Update `code-intel/core/src/search/bm25-index.ts` with a snapshot-aware path helper or constructor path injection.
- [ ] Update `code-intel/core/src/search/vector-index.ts` to accept an explicit vector DB path from the pinned snapshot.
- [ ] Update `code-intel/core/src/storage/index-trust.ts` so `verifyIndexTrust()` resolves one snapshot and verifies metadata plus all artifacts from that same snapshot.
- [ ] Add generation ID and manifest version to trust/status diagnostics without removing existing response fields.
- [ ] Add tests that publish generation B between metadata and artifact verification and assert the operation remains entirely on generation A.

## 11. Migrate one-shot CLI readers

- [ ] Identify every CLI command that reads more than one index artifact in `code-intel/core/src/cli/app.ts` and related command modules.
- [ ] Update search, inspect, impact, context, change-context, overview, status, and repository/group commands to resolve one snapshot per operation where applicable.
- [ ] Pass explicit graph/BM25/vector/metadata paths instead of independently resolving published paths.
- [ ] Preserve existing CLI output and JSON contracts, adding generation diagnostics only as optional fields or verbose output.
- [ ] Add regression tests for each migrated command against generation-v1 and generation-v2 manifests.

## 12. Cohesive HTTP/MCP runtime reload

- [ ] Create or extend a shared repository runtime module with `LoadedRepositoryIndex` and request-scoped `RepositoryIndexLease`.
- [ ] Store snapshot, metadata, graph, BM25, and optional vector index as one cohesive runtime object.
- [ ] Update the HTTP server initialization/reload path in `code-intel/core/src/http/app.ts` and related repository loading modules to construct a complete replacement before swapping references.
- [ ] Update the MCP server initialization/reload path in `code-intel/core/src/mcp-server/server.ts` and related graph/search loaders to use the same cohesive runtime contract.
- [ ] Ensure an in-flight request that acquired generation A completes against A after generation B is published.
- [ ] Ensure new requests use B only after B graph/BM25/vector/metadata all open and validate.
- [ ] Ensure B-open failure leaves A serving and reports reload failure without partial component replacement.
- [ ] Ensure previous generation resources close only after active leases release.
- [ ] Add HTTP and MCP tests for publication during an in-flight request and failed replacement initialization.

## 13. Repository groups

- [ ] Update `code-intel/core/src/multi-repo/group-query.ts` and group repository loaders so each repository member pins its own snapshot once per group request.
- [ ] Ensure one repository publishing a new generation during group search cannot mix artifacts within that repository's result.
- [ ] Preserve per-repository attribution, deterministic merge order, search mode, vector status, and fallback semantics.
- [ ] Add group-search race coverage with one member publishing during execution.

## 14. Maintenance commands

- [ ] Update `code-intel/core/src/cli/standalone-commands.ts` or the appropriate command module to add `code-intel index cleanup`.
- [ ] Support `--dry-run`, `--keep <n>`, and `--remove-legacy`.
- [ ] Require a valid trusted active generation before removing legacy flat artifacts.
- [ ] Print every path selected for removal in dry-run mode and remove nothing.
- [ ] Add `code-intel index unlock` and `--force` using `analyze-lock.ts` stale/forced removal rules.
- [ ] Ensure maintenance commands never delete the current generation or active staging.
- [ ] Add CLI help, JSON/error behavior where applicable, and unit/integration tests.

## 15. Configuration

- [ ] Add backward-compatible configuration fields for `index.keepGenerations` (default `2`) and `index.staleStagingHours` (default `24`) in the existing configuration schema/module.
- [ ] Validate `keepGenerations >= 1` and a bounded positive stale-staging duration.
- [ ] Expose settings through existing config read/update surfaces only if those surfaces already support index settings; otherwise document CLI/config-file use without expanding portal scope.
- [ ] Add config serialization, masking, validation, and compatibility tests as applicable.

## 16. Integration and failure-path tests

- [ ] Create `code-intel/core/tests/integration/cli/analyze-zero-change-generation.test.ts`.
- [ ] Assert zero-change leaves generation ID, `current.json` bytes/mtime, artifact mtimes, generation count, and copied-byte count unchanged.
- [ ] Create `code-intel/core/tests/integration/cli/analyze-selective-seeding.test.ts`.
- [ ] Assert one changed file with healthy vectors rebuilds graph/BM25, clones only vector, and embeds only the changed path.
- [ ] Assert one deleted file removes only the deleted vector path while graph/BM25 reflect the complete current source tree.
- [ ] Assert `--force --embeddings` seeds no old database artifact and performs a complete vector rebuild.
- [ ] Create `code-intel/core/tests/integration/cli/analyze-concurrency.test.ts`.
- [ ] Assert process B exits non-zero while A owns the lock, creates no staging, and cannot alter A's lock/staging/current manifest.
- [ ] Create `code-intel/core/tests/integration/storage/pinned-generation-read.test.ts`.
- [ ] Assert a paused operation remains wholly on generation A after B publishes and a later operation resolves B.
- [ ] Create `code-intel/core/tests/integration/storage/generation-publication-rollback.test.ts`.
- [ ] Inject graph, BM25, vector, metadata, validation, rename, and manifest-write failures; reopen graph/BM25/vector/metadata from the old generation and prove they remain usable.
- [ ] Add migration tests from legacy flat index and generation-v1 manifest.
- [ ] Add cleanup tests proving current/retained/active staging protection and explicit legacy removal.

## 17. Performance verification

- [ ] Add deterministic instrumentation or test hooks to measure logically cloned and physically copied bytes.
- [ ] Add a release test proving zero-change copies `0` bytes and creates `0` generations.
- [ ] Add a release test proving a full forced rebuild seeds `0` prior DB artifacts.
- [ ] Add a release test proving a one-file healthy-vector update never copies graph or BM25.
- [ ] Add reflink-capable and forced-copy-fallback test variants without making CI correctness depend on filesystem reflink support.
- [ ] Record before/after benchmark evidence for zero-change and one-file vector update on a representative fixture.

## 18. Security verification

- [ ] Add tests for malicious generation IDs, lock JSON, staging JSON, plan JSON, path traversal, absolute paths, null bytes, and symlink escape.
- [ ] Confirm cleanup never follows a symlink outside `.code-intel/generations`.
- [ ] Confirm lock, staging, plan, and manifest files contain no credentials or source content.
- [ ] Run package audit and confirm no new runtime dependency was introduced.

## 19. Documentation and release metadata

- [ ] Update `README.md` with Generation V2 behavior, true no-op semantics, lock errors, cleanup/unlock commands, and migration notes.
- [ ] Update `code-intel/core/README.md` with storage layout, manifest compatibility, and troubleshooting.
- [ ] Add `docs/releases/v1.0.10.md` with behavior matrix, compatibility, migration, rollback, and known limitations.
- [ ] Update `CHANGELOG.md` with v1.0.10 changes.
- [ ] Update package versions in `code-intel/core/package.json`, root/workspace package metadata as applicable, and `package-lock.json` to `1.0.10` only after implementation is complete.
- [ ] Update OpenAPI/MCP schemas only if optional generation diagnostics become public fields.
- [ ] Update web/shared types only if public API fields change.

## 20. Release readiness

- [ ] Update `.github/workflows/release-readiness.yml` and supporting scripts to gate zero-change no-publication, selective seeding, pinned snapshot race, concurrency lock, rollback, migration, and cleanup behavior.
- [ ] Run formatting, lint, TypeScript build, unit tests, integration tests, HTTP/MCP tests, package validation, packed CLI installation, CLI version, and high/critical audit gate.
- [ ] Run `code-intel analyze` on a representative repository twice and capture evidence that the second zero-change run preserves the generation ID.
- [ ] Run one changed-file embeddings analysis and capture evidence that only changed/deleted vector paths are updated and graph/BM25 are rebuilt correctly.
- [ ] Verify generation-v1 and legacy-flat repositories remain readable/migratable.
- [ ] Verify rollback to the prior published generation using the documented procedure.
- [ ] Mark tasks complete only after the assertion/evidence described by each task exists in tests or release documentation.