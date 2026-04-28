---
name: multi-repo
description: "Covers the **multi-repo** subsystem of code-intel-platform. 30 symbols across 8 files. Key symbols: `mergeSearchResults`, `listGroups`, `deleteGroup`. Internal call density: 0.5 calls/symbol. Participates in 1 execution flow(s)."
---

# multi-repo

> **30 symbols** | **8 files** | path: `code-intel/core/src/multi-repo/` | call density: 0.5/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/multi-repo/`
- The user mentions `mergeSearchResults`, `listGroups`, `deleteGroup` or asks how they work
- Adding, modifying, or debugging multi-repo-related functionality
- Tracing call chains that pass through the multi-repo layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/multi-repo/group-registry.ts` | `groupFile`, `loadGroup`, `saveGroup`, `listGroups` +(6) | 9 exported |
| `code-intel/core/src/multi-repo/types.ts` | `GroupMember`, `RepoGroup`, `Contract`, `ContractLink` +(1) | 5 exported |
| `code-intel/core/src/multi-repo/group-manager.ts` | `listGroups`, `getGroup`, `createGroup`, `deleteGroup` | 4 exported |
| `code-intel/core/src/multi-repo/group-config.ts` | `RepoGroup`, `loadGroupConfig`, `saveGroupConfig` | 3 exported |
| `code-intel/core/src/multi-repo/group-sync.ts` | `extractContracts`, `matchContracts`, `syncGroup` | 1 exported |
| `code-intel/core/src/multi-repo/graph-from-db.ts` | `parseRow`, `loadGraphFromDB` | 1 exported |
| `code-intel/core/src/multi-repo/group-query.ts` | `GroupQueryResult`, `queryGroup` | 2 exported |
| `code-intel/core/src/multi-repo/cross-repo-search.ts` | `mergeSearchResults` | 1 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`mergeSearchResults`** `(function)` → `code-intel/core/src/multi-repo/cross-repo-search.ts:4`
- **`listGroups`** `(function)` → `code-intel/core/src/multi-repo/group-manager.ts:8`
- **`deleteGroup`** `(function)` → `code-intel/core/src/multi-repo/group-manager.ts:35`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `syncGroup` | function | 5 | 6 | `multi-repo/group-sync.ts` |
| `loadGraphFromDB` | function | 6 | 1 | `multi-repo/graph-from-db.ts` |
| `loadGroup` | function | 6 | 1 | `multi-repo/group-registry.ts` |
| `saveGroup` | function | 6 | 1 | `multi-repo/group-registry.ts` |
| `listGroups` | function | 7 | 0 | `multi-repo/group-registry.ts` |
| `getGroup` | function | 3 | 1 | `multi-repo/group-manager.ts` |
| `groupFile` | function | 4 | 0 | `multi-repo/group-registry.ts` |
| `addMember` | function | 2 | 2 | `multi-repo/group-registry.ts` |
| `removeMember` | function | 2 | 2 | `multi-repo/group-registry.ts` |
| `saveSyncResult` | function | 4 | 0 | `multi-repo/group-registry.ts` |
| `loadSyncResult` | function | 4 | 0 | `multi-repo/group-registry.ts` |
| `loadGroupConfig` | function | 3 | 0 | `multi-repo/group-config.ts` |

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
code-intel inspect syncGroup
# Blast radius for entry point
code-intel impact mergeSearchResults
# Search this area
code-intel search "multi-repo"
```
