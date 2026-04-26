---
name: pages
description: "Covers the **pages** subsystem of code-intel-platform. 13 symbols across 3 files. Key symbols: `ConnectPage`, `ExplorerPage`, `LoadingPage`. Internal call density: 0.3 calls/symbol."
---

# pages

> **13 symbols** | **3 files** | path: `code-intel/web/src/pages/` | call density: 0.3/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/web/src/pages/`
- The user mentions `ConnectPage`, `ExplorerPage`, `LoadingPage` or asks how they work
- Adding, modifying, or debugging pages-related functionality
- Tracing call chains that pass through the pages layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/web/src/pages/ConnectPage.tsx` | `ConnectPage`, `probeServer`, `loadGroups`, `handleConnectRepo` +(2) | 1 exported |
| `code-intel/web/src/pages/ExplorerPage.tsx` | `ExplorerPage`, `handleKeyDown`, `ExplorerTab`, `pct` +(2) | 1 exported |
| `code-intel/web/src/pages/LoadingPage.tsx` | `LoadingPage` | 1 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`ConnectPage`** `(function)` → `code-intel/web/src/pages/ConnectPage.tsx:8`
- **`ExplorerPage`** `(function)` → `code-intel/web/src/pages/ExplorerPage.tsx:16`
- **`LoadingPage`** `(function)` → `code-intel/web/src/pages/LoadingPage.tsx:3`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `probeServer` | function | 2 | 2 | `pages/ConnectPage.tsx` |
| `handleConnectGroup` | function | 0 | 4 | `pages/ConnectPage.tsx` |
| `loadGroups` | function | 1 | 2 | `pages/ConnectPage.tsx` |
| `ConnectPage` | function | 0 | 2 | `pages/ConnectPage.tsx` |
| `handleConnectRepo` | function | 1 | 1 | `pages/ConnectPage.tsx` |
| `handleSyncFull` | function | 0 | 2 | `pages/ExplorerPage.tsx` |
| `ExplorerPage` | function | 0 | 1 | `pages/ExplorerPage.tsx` |
| `ExplorerTab` | function | 0 | 1 | `pages/ExplorerPage.tsx` |
| `GroupTab` | function | 0 | 1 | `pages/ExplorerPage.tsx` |
| `Spinner` | function | 0 | 0 | `pages/ConnectPage.tsx` |
| `handleKeyDown` | function | 0 | 0 | `pages/ExplorerPage.tsx` |
| `pct` | function | 0 | 0 | `pages/ExplorerPage.tsx` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect probeServer
# Blast radius for entry point
code-intel impact ConnectPage
# Search this area
code-intel search "pages"
```
