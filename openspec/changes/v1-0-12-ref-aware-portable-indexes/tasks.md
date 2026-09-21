# Tasks: Ref-Aware and Portable Indexes

## 1. Read view
- [ ] Create `storage/index-view.ts` and `index-view-resolver.ts` over Generation V2 and semantic snapshots.
- [ ] Add read pin/release integration with snapshot cache eviction.
- [ ] Add unit tests for current/ref/cache-hit/cache-build/unknown-ref/failure.

## 2. Ref selectors
- [ ] Add optional `ref` to applicable repo-selectable MCP definitions and thread it through one view resolver.
- [ ] Extend corresponding HTTP/CLI read contracts without changing default current-index behavior.
- [ ] Ensure alternate-ref search never uses active-generation vectors; assert requested/actual mode.
- [ ] Add integration test querying two refs concurrently and proving checkout/current Generation remain unchanged.

## 3. Portable format
- [ ] Create `snapshots/portable-format.ts` with bounded versioned manifest and artifact allowlist.
- [ ] Create `snapshots/export-import.ts` with deterministic export and staging/readback/atomic import.
- [ ] Add `index refs`, `index export`, `index import`, local pin/unpin/removal commands.
- [ ] Add hash, path traversal, symlink, max-size/count, repository identity and fingerprint mismatch tests.

## 4. Privacy
- [ ] Implement metadata-only graph rewrite/readback; never byte-edit DBs.
- [ ] Decide whether BM25 is rebuilt or omitted for metadata-only packages and encode that capability explicitly.
- [ ] Add tests proving source-dependent features report a boundary rather than returning stale/hidden content.

## 5. Web graph diff
- [ ] Reuse the existing `GraphDiffPage`, graph-diff API client/types and `/diff` route; do not create duplicate page/components.
- [ ] Extend existing wire types/rendering with backend-provided stable-flow deltas and selected-index identity only when those fields are available.
- [ ] Keep all diff classification rules server-side.
- [ ] Extend existing large/paginated/partial/candidate-continuity UI tests with stable-flow and index-view metadata cases.

## 6. Performance/release
- [ ] Benchmark cached ref vs current-generation read overhead.
- [ ] Benchmark export/import scaling by artifact bytes.
- [ ] Update README/OpenAPI/MCP docs after behavior is proven.
- [ ] Run snapshot/storage/search/Web/e2e/package/release gates.
