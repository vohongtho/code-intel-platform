---
name: pages
description: "Covers the **pages** subsystem of code-intel-platform. 17 symbols across 4 files. Key symbols: `ConnectPage`, `ExplorerPage`, `LoadingPage`. Internal call density: 0.1 calls/symbol. Participates in 8 execution flow(s)."
---

# pages

> **17 symbols** | **4 files** | path: `code-intel/web/src/pages/` | call density: 0.1/sym

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
| `code-intel/web/src/pages/LoginPage.tsx` | `LoginPage`, `handleLogin`, `handleBootstrap`, `Spinner` | 1 exported |
| `code-intel/web/src/pages/LoadingPage.tsx` | `LoadingPage` | 1 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`ConnectPage`** `(function)` → `code-intel/web/src/pages/ConnectPage.tsx:8`
- **`ExplorerPage`** `(function)` → `code-intel/web/src/pages/ExplorerPage.tsx:16`
- **`LoadingPage`** `(function)` → `code-intel/web/src/pages/LoadingPage.tsx:3`
- **`LoginPage`** `(function)` → `code-intel/web/src/pages/LoginPage.tsx:5`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `handleConnectGroup` | function | 1 | 3 | `pages/ConnectPage.tsx` |
| `handleLogin` | function | 1 | 3 | `pages/LoginPage.tsx` |
| `ConnectPage` | function | 0 | 3 | `pages/ConnectPage.tsx` |
| `probeServer` | function | 2 | 1 | `pages/ConnectPage.tsx` |
| `loadGroups` | function | 1 | 2 | `pages/ConnectPage.tsx` |
| `handleConnectRepo` | function | 1 | 2 | `pages/ConnectPage.tsx` |
| `handleSyncFull` | function | 0 | 3 | `pages/ExplorerPage.tsx` |
| `LoginPage` | function | 0 | 3 | `pages/LoginPage.tsx` |
| `ExplorerPage` | function | 0 | 2 | `pages/ExplorerPage.tsx` |
| `ExplorerTab` | function | 0 | 2 | `pages/ExplorerPage.tsx` |
| `handleBootstrap` | function | 0 | 2 | `pages/LoginPage.tsx` |
| `GroupTab` | function | 0 | 1 | `pages/ExplorerPage.tsx` |

## Execution Flows

**8** execution path(s) pass through this area.
Run `code-intel inspect <symbol>` on a hot symbol to trace the full call chain.

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect handleConnectGroup
# Blast radius for entry point
code-intel impact ConnectPage
# Search this area
code-intel search "pages"
```
