# Change: Fix Incremental Correctness Release Blockers

## Why

The v1.0.8 release candidate still inherits two high-severity incremental-analysis defects from v1.0.7:

1. Git change detection compares the stored commit with `HEAD`, so staged, unstaged and untracked working-tree files can be silently omitted when the stored commit equals the current commit.
2. A non-zero incremental run processes changed files in the main pipeline and then processes them again through `IncrementalIndexer.patchGraph()`. The second replacement removes derived edges created by cluster/flow/summarize phases and does not recreate them before the full graph is persisted.

These defects can publish a trusted but stale or structurally incomplete index. They block v1.0.8 release.

## What Changes

- Detect committed, staged, unstaged and untracked source changes relative to the previously indexed commit.
- Union Git evidence with the stored mtime snapshot instead of treating a successful Git command as complete evidence.
- Normalize and deduplicate changed paths.
- Make `analyzeWorkspace()` the single owner of incremental graph mutation.
- Remove changed/deleted file nodes from the loaded in-memory graph before the main pipeline runs.
- Run structure, parse, resolve, cluster, flow and summarize exactly once for changed existing files.
- Persist the complete graph once and build/update BM25 once.
- Add integration regression coverage proving dirty-tree detection and incremental/full-rebuild equivalence.

## Scope

### In scope

- `pipeline/incremental.ts`
- `cli/app.ts`
- reusable graph-removal helper extracted from incremental indexing
- incremental unit and integration tests
- release-readiness coverage

### Out of scope

- Changing the 20% full-analysis fallback threshold
- Redesigning clustering, flow or summarization algorithms
- Supporting ignored files that are intentionally excluded by Git and code-intel scan rules

## Risks

- Removing nodes before the pipeline may expose assumptions that changed-file nodes still exist during resolution.
- Untracked file detection must remain filtered by the scanner's supported/excluded file set.
- mtime precision differs by filesystem; Git and mtime results must be unioned and deduplicated.

## Release Gate

v1.0.8 remains No-Go until all tasks pass on one head commit, including an end-to-end comparison showing that incremental analysis produces graph relationships equivalent to a clean full rebuild for the same source tree.
