---
name: flow-detection
description: "Covers the **flow-detection** subsystem of code-intel-platform. 6 symbols across 1 files. Key symbols: `findEntryPoints`, `traceFlow`. Internal call density: 0.2 calls/symbol."
---

# flow-detection

> **6 symbols** | **1 files** | path: `code-intel/core/src/flow-detection/` | call density: 0.2/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/flow-detection/`
- The user mentions `findEntryPoints`, `traceFlow` or asks how they work
- Adding, modifying, or debugging flow-detection-related functionality
- Tracing call chains that pass through the flow-detection layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/flow-detection/entry-point-finder.ts` | `EntryPoint`, `findEntryPoints`, `FlowTrace`, `traceFlow` +(2) | 4 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`findEntryPoints`** `(function)` → `code-intel/core/src/flow-detection/entry-point-finder.ts:10`
- **`traceFlow`** `(function)` → `code-intel/core/src/flow-detection/entry-point-finder.ts:49`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `bfs` | function | 0 | 2 | `flow-detection/entry-point-finder.ts` |
| `deduplicateFlows` | function | 1 | 1 | `flow-detection/entry-point-finder.ts` |
| `findEntryPoints` | function | 0 | 1 | `flow-detection/entry-point-finder.ts` |
| `EntryPoint` | interface | 0 | 0 | `flow-detection/entry-point-finder.ts` |
| `FlowTrace` | interface | 0 | 0 | `flow-detection/entry-point-finder.ts` |
| `traceFlow` | function | 0 | 0 | `flow-detection/entry-point-finder.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect bfs
# Blast radius for entry point
code-intel impact findEntryPoints
# Search this area
code-intel search "flow-detection"
```
