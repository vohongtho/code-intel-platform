---
name: skill
description: "Covers the **.** subsystem of search. 24 symbols across 3 files. Key symbols: `embedNodes`, `textSearch`, `isTestPath`. Internal call density: 0.4 calls/symbol. Participates in 1 execution flow(s)."
---

# .

> **24 symbols** | **3 files** | path: `./` | call density: 0.4/sym

## When to Use

Load this skill when:
- The task involves code in `./`
- The user mentions `embedNodes`, `textSearch`, `isTestPath` or asks how they work
- Adding, modifying, or debugging .-related functionality
- Tracing call chains that pass through the . layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `vector-index.ts` | `CachedRow`, `VectorIndex`, `constructor`, `init` +(11) | 9 exported |
| `text-search.ts` | `SearchResult`, `textSearch`, `isTestPath`, `isDistPath` +(1) | 5 exported |
| `embedder.ts` | `EmbeddedNode`, `getEmbedder`, `embedNodes`, `buildText` | 2 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`embedNodes`** `(function)` → `embedder.ts:28`
- **`textSearch`** `(function)` → `text-search.ts:12`
- **`isTestPath`** `(function)` → `text-search.ts:21`
- **`isDistPath`** `(function)` → `text-search.ts:23`
- **`reciprocalRankFusion`** `(function)` → `text-search.ts:65`
- **`VectorIndex`** `(class)` → `vector-index.ts:26`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `search` | method | 1 | 4 | `vector-index.ts` |
| `embedNodes` | function | 0 | 4 | `embedder.ts` |
| `topKSort` | function | 1 | 3 | `vector-index.ts` |
| `siftDown` | function | 2 | 1 | `vector-index.ts` |
| `buildIndex` | method | 1 | 1 | `vector-index.ts` |
| `heapify` | function | 1 | 1 | `vector-index.ts` |
| `getEmbedder` | function | 1 | 0 | `embedder.ts` |
| `buildText` | function | 1 | 0 | `embedder.ts` |
| `init` | method | 1 | 0 | `vector-index.ts` |
| `_loadCache` | method | 1 | 0 | `vector-index.ts` |
| `dotProduct` | function | 1 | 0 | `vector-index.ts` |
| `norm` | function | 1 | 0 | `vector-index.ts` |

## Execution Flows

**1** execution path(s) pass through this area.
Run `code-intel inspect <symbol>` on a hot symbol to trace the full call chain.

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect search
# Blast radius for entry point
code-intel impact embedNodes
# Search this area
code-intel search "."
```
