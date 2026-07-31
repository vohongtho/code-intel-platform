# Tasks

- [ ] Prevent non-empty incremental changes from publishing a partially re-resolved graph.
- [ ] Use a correctness-first full rebuild fallback for changed or deleted files in v1.0.8.
- [ ] Preserve the zero-change incremental fast path.
- [ ] Add a regression fixture with unchanged callers/importers/inheritors targeting a changed file.
- [ ] Verify clusters and flows match a clean rebuild.
- [ ] Return vector execution status from hybrid search.
- [ ] Map missing/unbuilt vector index to `VECTOR_INDEX_UNAVAILABLE`.
- [ ] Map vector query exceptions to `VECTOR_QUERY_FAILED`.
- [ ] Add search contract regression tests.
- [ ] Run Quality, Test, PR Impact, and Release Readiness on the same head commit.