# Tasks

- [x] Replace shell-string Git execution with argument-based commands.
- [x] Detect tracked changes relative to the stored commit, including staged and unstaged changes.
- [x] Include untracked, non-ignored files.
- [x] Union Git and mtime evidence, normalize paths and deduplicate results.
- [x] Add unit tests for clean, committed, staged, unstaged, untracked and deleted files.
- [x] Remove changed/deleted file nodes before the main incremental pipeline.
- [x] Remove the second `IncrementalIndexer.patchGraph()` execution from `analyzeWorkspace()`.
- [x] Ensure structure/parse/resolve run once for each changed file.
- [x] Ensure graph persistence and BM25 update each execute once.
- [x] Preserve cluster membership, flow relationships and summary metadata by running all derived phases after the single changed-file parse.
- [x] Add incremental-vs-full-rebuild equivalence coverage for canonical nodes and edges.
- [x] Add idempotent zero-change/repeated incremental coverage through the existing clean-HEAD decision tests and release smoke path.
- [x] Run Quality, Test, PR Impact and Release Readiness on the same head commit.

## Validation evidence

Release Readiness creates a real Git repository, performs an initial analysis, modifies a tracked file without committing, adds an untracked source file, runs auto-incremental analysis, verifies both new symbols are searchable, serializes the resulting graph, runs a clean forced rebuild over the same source tree, and requires canonical node/edge equality.
