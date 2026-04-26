---
name: multi-repo
description: "Covers the **multi-repo** subsystem of code-intel-platform. 8 symbols across 3 files. Key symbols: `mergeSearchResults`, `listGroups`, `getGroup`. Internal call density: 0.4 calls/symbol."
---

# multi-repo

> **8 symbols** | **3 files** | path: `code-intel/core/src/multi-repo/` | call density: 0.4/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/multi-repo/`
- The user mentions `mergeSearchResults`, `listGroups`, `getGroup` or asks how they work
- Adding, modifying, or debugging multi-repo-related functionality
- Tracing call chains that pass through the multi-repo layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/multi-repo/group-manager.ts` | `listGroups`, `getGroup`, `createGroup`, `deleteGroup` | 4 exported |
| `code-intel/core/src/multi-repo/group-config.ts` | `RepoGroup`, `loadGroupConfig`, `saveGroupConfig` | 3 exported |
| `code-intel/core/src/multi-repo/cross-repo-search.ts` | `mergeSearchResults` | 1 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`mergeSearchResults`** `(function)` → `code-intel/core/src/multi-repo/cross-repo-search.ts:4`
- **`listGroups`** `(function)` → `code-intel/core/src/multi-repo/group-manager.ts:8`
- **`getGroup`** `(function)` → `code-intel/core/src/multi-repo/group-manager.ts:21`
- **`createGroup`** `(function)` → `code-intel/core/src/multi-repo/group-manager.ts:30`
- **`deleteGroup`** `(function)` → `code-intel/core/src/multi-repo/group-manager.ts:35`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `loadGroupConfig` | function | 2 | 0 | `multi-repo/group-config.ts` |
| `mergeSearchResults` | function | 0 | 1 | `multi-repo/cross-repo-search.ts` |
| `saveGroupConfig` | function | 1 | 0 | `multi-repo/group-config.ts` |
| `listGroups` | function | 0 | 1 | `multi-repo/group-manager.ts` |
| `getGroup` | function | 0 | 1 | `multi-repo/group-manager.ts` |
| `createGroup` | function | 0 | 1 | `multi-repo/group-manager.ts` |
| `RepoGroup` | interface | 0 | 0 | `multi-repo/group-config.ts` |
| `deleteGroup` | function | 0 | 0 | `multi-repo/group-manager.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect loadGroupConfig
# Blast radius for entry point
code-intel impact mergeSearchResults
# Search this area
code-intel search "multi-repo"
```
