---
name: panels
description: "Covers the **panels** subsystem of code-intel. 13 symbols across 4 files. Key symbols: `SearchBar`, `handleSearch`. Internal call density: 0 calls/symbol. Participates in 3 execution flow(s)."
---

# panels

> **13 symbols** | **4 files** | path: `web/src/components/panels/` | call density: 0/sym

## When to Use

Load this skill when:
- The task involves code in `web/src/components/panels/`
- The user mentions `SearchBar`, `handleSearch` or asks how they work
- Adding, modifying, or debugging panels-related functionality
- Tracing call chains that pass through the panels layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `web/src/components/panels/SidebarFiles.tsx` | `TreeNode`, `buildTree`, `countLeaves`, `TreeNodeViewProps` +(1) | internal |
| `web/src/components/panels/NodeDetail.tsx` | `Props`, `loadImpact`, `jumpTo` | internal |
| `web/src/components/panels/SidebarChat.tsx` | `send`, `onCitationClick`, `shortPath` | internal |
| `web/src/components/panels/SearchBar.tsx` | `SearchBar`, `handleSearch` | 2 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`SearchBar`** `(function)` → `web/src/components/panels/SearchBar.tsx:5`
- **`handleSearch`** `(function)` → `web/src/components/panels/SearchBar.tsx:10`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `handleSearch` | function | 0 | 4 | `panels/SearchBar.tsx` |
| `send` | function | 0 | 4 | `panels/SidebarChat.tsx` |
| `buildTree` | function | 1 | 3 | `panels/SidebarFiles.tsx` |
| `loadImpact` | function | 0 | 2 | `panels/NodeDetail.tsx` |
| `countLeaves` | function | 1 | 1 | `panels/SidebarFiles.tsx` |
| `jumpTo` | function | 0 | 1 | `panels/NodeDetail.tsx` |
| `SearchBar` | function | 0 | 1 | `panels/SearchBar.tsx` |
| `onCitationClick` | function | 0 | 1 | `panels/SidebarChat.tsx` |
| `onFileClick` | function | 0 | 1 | `panels/SidebarFiles.tsx` |
| `Props` | interface | 0 | 0 | `panels/NodeDetail.tsx` |
| `shortPath` | method | 0 | 0 | `panels/SidebarChat.tsx` |
| `TreeNode` | interface | 0 | 0 | `panels/SidebarFiles.tsx` |

## Execution Flows

**3** execution path(s) pass through this area.
Run `code-intel inspect <symbol>` on a hot symbol to trace the full call chain.

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect handleSearch
# Blast radius for entry point
code-intel impact SearchBar
# Search this area
code-intel search "panels"
```
