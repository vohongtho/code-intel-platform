# Tasks

- [ ] Create versioned semantic snapshot serialization over fact/identity/resolution compatibility metadata; add deterministic fingerprint tests.
- [ ] Create semantic fact diffing that distinguishes body-only changes from declaration/import/type/registration changes.
- [ ] Create reverse dependency index contracts and implementation for module/public-surface, type, heritage, reference/call-site, callback/event, registration, route/contract domains.
- [ ] Create deterministic invalidation-closure traversal with breadth/depth limits that force full fallback rather than truncated incremental publication.
- [ ] Create one `ArtifactDeltaPlan` shared by graph/BM25/vector/evidence/flow/cluster/program-analysis invalidation.
- [ ] Modify `code-intel/core/src/pipeline/incremental.ts` so the current non-zero-change full rebuild remains fallback while dependency-aware candidate planning is added internally.
- [ ] Modify `code-intel/core/src/pipeline/analysis-plan.ts` to select non-zero incremental graph/BM25 work only when semantic/reverse-index compatibility and closure completeness are proven.
- [ ] Re-resolve invalidated call/reference sites in unchanged source files.
- [ ] Handle deleted, moved, renamed declarations and public-surface/re-export removals transitively.
- [ ] Integrate existing vector incremental logic with the shared semantic delta rather than independently broadening/narrowing scope.
- [ ] Keep all mutation inside Generation V2 staging and existing analyze serialization.
- [ ] Extend full-vs-force release-readiness snapshots to include canonical IDs, repeated call sites, relationship trust, required evidence, BM25/vector membership receipts.
- [ ] Add 50–100 edit long-history convergence tests for representative languages and shared-language fixtures.
- [ ] Add body-only narrow-invalidation tests and broad/unknown closure automatic-full-fallback tests.
- [ ] Add dirty working-tree staged/unstaged/untracked/deleted fixtures with deterministic Git identity.
- [ ] Enable production non-zero incremental publication only after all 15 language convergence rows pass.
- [ ] Run performance comparison, full tests, package validation, and OpenSpec validation.
