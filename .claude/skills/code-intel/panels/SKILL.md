---
name: panels
description: "Covers the **panels** subsystem of code-intel-platform. 30 symbols across 5 files. Key symbols: `NodeDetail`, `SearchBar`, `SidebarChat`. Internal call density: 0.3 calls/symbol."
---

# panels

> **30 symbols** | **5 files** | path: `code-intel/web/src/components/panels/` | call density: 0.3/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/web/src/components/panels/`
- The user mentions `NodeDetail`, `SearchBar`, `SidebarChat` or asks how they work
- Adding, modifying, or debugging panels-related functionality
- Tracing call chains that pass through the panels layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/web/src/components/panels/SidebarChat.tsx` | `SidebarChat`, `send`, `onCitationClick`, `MessageBubble` +(8) | 1 exported |
| `code-intel/web/src/components/panels/SidebarFiles.tsx` | `TreeNode`, `buildTree`, `countLeaves`, `TreeNodeViewProps` +(4) | 1 exported |
| `code-intel/web/src/components/panels/NodeDetail.tsx` | `Props`, `NodeDetail`, `loadImpact`, `jumpTo` +(2) | 1 exported |
| `code-intel/web/src/components/panels/SearchBar.tsx` | `SearchBar`, `handleSearch` | 1 exported |
| `code-intel/web/src/components/panels/SidebarFilters.tsx` | `SidebarFilters`, `Section` | 1 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`NodeDetail`** `(function)` → `code-intel/web/src/components/panels/NodeDetail.tsx:14`
- **`SearchBar`** `(function)` → `code-intel/web/src/components/panels/SearchBar.tsx:5`
- **`SidebarChat`** `(function)` → `code-intel/web/src/components/panels/SidebarChat.tsx:13`
- **`SidebarFiles`** `(function)` → `code-intel/web/src/components/panels/SidebarFiles.tsx:182`
- **`SidebarFilters`** `(function)` → `code-intel/web/src/components/panels/SidebarFilters.tsx:45`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `renderInline` | function | 1 | 4 | `panels/SidebarChat.tsx` |
| `send` | function | 1 | 2 | `panels/SidebarChat.tsx` |
| `NodeDetail` | function | 0 | 2 | `panels/NodeDetail.tsx` |
| `onCitationClick` | function | 1 | 1 | `panels/SidebarChat.tsx` |
| `TreeNodeView` | function | 0 | 2 | `panels/SidebarFiles.tsx` |
| `SidebarFiles` | function | 0 | 2 | `panels/SidebarFiles.tsx` |
| `loadImpact` | function | 0 | 1 | `panels/NodeDetail.tsx` |
| `SearchBar` | function | 0 | 1 | `panels/SearchBar.tsx` |
| `handleSearch` | function | 0 | 1 | `panels/SearchBar.tsx` |
| `SidebarChat` | function | 0 | 1 | `panels/SidebarChat.tsx` |
| `RichText` | function | 0 | 1 | `panels/SidebarChat.tsx` |
| `renderLine` | function | 1 | 0 | `panels/SidebarChat.tsx` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect renderInline
# Blast radius for entry point
code-intel impact NodeDetail
# Search this area
code-intel search "panels"
```
