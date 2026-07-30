# Proposal: Stabilize Incremental Indexing and Add Index Trust

## Intent

Make incremental analysis a trustworthy substitute for full analysis and expose whether the published index reflects the current source tree.

## Why

Version 1.0.7 can return stale or structurally incomplete results in normal development workflows:

- Incremental Git detection compares a stored commit only with `HEAD`, so staged, unstaged, and untracked source changes can be omitted.
- The CLI runs structure/parse/resolve for changed files, then `IncrementalIndexer.patchGraph()` removes those results and runs structure/parse/resolve again.
- Cluster and flow phases run before the second removal, so cascading node deletion can remove `belongs_to` and `step_of` edges without rebuilding them.
- `IncrementalIndexer` mutates the currently published graph DB and BM25 DB before the later complete publication succeeds.
- Metadata timestamps do not prove that graph, BM25, vector, and source state belong to one consistent generation.

These failures affect search, inspect, blast radius, flow, cluster, context, PR impact, and any coding agent that trusts the graph.

## What changes

### Complete workspace change detection

Add a shared collector that merges committed, staged, unstaged, untracked, deleted, renamed, and copied files. Use `execFileSync('git', args)` or an injected equivalent. Normalize all paths relative to the workspace and preserve the source of each observation.

### Single-pass incremental kernel

Replace the duplicate incremental flow with one kernel that removes affected source nodes in memory, parses changed files exactly once, recomputes derived cluster and flow artifacts against the complete final graph, validates invariants, and builds replacement persistence artifacts once.

### Generation-based atomic publication

Store each analysis output under a generation directory and publish it by atomically replacing one small `current.json` manifest. Graph, BM25, vector, and metadata files are never overwritten in the active generation.

### Index trust and freshness

Add a shared trust evaluator and expose it through CLI `status --verify`, MCP `index_status`, and `GET /api/v1/index/status`.

### One-time v1.0.7 rebuild

Indexes without `analysisKernelVersion: 2` are marked `REBUILD_REQUIRED`. The next analysis performs one full rebuild before incremental analysis is allowed.

## Compatibility

Existing analyze, serve, watch, and MCP entry points remain. Legacy flat artifacts remain readable as migration input but cannot be reported as trusted.

## Non-goals

- Affected-only cluster or flow recomputation.
- Distributed publication.
- Replacing LadybugDB or SQLite.
- Changing node ID generation.
- Automatically fixing source code.

## Success measures

- The working-tree matrix has no missed source files.
- Incremental and full analysis produce equal normalized graph snapshots.
- Each changed file is parsed and resolved once.
- Failure injection never changes the active generation.
- Trust status identifies every stale or corrupt condition with a stable reason code.
