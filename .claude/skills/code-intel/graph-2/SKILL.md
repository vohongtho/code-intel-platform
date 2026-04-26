---
name: graph-2
description: "Covers the **graph** subsystem of code-intel-platform. 6 symbols across 2 files. Key symbols: `generateEdgeId`, `generateNodeId`, `createKnowledgeGraph`. Internal call density: 0.2 calls/symbol."
---

# graph

> **6 symbols** | **2 files** | path: `code-intel/core/src/graph/` | call density: 0.2/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/graph/`
- The user mentions `generateEdgeId`, `generateNodeId`, `createKnowledgeGraph` or asks how they work
- Adding, modifying, or debugging graph-related functionality
- Tracing call chains that pass through the graph layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/graph/knowledge-graph.ts` | `KnowledgeGraph`, `createKnowledgeGraph`, `indexEdge`, `unindexEdge` | 2 exported |
| `code-intel/core/src/graph/id-generator.ts` | `generateNodeId`, `generateEdgeId` | 2 exported |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `generateEdgeId` | function | 10 | 0 | `graph/id-generator.ts` |
| `generateNodeId` | function | 7 | 0 | `graph/id-generator.ts` |
| `createKnowledgeGraph` | function | 4 | 0 | `graph/knowledge-graph.ts` |
| `indexEdge` | function | 1 | 1 | `graph/knowledge-graph.ts` |
| `unindexEdge` | function | 0 | 1 | `graph/knowledge-graph.ts` |
| `KnowledgeGraph` | interface | 0 | 0 | `graph/knowledge-graph.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect generateEdgeId
# Blast radius for entry point
code-intel impact generateEdgeId
# Search this area
code-intel search "graph"
```
