---
name: multi-repo
description: "Covers the **multi-repo** subsystem of code-intel-platform. 41 symbols across 10 files. Key symbols: `mergeSearchResults`, `listGroups`, `getGroup`. Internal call density: 0.6 calls/symbol."
---

# multi-repo

> **41 symbols** | **10 files** | path: `code-intel/core/src/multi-repo/` | call density: 0.6/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/multi-repo/`
- The user mentions `mergeSearchResults`, `listGroups`, `getGroup` or asks how they work
- Adding, modifying, or debugging multi-repo-related functionality
- Tracing call chains that pass through the multi-repo layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/multi-repo/group-registry.ts` | `groupFile`, `loadGroup`, `saveGroup`, `listGroups` +(6) | 9 exported |
| `code-intel/core/src/multi-repo/workspace-detector.ts` | `WorkspacePackage`, `WorkspaceInfo`, `expandGlob`, `resolvePackages` +(2) | 4 exported |
| `code-intel/core/src/multi-repo/type-similarity.ts` | `normalizeType`, `paramTypeSimilarity`, `returnTypeSimilarity`, `paramCountSimilarity` +(1) | 4 exported |
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
- **`getGroup`** `(function)` → `code-intel/core/src/multi-repo/group-manager.ts:21`
- **`deleteGroup`** `(function)` → `code-intel/core/src/multi-repo/group-manager.ts:35`
- **`listGroups`** `(function)` → `code-intel/core/src/multi-repo/group-registry.ts:29`
- **`syncGroup`** `(function)` → `code-intel/core/src/multi-repo/group-sync.ts:171`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `syncGroup` | function | 0 | 15 | `multi-repo/group-sync.ts` |
| `queryGroup` | function | 3 | 9 | `multi-repo/group-query.ts` |
| `loadGraphFromDB` | function | 6 | 4 | `multi-repo/graph-from-db.ts` |
| `loadGroup` | function | 6 | 2 | `multi-repo/group-registry.ts` |
| `matchContracts` | function | 1 | 7 | `multi-repo/group-sync.ts` |
| `saveGroup` | function | 6 | 1 | `multi-repo/group-registry.ts` |
| `computeContractSimilarity` | function | 2 | 4 | `multi-repo/type-similarity.ts` |
| `loadSyncResult` | function | 4 | 1 | `multi-repo/group-registry.ts` |
| `detectWorkspace` | function | 2 | 3 | `multi-repo/workspace-detector.ts` |
| `groupFile` | function | 4 | 0 | `multi-repo/group-registry.ts` |
| `addMember` | function | 2 | 2 | `multi-repo/group-registry.ts` |
| `removeMember` | function | 2 | 2 | `multi-repo/group-registry.ts` |

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
