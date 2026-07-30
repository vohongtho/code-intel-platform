# Tasks

- [ ] Replace the current multi-artifact publication sequence with generation-based staging.
- [ ] Validate graph, BM25, vector and metadata artifacts before publication.
- [ ] Publish all required artifacts behind one generation pointer.
- [ ] Preserve the previous generation after any graph, BM25, vector or metadata failure.
- [ ] Remove redundant `IncrementalIndexer.patchGraph()` work from the main analyze path after equivalence tests are in place.
- [ ] Add full-vs-incremental normalized graph equivalence tests.
- [ ] Add failure-injection tests that reopen persisted artifacts after each publication failure point.
- [ ] Add index trust/freshness status to CLI, HTTP and MCP.
- [ ] Add migration handling for the existing flat `.code-intel` artifact layout.

> Status: not implemented in this session. The current code publishes `graph.db` before rebuilding BM25/vector, so a safe fix requires a coordinated persistence redesign rather than an unverified local patch.
