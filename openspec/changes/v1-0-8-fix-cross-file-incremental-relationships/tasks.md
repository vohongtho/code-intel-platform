# Tasks

- [x] Prevent non-empty incremental changes from publishing a partially re-resolved graph.
- [x] Use a correctness-first full rebuild fallback for changed or deleted files in v1.0.8.
- [x] Preserve the zero-change incremental fast path.
- [x] Add a regression fixture with unchanged callers/importers/inheritors targeting a changed file.
- [x] Verify clusters and flows match a clean rebuild through canonical graph equivalence.
- [x] Return vector execution status from hybrid search.
- [x] Map missing/unbuilt vector index to `VECTOR_INDEX_UNAVAILABLE`.
- [x] Map vector query exceptions to `VECTOR_QUERY_FAILED`.
- [x] Add search contract regression tests for unavailable and failed vector execution.
- [x] Run Quality, Test, PR Impact, and Release Readiness on the same head commit.
