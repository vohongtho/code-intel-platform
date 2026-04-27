---
name: storage
description: "Covers the **storage** subsystem of code-intel-platform. 20 symbols across 6 files. Key symbols: `loadRegistry`, `DbManager`, `loadMetadata`. Internal call density: 0.4 calls/symbol. Participates in 4 execution flow(s)."
---

# storage

> **20 symbols** | **6 files** | path: `code-intel/core/src/storage/` | call density: 0.4/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/storage/`
- The user mentions `loadRegistry`, `DbManager`, `loadMetadata` or asks how they work
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

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `loadRegistry` | function | 10 | 0 | `storage/repo-registry.ts` |
| `DbManager` | class | 6 | 0 | `storage/db-manager.ts` |
| `loadMetadata` | function | 4 | 0 | `storage/metadata.ts` |
| `upsertRepo` | function | 2 | 2 | `storage/repo-registry.ts` |
| `removeRepo` | function | 2 | 2 | `storage/repo-registry.ts` |
| `getDbPath` | function | 3 | 0 | `storage/metadata.ts` |
| `getVectorDbPath` | function | 3 | 0 | `storage/metadata.ts` |
| `saveRegistry` | function | 3 | 0 | `storage/repo-registry.ts` |
| `writeNodeCSVs` | function | 1 | 1 | `storage/csv-writer.ts` |
| `writeEdgeCSV` | function | 1 | 1 | `storage/csv-writer.ts` |
| `csvRow` | function | 2 | 0 | `storage/csv-writer.ts` |
| `buildNodeProps` | function | 1 | 1 | `storage/graph-loader.ts` |

## Execution Flows

**4** execution path(s) pass through this area.
Run `code-intel inspect <symbol>` on a hot symbol to trace the full call chain.

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
code-intel impact loadRegistry
# Search this area
code-intel search "storage"
```
