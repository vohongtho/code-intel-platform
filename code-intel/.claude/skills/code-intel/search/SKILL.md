---
name: search
description: "Covers the **search** subsystem of code-intel. 17 symbols across 3 files. Key symbols: `isTestPath`, `isDistPath`, `constructor`. Internal call density: 0.2 calls/symbol."
---

# search

> **17 symbols** | **3 files** | path: `core/src/search/` | call density: 0.2/sym

## When to Use

Load this skill when:
- The task involves code in `core/src/search/`
- The user mentions `isTestPath`, `isDistPath`, `constructor` or asks how they work
- Adding, modifying, or debugging search-related functionality
- Tracing call chains that pass through the search layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `core/src/search/vector-index.ts` | `VectorIndex`, `constructor`, `init`, `buildIndex` +(4) | 7 exported |
| `core/src/search/text-search.ts` | `SearchResult`, `textSearch`, `isTestPath`, `isDistPath` +(1) | 5 exported |
| `core/src/search/embedder.ts` | `EmbeddedNode`, `getEmbedder`, `embedNodes`, `buildText` | 2 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`isTestPath`** `(function)` → `core/src/search/text-search.ts:21`
- **`isDistPath`** `(function)` → `core/src/search/text-search.ts:23`
- **`constructor`** `(method)` → `core/src/search/vector-index.ts:11`
- **`init`** `(method)` → `core/src/search/vector-index.ts:15`
- **`search`** `(method)` → `core/src/search/vector-index.ts:59`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `embedNodes` | function | 2 | 5 | `search/embedder.ts` |
| `reciprocalRankFusion` | function | 4 | 3 | `search/text-search.ts` |
| `textSearch` | function | 6 | 0 | `search/text-search.ts` |
| `buildIndex` | method | 2 | 2 | `search/vector-index.ts` |
| `isBuilt` | method | 1 | 2 | `search/vector-index.ts` |
| `VectorIndex` | class | 2 | 0 | `search/vector-index.ts` |
| `getEmbedder` | function | 1 | 0 | `search/embedder.ts` |
| `buildText` | function | 1 | 0 | `search/embedder.ts` |
| `init` | method | 0 | 1 | `search/vector-index.ts` |
| `search` | method | 0 | 1 | `search/vector-index.ts` |
| `esc` | function | 1 | 0 | `search/vector-index.ts` |
| `EmbeddedNode` | interface | 0 | 0 | `search/embedder.ts` |

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
