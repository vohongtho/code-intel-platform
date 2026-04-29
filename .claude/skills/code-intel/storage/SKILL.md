---
name: storage
description: "Covers the **storage** subsystem of code-intel-platform. 33 symbols across 6 files. Key symbols: `constructor`, `execute`, `isOpen`. Internal call density: 0.7 calls/symbol."
---

# storage

> **33 symbols** | **6 files** | path: `code-intel/core/src/storage/` | call density: 0.7/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/storage/`
- The user mentions `constructor`, `execute`, `isOpen` or asks how they work
- Adding, modifying, or debugging storage-related functionality
- Tracing call chains that pass through the storage layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/storage/graph-loader.ts` | `loadGraphToDB`, `loadTableFallback`, `loadEdgeGroupFallback`, `upsertNode` +(5) | 5 exported |
| `code-intel/core/src/storage/db-manager.ts` | `DbManager`, `constructor`, `init`, `query` +(3) | 7 exported |
| `code-intel/core/src/storage/csv-writer.ts` | `writeNodeCSVs`, `EdgeCSVGroup`, `writeEdgeCSV`, `csvRow` +(1) | 3 exported |
| `code-intel/core/src/storage/metadata.ts` | `IndexMetadata`, `saveMetadata`, `loadMetadata`, `getDbPath` +(1) | 5 exported |
| `code-intel/core/src/storage/repo-registry.ts` | `RepoEntry`, `loadRegistry`, `saveRegistry`, `upsertRepo` +(1) | 5 exported |
| `code-intel/core/src/storage/schema.ts` | `getCreateNodeTableDDL`, `getCreateEdgeTableDDL` | 2 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`constructor`** `(method)` → `code-intel/core/src/storage/db-manager.ts:10`
- **`execute`** `(method)` → `code-intel/core/src/storage/db-manager.ts:31`
- **`isOpen`** `(method)` → `code-intel/core/src/storage/db-manager.ts:52`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `close` | method | 22 | 0 | `storage/db-manager.ts` |
| `loadGraphToDB` | function | 1 | 12 | `storage/graph-loader.ts` |
| `init` | method | 11 | 0 | `storage/db-manager.ts` |
| `writeEdgeCSV` | function | 2 | 7 | `storage/csv-writer.ts` |
| `loadRegistry` | function | 9 | 0 | `storage/repo-registry.ts` |
| `writeNodeCSVs` | function | 2 | 6 | `storage/csv-writer.ts` |
| `query` | method | 7 | 1 | `storage/db-manager.ts` |
| `DbManager` | class | 7 | 0 | `storage/db-manager.ts` |
| `loadEdgeGroupFallback` | function | 1 | 4 | `storage/graph-loader.ts` |
| `upsertNode` | function | 2 | 3 | `storage/graph-loader.ts` |
| `escCypher` | function | 5 | 0 | `storage/graph-loader.ts` |
| `loadMetadata` | function | 5 | 0 | `storage/metadata.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect close
# Blast radius for entry point
code-intel impact constructor
# Search this area
code-intel search "storage"
```
