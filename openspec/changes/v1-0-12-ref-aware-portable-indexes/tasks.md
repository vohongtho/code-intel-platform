# Tasks: Ref-Aware and Portable Indexes

## 1. Read view
- [x] Create `storage/index-view.ts` and `index-view-resolver.ts` over Generation V2 and semantic snapshots.
- [x] Add read pin/release integration with snapshot cache eviction.
- [x] Add unit tests for current/ref/cache-hit/cache-build/unknown-ref/failure.

## 2. Ref selectors
- [x] Add optional `ref` to applicable repo-selectable MCP definitions and thread it through one view resolver.
- [x] Extend corresponding HTTP/CLI read contracts without changing default current-index behavior.
- [x] Ensure alternate-ref search never uses active-generation vectors; assert requested/actual mode.
- [x] Add integration test querying two refs concurrently and proving checkout/current Generation remain unchanged.

## 3. Portable format
- [x] Create `snapshots/portable-format.ts` with bounded versioned manifest and artifact allowlist.
- [x] Create `snapshots/export-import.ts` with deterministic export and staging/readback/atomic import.
- [x] Add `index refs`, `index export`, `index import`, local pin/unpin/removal commands.
- [x] Add hash, path traversal, symlink, max-size/count, repository identity and fingerprint mismatch tests.

## 4. Privacy
- [x] Implement metadata-only graph rewrite/readback; never byte-edit DBs.
- [x] Decide whether BM25 is rebuilt or omitted for metadata-only packages and encode that capability explicitly.
- [x] Add tests proving source-dependent features report a boundary rather than returning stale/hidden content.

## 5. Web graph diff
- [x] Reuse the existing `GraphDiffPage`, graph-diff API client/types and `/diff` route; do not create duplicate page/components.
- [x] Extend existing wire types/rendering with backend-provided stable-flow deltas and selected-index identity only when those fields are available.
- [x] Keep all diff classification rules server-side.
- [x] Extend existing large/paginated/partial/candidate-continuity UI tests with stable-flow and index-view metadata cases.

## 6. Performance/release
- [x] Benchmark cached ref vs current-generation read overhead.
- [x] Benchmark export/import scaling by artifact bytes.
- [x] Update README/OpenAPI/MCP docs after behavior is proven.
- [x] Run snapshot/storage/search/Web/e2e/package/release gates.
