# Tasks

- [ ] Replace shell-string Git execution with argument-based commands.
- [ ] Detect tracked changes relative to the stored commit, including staged and unstaged changes.
- [ ] Include untracked, non-ignored files.
- [ ] Union Git and mtime evidence, normalize paths and deduplicate results.
- [ ] Add unit tests for clean, committed, staged, unstaged, untracked and deleted files.
- [ ] Remove changed/deleted file nodes before the main incremental pipeline.
- [ ] Remove the second `IncrementalIndexer.patchGraph()` execution from `analyzeWorkspace()`.
- [ ] Ensure structure/parse/resolve run once for each changed file.
- [ ] Ensure graph persistence and BM25 update each execute once.
- [ ] Preserve cluster membership, flow relationships and summary metadata.
- [ ] Add incremental-vs-full-rebuild equivalence coverage.
- [ ] Add idempotent repeated-incremental coverage.
- [ ] Run Quality, Test, PR Impact and Release Readiness on the same head commit.
