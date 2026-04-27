---
name: search
description: "Covers the **search** subsystem of code-intel-platform. 12 symbols across 3 files. Key symbols: `textSearch`, `reciprocalRankFusion`, `embedNodes`. Internal call density: 0.1 calls/symbol."
---

# search

> **12 symbols** | **3 files** | path: `code-intel/core/src/search/` | call density: 0.1/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/search/`
- The user mentions `textSearch`, `reciprocalRankFusion`, `embedNodes` or asks how they work
- Adding, modifying, or debugging search-related functionality
- Tracing call chains that pass through the search layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/search/text-search.ts` | `SearchResult`, `textSearch`, `isTestPath`, `isDistPath` +(1) | 3 exported |
| `code-intel/core/src/search/embedder.ts` | `EmbeddedNode`, `getEmbedder`, `embedNodes`, `buildText` | 2 exported |
| `code-intel/core/src/search/vector-index.ts` | `VectorIndex`, `VectorHit`, `esc` | 2 exported |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `textSearch` | function | 5 | 0 | `search/text-search.ts` |
| `reciprocalRankFusion` | function | 3 | 0 | `search/text-search.ts` |
| `embedNodes` | function | 2 | 0 | `search/embedder.ts` |
| `VectorIndex` | class | 2 | 0 | `search/vector-index.ts` |
| `getEmbedder` | function | 1 | 0 | `search/embedder.ts` |
| `buildText` | function | 1 | 0 | `search/embedder.ts` |
| `isTestPath` | function | 1 | 0 | `search/text-search.ts` |
| `isDistPath` | function | 0 | 1 | `search/text-search.ts` |
| `esc` | function | 1 | 0 | `search/vector-index.ts` |
| `EmbeddedNode` | interface | 0 | 0 | `search/embedder.ts` |
| `SearchResult` | interface | 0 | 0 | `search/text-search.ts` |
| `VectorHit` | interface | 0 | 0 | `search/vector-index.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect textSearch
# Blast radius for entry point
code-intel impact textSearch
# Search this area
code-intel search "search"
```
