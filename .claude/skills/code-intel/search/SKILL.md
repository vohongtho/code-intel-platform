---
name: search
description: "Covers the **search** subsystem of code-intel-platform. 40 symbols across 5 files. Key symbols: `constructor`, `isLoaded`, `search`. Internal call density: 0.5 calls/symbol."
---

# search

> **40 symbols** | **5 files** | path: `code-intel/core/src/search/` | call density: 0.5/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/search/`
- The user mentions `constructor`, `isLoaded`, `search` or asks how they work
- Adding, modifying, or debugging search-related functionality
- Tracing call chains that pass through the search layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/search/vector-index.ts` | `CachedRow`, `VectorIndex`, `constructor`, `init` +(11) | 9 exported |
| `code-intel/core/src/search/bm25-index.ts` | `PostingEntry`, `NodeMeta`, `tokenize`, `nodeToDoc` +(8) | 8 exported |
| `code-intel/core/src/search/text-search.ts` | `SearchResult`, `textSearch`, `isTestPath`, `isDistPath` +(1) | 5 exported |
| `code-intel/core/src/search/embedder.ts` | `EmbeddedNode`, `getEmbedder`, `embedNodes`, `buildText` | 4 exported |
| `code-intel/core/src/search/hybrid-search.ts` | `HybridSearchOptions`, `HybridSearchResult`, `hybridSearch`, `runVectorSearch` | 3 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`constructor`** `(method)` → `code-intel/core/src/search/bm25-index.ts:62`
- **`isLoaded`** `(method)` → `code-intel/core/src/search/bm25-index.ts:64`
- **`search`** `(method)` → `code-intel/core/src/search/bm25-index.ts:201`
- **`hybridSearch`** `(function)` → `code-intel/core/src/search/hybrid-search.ts:26`
- **`isTestPath`** `(function)` → `code-intel/core/src/search/text-search.ts:21`
- **`isDistPath`** `(function)` → `code-intel/core/src/search/text-search.ts:23`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `updateNodes` | method | 2 | 13 | `search/bm25-index.ts` |
| `load` | method | 5 | 9 | `search/bm25-index.ts` |
| `build` | method | 3 | 10 | `search/bm25-index.ts` |
| `embedNodes` | function | 2 | 7 | `search/embedder.ts` |
| `runVectorSearch` | function | 1 | 8 | `search/hybrid-search.ts` |
| `reciprocalRankFusion` | function | 5 | 3 | `search/text-search.ts` |
| `textSearch` | function | 7 | 0 | `search/text-search.ts` |
| `hybridSearch` | function | 0 | 6 | `search/hybrid-search.ts` |
| `buildIndex` | method | 3 | 3 | `search/vector-index.ts` |
| `Bm25Index` | class | 5 | 0 | `search/bm25-index.ts` |
| `search` | method | 0 | 5 | `search/bm25-index.ts` |
| `search` | method | 1 | 4 | `search/vector-index.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect updateNodes
# Blast radius for entry point
code-intel impact constructor
# Search this area
code-intel search "search"
```
