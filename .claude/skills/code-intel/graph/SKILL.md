---
name: graph
description: "Covers the **graph** subsystem of code-intel-platform. 81 symbols across 5 files. Key symbols: `constructor`, `addNode`, `addEdge`. Internal call density: 0.6 calls/symbol. Participates in 4 execution flow(s)."
---

# graph

> **81 symbols** | **5 files** | path: `code-intel/core/src/graph/` | call density: 0.6/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/graph/`
- The user mentions `constructor`, `addNode`, `addEdge` or asks how they work
- Adding, modifying, or debugging graph-related functionality
- Tracing call chains that pass through the graph layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/graph/lazy-knowledge-graph.ts` | `LRUCache`, `constructor`, `get`, `set` +(30) | 23 exported |
| `code-intel/core/src/graph/compact-knowledge-graph.ts` | `CompactKnowledgeGraph`, `constructor`, `addNode`, `addEdge` +(18) | 22 exported |
| `code-intel/core/src/graph/knowledge-graph.ts` | `KnowledgeGraph`, `createKnowledgeGraph`, `indexEdge`, `unindexEdge` +(13) | 17 exported |
| `code-intel/core/src/graph/intern-table.ts` | `InternTable`, `get`, `size`, `clear` +(2) | 6 exported |
| `code-intel/core/src/graph/id-generator.ts` | `generateNodeId`, `generateEdgeId` | 2 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`constructor`** `(method)` → `code-intel/core/src/graph/compact-knowledge-graph.ts:51`
- **`addNode`** `(method)` → `code-intel/core/src/graph/compact-knowledge-graph.ts:57`
- **`addEdge`** `(method)` → `code-intel/core/src/graph/compact-knowledge-graph.ts:64`
- **`getNode`** `(method)` → `code-intel/core/src/graph/compact-knowledge-graph.ts:89`
- **`getEdge`** `(method)` → `code-intel/core/src/graph/compact-knowledge-graph.ts:93`
- **`findEdgesByKind`** `(method)` → `code-intel/core/src/graph/compact-knowledge-graph.ts:97`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `createKnowledgeGraph` | function | 59 | 0 | `graph/knowledge-graph.ts` |
| `getNode` | method | 43 | 1 | `graph/lazy-knowledge-graph.ts` |
| `findEdgesFrom` | method | 23 | 1 | `graph/lazy-knowledge-graph.ts` |
| `findEdgesTo` | method | 23 | 1 | `graph/lazy-knowledge-graph.ts` |
| `generateEdgeId` | function | 14 | 0 | `graph/id-generator.ts` |
| `findEdgesByKind` | method | 13 | 1 | `graph/lazy-knowledge-graph.ts` |
| `generateNodeId` | function | 13 | 0 | `graph/id-generator.ts` |
| `get` | method | 11 | 2 | `graph/lazy-knowledge-graph.ts` |
| `set` | method | 9 | 4 | `graph/lazy-knowledge-graph.ts` |
| `getNodeAsync` | method | 4 | 5 | `graph/lazy-knowledge-graph.ts` |
| `getNodePage` | method | 3 | 6 | `graph/lazy-knowledge-graph.ts` |
| `allEdges` | method | 8 | 1 | `graph/lazy-knowledge-graph.ts` |

## Execution Flows

**4** execution path(s) pass through this area.
Run `code-intel inspect <symbol>` on a hot symbol to trace the full call chain.

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
code-intel impact constructor
# Search this area
code-intel search "graph"
```
