---
name: graph
description: "Covers the **graph** subsystem of code-intel-platform. 12 symbols across 1 files. Key symbols: `GraphView`. Internal call density: 0.3 calls/symbol."
---

# graph

> **12 symbols** | **1 files** | path: `code-intel/web/src/components/graph/` | call density: 0.3/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/web/src/components/graph/`
- The user mentions `GraphView` or asks how they work
- Adding, modifying, or debugging graph-related functionality
- Tracing call chains that pass through the graph layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/web/src/components/graph/GraphView.tsx` | `drawDarkNodeHover`, `GraphMeta`, `GraphView`, `angle` +(8) | 1 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`GraphView`** `(function)` → `code-intel/web/src/components/graph/GraphView.tsx:54`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `applyNodeEdgeReducers` | function | 1 | 3 | `graph/GraphView.tsx` |
| `GraphView` | function | 0 | 1 | `graph/GraphView.tsx` |
| `angle` | function | 0 | 1 | `graph/GraphView.tsx` |
| `bfsNeighborhood` | function | 1 | 0 | `graph/GraphView.tsx` |
| `GraphControls` | function | 0 | 1 | `graph/GraphView.tsx` |
| `zoom` | function | 1 | 0 | `graph/GraphView.tsx` |
| `sizeForKind` | function | 1 | 0 | `graph/GraphView.tsx` |
| `drawDarkNodeHover` | function | 0 | 0 | `graph/GraphView.tsx` |
| `GraphMeta` | interface | 0 | 0 | `graph/GraphView.tsx` |
| `onZoom` | function | 0 | 0 | `graph/GraphView.tsx` |
| `factor` | function | 0 | 0 | `graph/GraphView.tsx` |
| `GraphLegend` | function | 0 | 0 | `graph/GraphView.tsx` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect applyNodeEdgeReducers
# Blast radius for entry point
code-intel impact GraphView
# Search this area
code-intel search "graph"
```
