---
name: storage
description: "Covers the **storage** subsystem of code-intel-platform. 20 symbols across 6 files. Key symbols: `writeNodeCSVs`, `writeEdgeCSV`. Internal call density: 0.6 calls/symbol."
---

# storage

> **20 symbols** | **6 files** | path: `code-intel/core/src/storage/` | call density: 0.6/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/storage/`
- The user mentions `writeNodeCSVs`, `writeEdgeCSV` or asks how they work
- Adding, modifying, or debugging storage-related functionality
- Tracing call chains that pass through the storage layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/storage/metadata.ts` | `IndexMetadata`, `saveMetadata`, `loadMetadata`, `getDbPath` +(1) | 5 exported |
| `code-intel/core/src/storage/repo-registry.ts` | `RepoEntry`, `loadRegistry`, `saveRegistry`, `upsertRepo` +(1) | 5 exported |
| `code-intel/core/src/storage/csv-writer.ts` | `writeNodeCSVs`, `EdgeCSVGroup`, `writeEdgeCSV`, `csvRow` | 3 exported |
| `code-intel/core/src/storage/graph-loader.ts` | `loadGraphToDB`, `buildNodeProps`, `escCypher` | 1 exported |
| `code-intel/core/src/storage/schema.ts` | `getCreateNodeTableDDL`, `getCreateEdgeTableDDL` | 2 exported |
| `code-intel/core/src/storage/db-manager.ts` | `DbManager` | 1 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`writeNodeCSVs`** `(function)` → `code-intel/core/src/storage/csv-writer.ts:7`
- **`writeEdgeCSV`** `(function)` → `code-intel/core/src/storage/csv-writer.ts:49`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `loadRegistry` | function | 9 | 0 | `storage/repo-registry.ts` |
| `DbManager` | class | 5 | 0 | `storage/db-manager.ts` |
| `loadGraphToDB` | function | 1 | 4 | `storage/graph-loader.ts` |
| `upsertRepo` | function | 1 | 2 | `storage/repo-registry.ts` |
| `removeRepo` | function | 1 | 2 | `storage/repo-registry.ts` |
| `csvRow` | function | 2 | 0 | `storage/csv-writer.ts` |
| `buildNodeProps` | function | 1 | 1 | `storage/graph-loader.ts` |
| `escCypher` | function | 2 | 0 | `storage/graph-loader.ts` |
| `loadMetadata` | function | 2 | 0 | `storage/metadata.ts` |
| `getDbPath` | function | 2 | 0 | `storage/metadata.ts` |
| `getVectorDbPath` | function | 2 | 0 | `storage/metadata.ts` |
| `saveRegistry` | function | 2 | 0 | `storage/repo-registry.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect loadRegistry
# Blast radius for entry point
code-intel impact writeNodeCSVs
# Search this area
code-intel search "storage"
```
