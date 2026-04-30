---
name: search
description: "Covers the **search** subsystem of code-intel-platform. 24 symbols across 3 files. Key symbols: `isTestPath`, `isDistPath`, `constructor`. Internal call density: 0.4 calls/symbol."
---

# search

> **24 symbols** | **3 files** | path: `code-intel/core/src/search/` | call density: 0.4/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/search/`
- The user mentions `isTestPath`, `isDistPath`, `constructor` or asks how they work
- Adding, modifying, or debugging search-related functionality
- Tracing call chains that pass through the search layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/search/vector-index.ts` | `CachedRow`, `VectorIndex`, `constructor`, `init` +(11) | 9 exported |
| `code-intel/core/src/search/text-search.ts` | `SearchResult`, `textSearch`, `isTestPath`, `isDistPath` +(1) | 5 exported |
| `code-intel/core/src/search/embedder.ts` | `EmbeddedNode`, `getEmbedder`, `embedNodes`, `buildText` | 2 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`isTestPath`** `(function)` → `code-intel/core/src/search/text-search.ts:21`
- **`isDistPath`** `(function)` → `code-intel/core/src/search/text-search.ts:23`
- **`constructor`** `(method)` → `code-intel/core/src/search/vector-index.ts:32`
- **`close`** `(method)` → `code-intel/core/src/search/vector-index.ts:126`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `embedNodes` | function | 2 | 6 | `search/embedder.ts` |
| `reciprocalRankFusion` | function | 4 | 3 | `search/text-search.ts` |
| `textSearch` | function | 6 | 0 | `search/text-search.ts` |
| `buildIndex` | method | 3 | 3 | `search/vector-index.ts` |
| `search` | method | 1 | 4 | `search/vector-index.ts` |
| `topKSort` | function | 1 | 3 | `search/vector-index.ts` |
| `isBuilt` | method | 1 | 2 | `search/vector-index.ts` |
| `siftDown` | function | 2 | 1 | `search/vector-index.ts` |
| `VectorIndex` | class | 2 | 0 | `search/vector-index.ts` |
| `_loadCache` | method | 1 | 1 | `search/vector-index.ts` |
| `heapify` | function | 1 | 1 | `search/vector-index.ts` |
| `getEmbedder` | function | 1 | 0 | `search/embedder.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect embedNodes
# Blast radius for entry point
code-intel impact isTestPath
# Search this area
code-intel search "search"
```
