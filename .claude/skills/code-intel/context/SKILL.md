---
name: context
description: "Covers the **context** subsystem of code-intel-platform. 27 symbols across 2 files. Key symbols: `build`. Internal call density: 0.9 calls/symbol."
---

# context

> **27 symbols** | **2 files** | path: `code-intel/core/src/context/` | call density: 0.9/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/context/`
- The user mentions `build` or asks how they work
- Adding, modifying, or debugging context-related functionality
- Tracing call chains that pass through the context layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/context/builder.ts` | `SeedSymbol`, `BuilderOptions`, `ContextDocument`, `BudgetPreset` +(20) | 5 exported |
| `code-intel/core/src/context/token-counter.ts` | `estimateTokens`, `BlockTokens`, `measureBlocks` | 3 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`build`** `(function)` → `code-intel/core/src/context/builder.ts:405`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `buildLogicBlock` | function | 1 | 12 | `context/builder.ts` |
| `buildSummaryBlock` | function | 1 | 9 | `context/builder.ts` |
| `build` | function | 0 | 8 | `context/builder.ts` |
| `buildFocusCodeBlock` | function | 1 | 6 | `context/builder.ts` |
| `buildRelationBlock` | function | 1 | 4 | `context/builder.ts` |
| `measureBlocks` | function | 4 | 1 | `context/token-counter.ts` |
| `detectQueryIntent` | function | 3 | 1 | `context/builder.ts` |
| `estimateTokens` | function | 4 | 0 | `context/token-counter.ts` |
| `last2Segments` | function | 3 | 0 | `context/builder.ts` |
| `getCluster` | function | 1 | 2 | `context/builder.ts` |
| `formatSymbol` | method | 1 | 2 | `context/builder.ts` |
| `meaningfulLines` | function | 2 | 0 | `context/builder.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect buildLogicBlock
# Blast radius for entry point
code-intel impact build
# Search this area
code-intel search "context"
```
