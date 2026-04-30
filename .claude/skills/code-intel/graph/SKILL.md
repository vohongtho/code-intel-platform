---
name: graph
description: "Covers the **graph** subsystem of code-intel-platform. 19 symbols across 2 files. Key symbols: `size`. Internal call density: 0.2 calls/symbol."
---

# graph

> **19 symbols** | **2 files** | path: `code-intel/core/src/graph/` | call density: 0.2/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/graph/`
- The user mentions `size` or asks how they work
- Adding, modifying, or debugging graph-related functionality
- Tracing call chains that pass through the graph layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/graph/knowledge-graph.ts` | `KnowledgeGraph`, `createKnowledgeGraph`, `indexEdge`, `unindexEdge` +(13) | 17 exported |
| `code-intel/core/src/graph/id-generator.ts` | `generateNodeId`, `generateEdgeId` | 2 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`size`** `(method)` → `code-intel/core/src/graph/knowledge-graph.ts:142`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `createKnowledgeGraph` | function | 42 | 0 | `graph/knowledge-graph.ts` |
| `addNode` | method | 34 | 1 | `graph/knowledge-graph.ts` |
| `getNode` | method | 31 | 1 | `graph/knowledge-graph.ts` |
| `addEdge` | method | 24 | 2 | `graph/knowledge-graph.ts` |
| `findEdgesFrom` | method | 16 | 1 | `graph/knowledge-graph.ts` |
| `findEdgesTo` | method | 15 | 1 | `graph/knowledge-graph.ts` |
| `generateEdgeId` | function | 14 | 0 | `graph/id-generator.ts` |
| `generateNodeId` | function | 13 | 0 | `graph/id-generator.ts` |
| `findEdgesByKind` | method | 11 | 1 | `graph/knowledge-graph.ts` |
| `allEdges` | method | 7 | 1 | `graph/knowledge-graph.ts` |
| `removeNodeCascade` | method | 3 | 3 | `graph/knowledge-graph.ts` |
| `getEdge` | method | 4 | 1 | `graph/knowledge-graph.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect createKnowledgeGraph
# Blast radius for entry point
code-intel impact size
# Search this area
code-intel search "graph"
```
