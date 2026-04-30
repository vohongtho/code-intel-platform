---
name: skill
description: "Covers the **.** subsystem of search. 18 symbols across 3 files. Key symbols: `embedNodes`, `textSearch`, `isTestPath`. Internal call density: 0.2 calls/symbol."
---

# .

> **18 symbols** | **3 files** | path: `./` | call density: 0.2/sym

## When to Use

Load this skill when:
- The task involves code in `./`
- The user mentions `embedNodes`, `textSearch`, `isTestPath` or asks how they work
- Adding, modifying, or debugging .-related functionality
- Tracing call chains that pass through the . layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `vector-index.ts` | `VectorIndex`, `constructor`, `init`, `buildIndex` +(5) | 8 exported |
| `text-search.ts` | `SearchResult`, `textSearch`, `isTestPath`, `isDistPath` +(1) | 5 exported |
| `embedder.ts` | `EmbeddedNode`, `getEmbedder`, `embedNodes`, `buildText` | 2 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`embedNodes`** `(function)` → `embedder.ts:24`
- **`textSearch`** `(function)` → `text-search.ts:12`
- **`isTestPath`** `(function)` → `text-search.ts:21`
- **`isDistPath`** `(function)` → `text-search.ts:23`
- **`reciprocalRankFusion`** `(function)` → `text-search.ts:65`
- **`VectorIndex`** `(class)` → `vector-index.ts:15`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `embedNodes` | function | 0 | 3 | `embedder.ts` |
| `getEmbedder` | function | 1 | 0 | `embedder.ts` |
| `buildText` | function | 1 | 0 | `embedder.ts` |
| `buildIndex` | method | 0 | 1 | `vector-index.ts` |
| `search` | method | 0 | 1 | `vector-index.ts` |
| `cosineSimilarity` | function | 1 | 0 | `vector-index.ts` |
| `EmbeddedNode` | interface | 0 | 0 | `embedder.ts` |
| `SearchResult` | interface | 0 | 0 | `text-search.ts` |
| `textSearch` | function | 0 | 0 | `text-search.ts` |
| `isTestPath` | function | 0 | 0 | `text-search.ts` |
| `isDistPath` | function | 0 | 0 | `text-search.ts` |
| `reciprocalRankFusion` | function | 0 | 0 | `text-search.ts` |

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
code-intel impact embedNodes
# Search this area
code-intel search "."
```
