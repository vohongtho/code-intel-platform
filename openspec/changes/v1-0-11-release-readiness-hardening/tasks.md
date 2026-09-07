# Tasks: v1.0.11 Release Readiness and Hardening

## 1. Release baseline and scope freeze

- [ ] 1.1 Record the current `release/1.0.11` head SHA and verify `code-intel/core/package.json` reports `1.0.11` and `package-lock.json` carries the matching workspace version.
- [ ] 1.2 Freeze major feature development for `1.0.11`. New non-blocking feature requests discovered during this change MUST be moved to `1.0.12`/`1.1.x` rather than added to the release candidate.
- [ ] 1.3 Inventory every archived/open `v1-0-11-*` OpenSpec change and map each one to source modules, tests and user-facing documentation. A completed/archived requirement MUST have implementation evidence or an explicit scoped limitation.
- [ ] 1.4 Produce one release-readiness checklist artifact or CI summary that identifies the exact candidate SHA. Any later commit MUST invalidate the previous release-candidate evidence and require the complete release gate to rerun.

## 2. Clean product build and dependency ordering

- [ ] 2.1 Inspect root `package.json`, `code-intel/core/package.json`, `code-intel/web/package.json`, Docker build files, `.github/workflows/release-validate.yml`, `.github/workflows/publish.yml`, and `scripts/distribution/*` to document the actual build dependency graph.
- [ ] 2.2 Fix the current implicit dependency where Core packaging copies Web assets but `code-intel/core`'s build command does not itself build Web. Define one authoritative product-build path with explicit `shared -> web -> core` ordering, reusing workspace scripts rather than duplicating shell steps wherever practical.
- [ ] 2.3 Update `.github/workflows/release-validate.yml` so its clean release build does NOT rely on `npm test --workspace=code-intel/core` having generated `code-intel/web/dist` first. Build-order correctness MUST be proven independently from the unit-test step.
- [ ] 2.4 Add a clean-build test/script that removes `code-intel/web/dist`, `code-intel/core/dist`, `code-intel/core/dist-tests`, and relevant release output directories before invoking the authoritative product build.
- [ ] 2.5 Assert the clean product build recreates every required Web/Core runtime asset without an earlier test/build side effect.
- [ ] 2.6 Update Docker builder ordering to consume the same authoritative product-build dependency order or prove equivalent ordering explicitly. The Docker build MUST succeed from a checkout with no host `dist` directories.
- [ ] 2.7 Add regression coverage that intentionally starts with missing Web output and proves the supported product build succeeds while an unsupported Core-only packaging path fails with an actionable error instead of producing an incomplete package.

## 3. Consolidate release validation workflows

- [ ] 3.1 Inspect `.github/workflows/release-readiness.yml` and `.github/workflows/release-validate.yml` together. `release-readiness.yml` currently contains stale `1.0.10` version assertions; update, retire, or clearly separate it so an active `1.0.11` release gate cannot disagree with `release-validate.yml`.
- [ ] 3.2 Add `workflow_dispatch` to the authoritative pre-release workflow so the exact release-candidate SHA can be revalidated before tagging.
- [ ] 3.3 Ensure the authoritative pre-release workflow runs on `release/**` and records `${{ github.sha }}` in its job summary/evidence artifact.
- [ ] 3.4 Add explicit release metadata validation: `code-intel/core/package.json`, lockfile workspace version, CLI `--version`, runtime manifest version and package tarball version MUST all equal `1.0.11` for this release branch.
- [ ] 3.5 Add OpenSpec validation to pre-release CI. The new `v1-0-11-release-readiness-hardening` change MUST itself validate before release.
- [ ] 3.6 Ensure workflow/agent registry validation runs from the same packaged build that will be released, not from a stale `dist` directory.
- [ ] 3.7 Ensure pre-release CI includes maintained integration/e2e suites in addition to unit tests. Do not treat a unit-only pass as complete release validation.
- [ ] 3.8 Upload a release-evidence artifact or job summary containing commit SHA, package version, Node version, runner OS/arch, npm tarball SHA-256, runtime artifact hashes and Docker image/archive digest where generated.

## 4. npm package verification

- [ ] 4.1 Replace/extend `validate:dist` so release validation inspects the generated `.tgz` before deletion instead of merely proving `npm pack` exits successfully.
- [ ] 4.2 Verify the tarball contains required runtime files: CLI entrypoints, package entrypoint, Web assets, grammars, workflow assets, runtime metadata, README and LICENSE.
- [ ] 4.3 Verify the tarball does NOT contain `.code-intel`, repository-local secrets/config, test-only temporary artifacts, local credentials, or unrelated workspace build output.
- [ ] 4.4 Install the generated tarball into an isolated temporary project with no workspace symlink and run `code-intel --version`, `code-intel doctor`, and representative CLI startup smoke tests.
- [ ] 4.5 Analyze a small fixture using the installed tarball and verify a trusted Generation is published and can be reopened by a second packaged CLI process.
- [ ] 4.6 Start the packaged MCP/server path from the isolated install and verify it does not depend on repository workspace paths.

## 5. Self-contained runtime bundle verification

- [ ] 5.1 Build `linux-x64`, `linux-arm64`, `darwin-x64`, and `darwin-arm64` runtime bundles from a clean checkout using `scripts/distribution/build-runtime-bundle.mjs`.
- [ ] 5.2 Validate each archive contains the expected launcher, bundled Node/runtime, Core dist, Web assets, grammars, workflow assets and runtime manifest.
- [ ] 5.3 Verify every generated `.sha256` matches its archive bytes.
- [ ] 5.4 Parse every `.sbom.cdx.json` and verify product/version/target metadata corresponds to the associated archive.
- [ ] 5.5 Parse every `.provenance.json` and verify target/version/artifact identity corresponds to the associated archive.
- [ ] 5.6 Execute the host-compatible runtime bundle in CI and smoke-test `--version`, `doctor`, `analyze` and server/MCP startup.
- [ ] 5.7 Keep structural validation for non-host targets and ensure missing cross-platform native dependencies fail the release gate rather than silently producing partial archives.

## 6. Docker release path

- [ ] 6.1 Build the production Docker target from a clean checkout with no host-generated `dist` directories.
- [ ] 6.2 Load/run the built image archive in pre-release CI and verify `code-intel --version` reports `1.0.11`.
- [ ] 6.3 Smoke-test the container startup path and verify required Web/grammar/native runtime assets are present inside the image.
- [ ] 6.4 Keep Trivy SARIF output for HIGH/CRITICAL findings and gate release on CRITICAL according to current policy.
- [ ] 6.5 Verify the tag-triggered publish workflow still produces multi-arch images, immutable digest/provenance and cosign signature after build-order changes.

## 7. Semantic convergence: cold, cached, no-op and forced

- [ ] 7.1 Reuse existing Generation/snapshot normalization helpers where possible to create one canonical semantic-state comparison for release tests. Do not create a count-only comparison.
- [ ] 7.2 Canonical comparison MUST include stable symbol IDs, relationship IDs/call-site identities, relationship certainty/strategy/evidence references, and semantic properties required to distinguish exact/ambiguous results.
- [ ] 7.3 Build a fixture from a clean state, persist/reopen it, run an unchanged/no-op analysis, and assert the semantic state remains identical.
- [ ] 7.4 Run `analyze --force` on the same source revision and assert normalized semantic state equals the original cold build even though the Generation ID may differ.
- [ ] 7.5 Include API-contract semantic state in the convergence comparison for a fixture containing supported producer and consumer frameworks.
- [ ] 7.6 Include evidence-store/read-back equivalence so persistence cannot silently drop evidence and strengthen/downgrade relationship certainty.
- [ ] 7.7 Include program-analysis summary/artifact identity equivalence where the public/internal pipeline generates those artifacts deterministically.

## 8. Change-path/full-rebuild convergence

- [ ] 8.1 Document the actual production path for non-empty changes. If the current correctness-first behavior performs a clean full rebuild, tests MUST call it that and MUST NOT claim a surgical incremental executor was exercised.
- [ ] 8.2 For every production path that does execute dependency-aware/incremental semantic work, compare its final normalized state to an independently forced full analysis.
- [ ] 8.3 Add body-edit convergence fixture.
- [ ] 8.4 Add symbol add/delete convergence fixtures.
- [ ] 8.5 Add rename/move convergence fixtures where canonical continuity can be proven; ambiguous rename candidates MUST remain add/remove candidates rather than being force-merged.
- [ ] 8.6 Add file move/add/delete convergence fixtures.
- [ ] 8.7 Add import/export/barrel-change convergence fixtures where an unchanged dependent file must be re-resolved or safely rebuilt.
- [ ] 8.8 Add same-simple-name/overload fixture to prove selector ambiguity does not collapse to one target.
- [ ] 8.9 Add inheritance/interface change fixture.
- [ ] 8.10 Add route add/remove/method/path change fixtures.
- [ ] 8.11 Add request/response shape and supported frontend consumer change fixtures.
- [ ] 8.12 Assert final persisted/reopened output matches independent forced full output for all enabled fixtures.

## 9. Semantic cache and producer fingerprint invalidation

- [ ] 9.1 Add a test proving unchanged source bytes + changed parser/grammar fingerprint cannot reuse stale semantic output.
- [ ] 9.2 Add a test proving unchanged source bytes + changed extraction/fact-schema fingerprint cannot reuse stale semantic facts.
- [ ] 9.3 Add a test proving unchanged source bytes + changed Symbol Identity fingerprint/version invalidates incompatible state.
- [ ] 9.4 Add a test proving unchanged source bytes + changed resolver fingerprint/version invalidates incompatible relationships.
- [ ] 9.5 Add a test proving evidence-schema/evidence-producer incompatibility cannot reopen as trusted exact evidence.
- [ ] 9.6 Add framework-adapter fingerprint invalidation coverage.
- [ ] 9.7 Add API-contract schema/producer fingerprint invalidation coverage.
- [ ] 9.8 Add program-analysis version/language-lowering version invalidation coverage.
- [ ] 9.9 Verify Generation V2 compatibility planning rejects/rebuilds incompatible derived artifacts instead of treating them as fresh.
- [ ] 9.10 Verify BM25/vector/API-contract/program-analysis derived artifacts are invalidated or rebuilt according to their owning compatibility fingerprints.

## 10. Program-analysis capability truth

- [ ] 10.1 Inspect `code-intel/core/src/program-analysis/languages/*`, program-analysis contracts and real-parse integration tests. Produce one authoritative language capability matrix.
- [ ] 10.2 Reconcile the current discrepancy between the historical `143/143 across 10 verified languages` wording and any registry state that reports a different supported count. The final source/tests/README/CHANGELOG/OpenSpec MUST agree.
- [ ] 10.3 For each language, record `supported`, `partial`, `not-applicable` or `unsupported` according to repository-defined evidence, not grammar availability alone.
- [ ] 10.4 Verify the documented meaning of `supported` includes the required real grammar parse/integration proof.
- [ ] 10.5 Add/adjust tests for any language whose current registry state is not actually supported by the required real-parse fixture.
- [ ] 10.6 Verify unsupported/recovered/unlowered constructs preserve explicit unknown/boundary semantics.
- [ ] 10.7 Verify program-analysis resource-limit hits return truncated/unknown metadata and cannot be interpreted as complete.
- [ ] 10.8 Verify interprocedural certainty remains bounded by call-relationship certainty after persistence/reopen.
- [ ] 10.9 Document the public maturity boundary: internal IR/CFG/dataflow/PDG/taint foundation versus currently exposed inspect/MCP/HTTP/UI surfaces.

## 11. Backward compatibility: real 1.0.10 state

- [ ] 11.1 Create an isolated compatibility fixture using the actual `1.0.10` npm/runtime artifact where practical; do not hand-author only a fake `meta.json`.
- [ ] 11.2 Under `1.0.10`, analyze a representative repository and retain its `.code-intel` persisted state.
- [ ] 11.3 Under `1.0.10`, create representative repository registry/config state and a repository group if supported by that version.
- [ ] 11.4 Preserve agent-target selection/user-modified workflow or instruction assets in the compatibility fixture where supported.
- [ ] 11.5 Upgrade/use the candidate `1.0.11` package against that state.
- [ ] 11.6 Verify repository identity/name, configuration and group membership survive.
- [ ] 11.7 Verify incompatible old semantic artifacts are explicitly rebuilt/rejected and cannot be reported `trusted/fresh` merely because files exist.
- [ ] 11.8 Verify representative packaged `search`, `inspect`, `impact`, MCP startup and Web/server startup after upgrade.
- [ ] 11.9 Verify optional embedding/vector state either remains compatible or degrades/rebuilds according to documented compatibility rules.

## 12. Rollback and data preservation

- [ ] 12.1 Execute the self-contained/runtime rollback path after `1.0.11` has run against persisted user state.
- [ ] 12.2 Verify config, repository registry, groups, logs/indexes and user-modified agent assets follow the documented preservation policy.
- [ ] 12.3 If a `1.0.10` runtime cannot safely consume `1.0.11` semantic index artifacts, prove rollback fails closed or requires reanalysis instead of serving stale/misinterpreted data.
- [ ] 12.4 Verify default uninstall preserves user data and only `--purge-data` performs explicitly confirmed destructive removal according to ownership rules.

## 13. MCP and HTTP backward compatibility

- [ ] 13.1 Audit the exported `MCP_TOOL_DEFINITIONS` against live handlers and bundled agent workflows after all `1.0.11` changes.
- [ ] 13.2 Verify legacy tool fields retain their prior meaning for representative tools including search, inspect, blast radius and PR impact.
- [ ] 13.3 Verify new evidence/certainty/coverage fields are additive where promised and older clients that ignore unknown fields still receive usable responses.
- [ ] 13.4 Verify `graph_diff`, API-contract and cross-repo tools expose partial/unavailable state explicitly rather than substituting current/ambient graph state.
- [ ] 13.5 Verify HTTP OpenAPI schema matches actual release handlers for new/changed `1.0.11` endpoints.

## 14. Truncation, pagination and coverage audit

- [ ] 14.1 Inventory bounded MCP/HTTP/CLI surfaces: search, symbol lists, blast radius, paths, graph diff, API consumers, cross-repo consumers, context, PR impact and program-analysis results.
- [ ] 14.2 For each surface document the existing completeness contract (`total`/`hasMore`, `truncated`, `coverage`, lower-bound semantics, etc.).
- [ ] 14.3 Add missing metadata only where a capped result can currently be mistaken for exhaustive proof. Preserve existing backward-compatible pagination conventions when they already express equivalent truth.
- [ ] 14.4 Add tests proving `limit` exhaustion/candidate caps cannot be interpreted by agents as `0 additional results` or `safe/no consumers`.
- [ ] 14.5 Ensure cross-repository known-consumer results remain scoped to synchronized repositories and do not become a claim about the runtime universe.

## 15. Snapshot/diff performance and observability

- [ ] 15.1 Validate `PhaseMetric` timing/RSS fields for snapshot materialization, analysis, readback, fingerprinting, normalization, graph diff and contract diff.
- [ ] 15.2 Add tests proving phase metrics are present only when the phase actually ran and are absent/zero according to the documented cache-hit/failure semantics.
- [ ] 15.3 Document that `analysis.rssDeltaBytes` observes the parent process while actual analysis executes in a child process; it MUST NOT be presented as child analyzer peak RSS.
- [ ] 15.4 Keep `tests/performance/graph-diff-scaling.test.ts` as a graph-diff algorithm scaling gate and verify its assertions do not claim end-to-end parser/snapshot performance.
- [ ] 15.5 If any wall-clock regression gate is added, use tolerant thresholds and separate deterministic correctness-at-scale assertions from noisy shared-runner timing.

## 16. README.md release truth

- [ ] 16.1 Update `README.md` npm badge/version presentation so it does not falsely imply public `1.0.11` availability before publication; prefer a dynamic npm badge or clearly release-candidate-safe wording.
- [ ] 16.2 Update the README architecture section to reflect the real major architecture: Tree-sitter -> Semantic Facts -> Symbol Identity V2 -> Evidence-Based Resolution -> Evidence-Carrying Graph -> Search/Context, API/Contracts, Change Intelligence, Program Analysis.
- [ ] 16.3 Add/update a dedicated Program Analysis Foundation section covering IR, CFG, dominator/control dependence, reaching definitions/def-use, summaries, PDG and bounded taint.
- [ ] 16.4 Add the authoritative supported/partial/not-applicable language matrix derived from task 10.
- [ ] 16.5 Document resource/truncation/uncertainty behavior and current public program-analysis integration limits.
- [ ] 16.6 Correct incremental terminology so correctness-first change detection/full rebuild, dependency-aware planning/foundation, production executor state and semantic snapshot behavior are not conflated.
- [ ] 16.7 Verify self-contained install/doctor/upgrade/version pin/rollback/uninstall documentation matches actual packaged commands and data-preservation behavior.
- [ ] 16.8 Remove or correct any benchmark/performance claim not backed by a current test or benchmark artifact.

## 17. CHANGELOG.md release truth

- [ ] 17.1 Change the `1.0.11` heading to `Unreleased` until the actual publication commit; set the real release date only immediately before the validated release tag.
- [ ] 17.2 Add a dedicated Program Analysis Foundation section summarizing implemented engine capabilities and current limitations/public integration.
- [ ] 17.3 Reconcile all language-count statements with the authoritative capability matrix from task 10.
- [ ] 17.4 Replace any stale claim that `10k/100k-scale diff benchmarking was not performed` with accurate wording: graph-diff logic is regression-tested on synthetic normalized graphs at those scales, while full end-to-end snapshot build at those scales has not been proven unless a new benchmark is actually run.
- [ ] 17.5 Clarify dependency-aware incremental-resolution foundation versus active production execution.
- [ ] 17.6 Add upgrade/index compatibility/rebuild notes that `1.0.10` users need to understand before updating.
- [ ] 17.7 Verify every user-facing `1.0.11` capability mentioned in CHANGELOG has corresponding source and tests or an explicit limitation.

## 18. Security and license gates

- [ ] 18.1 Run `npm audit --audit-level=high --omit=dev` against the release candidate dependency lock and resolve or explicitly approve every production HIGH/CRITICAL finding; unapproved findings block release.
- [ ] 18.2 Run production license audit and verify no GPL/AGPL/noncommercial dependency is newly introduced into the MIT/commercial runtime without approved legal handling.
- [ ] 18.3 Verify npm tarball/runtime bundles/Docker context contain no credentials, access tokens, private developer config or local secrets.
- [ ] 18.4 Run Trivy against the built release image and retain SARIF evidence.
- [ ] 18.5 Verify tag-triggered npm publication uses provenance and the resulting package has verifiable provenance metadata.
- [ ] 18.6 Verify Docker publication produces immutable digest/provenance and cosign signature.
- [ ] 18.7 Verify runtime archives have SHA-256, CycloneDX SBOM and provenance/attestation outputs.

## 19. Agent workflow release safety

- [ ] 19.1 Run workflow registry validation against the exact `MCP_TOOL_DEFINITIONS` shipped in the package.
- [ ] 19.2 Verify all bundled workflow assets are included in npm/runtime packaging.
- [ ] 19.3 Verify rerunning analyze/update preserves user-modified workflow files and reports conflicts rather than overwriting them.
- [ ] 19.4 Verify selected-agent lifecycle behavior remains deterministic for at least Claude Code and Cursor supported workflow targets.
- [ ] 19.5 Verify unsupported selected agent targets report `not-supported` rather than failing the entire release setup/analyze flow.

## 20. Packaged CLI/MCP/HTTP/Web smoke matrix

- [ ] 20.1 From the isolated npm tarball install run `code-intel --version`, `doctor`, `analyze`, repository status/listing, search, inspect and representative impact command.
- [ ] 20.2 Start the packaged MCP server and execute representative registered tools using their actual source-defined names: repository discovery/overview, search, inspect, context, blast radius, relationship explanation, PR/change impact, graph diff, API contract/impact, group status and health/test guidance where available.
- [ ] 20.3 Start the packaged HTTP/Web server and verify major existing pages/surfaces load from packaged assets, not workspace Web source.
- [ ] 20.4 Smoke-test graph explorer, search, node/source detail, query console, contract detail/diff surfaces and group/change views that are part of `1.0.11`.
- [ ] 20.5 Verify empty, stale, partial-coverage, ambiguous and unavailable responses render/return without crashes or fabricated exact results.

## 21. Publish workflow alignment

- [ ] 21.1 Update `.github/workflows/publish.yml` to use the same authoritative build ordering and release validation scripts as the pre-release path wherever practical.
- [ ] 21.2 Ensure publish jobs cannot bypass a release-critical validation script merely because the tag workflow independently reimplements a shorter build sequence.
- [ ] 21.3 Verify npm publish, Docker publish, runtime artifacts, GitHub attestation/signing jobs all depend on successful validation.
- [ ] 21.4 Keep tag publication immutable: the published `v1.0.11` artifacts must be produced from the tagged SHA with no source mutation in the workflow.

## 22. Final release candidate gate

- [ ] 22.1 Select the exact final `RC_COMMIT` after all implementation/documentation changes above are committed.
- [ ] 22.2 Run the complete authoritative pre-release workflow on `RC_COMMIT` and require all mandatory jobs green.
- [ ] 22.3 Confirm no commit exists on `release/1.0.11` after the validated `RC_COMMIT`. If HEAD changed, invalidate the candidate and rerun from task 22.1.
- [ ] 22.4 Confirm `README.md`, `CHANGELOG.md`, package metadata and OpenSpec all describe the same `1.0.11` capability/release state.
- [ ] 22.5 Set the final actual release date in `CHANGELOG.md` only after all other gates pass, commit it, and rerun the complete validation because the SHA changed.
- [ ] 22.6 Tag `v1.0.11` only at the final validated SHA.

## 23. Post-publication verification

- [ ] 23.1 Verify the public npm registry reports `@vohongtho.infotech/code-intel@1.0.11`.
- [ ] 23.2 Install the public npm package in a fresh temporary environment and rerun version/doctor/analyze/MCP/server smoke tests.
- [ ] 23.3 Pull the published GHCR `1.0.11` image by immutable digest and run version/startup smoke tests.
- [ ] 23.4 Download published self-contained runtime artifact(s), verify checksum/SBOM/provenance and run the host-compatible bundle.
- [ ] 23.5 Verify GitHub Release artifacts correspond to the tagged SHA and release evidence.
- [ ] 23.6 If a critical defect is found after npm publication, do not overwrite `1.0.11`; prepare a corrective patch release (normally `1.0.12`) and stop promoting a defective mutable Docker alias where applicable.

## 24. Mandatory documentation completion

- [ ] 24.1 Update `README.md` as specified in section 16 before marking this OpenSpec change complete.
- [ ] 24.2 Update `CHANGELOG.md` as specified in section 17 before marking this OpenSpec change complete.
- [ ] 24.3 Run OpenSpec validation after all requirement/task/spec changes.
- [ ] 24.4 Archive `v1-0-11-release-readiness-hardening` only after release blockers are closed and the exact-SHA release gate has passed; if OpenSpec archival is intentionally performed only after publication, document that lifecycle explicitly.
