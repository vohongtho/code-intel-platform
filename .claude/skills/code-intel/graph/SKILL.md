---
name: graph
description: "Covers the **graph** subsystem of code-intel-platform. 19 symbols across 2 files. Key symbols: `size`. Internal call density: 0.2 calls/symbol. Participates in 3 execution flow(s)."
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
| `allNodes` | method | 26 | 1 | `graph/knowledge-graph.ts` |
| `createKnowledgeGraph` | function | 26 | 0 | `graph/knowledge-graph.ts` |
| `addNode` | method | 18 | 1 | `graph/knowledge-graph.ts` |
| `addEdge` | method | 15 | 2 | `graph/knowledge-graph.ts` |
| `getNode` | method | 14 | 1 | `graph/knowledge-graph.ts` |
| `generateEdgeId` | function | 14 | 0 | `graph/id-generator.ts` |
| `generateNodeId` | function | 13 | 0 | `graph/id-generator.ts` |
| `findEdgesByKind` | method | 8 | 1 | `graph/knowledge-graph.ts` |
| `findEdgesFrom` | method | 8 | 1 | `graph/knowledge-graph.ts` |
| `allEdges` | method | 7 | 1 | `graph/knowledge-graph.ts` |
| `findEdgesTo` | method | 5 | 1 | `graph/knowledge-graph.ts` |
| `removeNodeCascade` | method | 2 | 3 | `graph/knowledge-graph.ts` |

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
code-intel inspect allNodes
# Blast radius for entry point
code-intel impact size
# Search this area
code-intel search "graph"
```
