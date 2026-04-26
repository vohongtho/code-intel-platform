---
name: skill
description: "Covers the **.** subsystem of simple-ts. 5 symbols across 1 files. Key symbols: `Calculator`, `formatResult`. Internal call density: 0.6 calls/symbol. Participates in 2 execution flow(s)."
---

# .

> **5 symbols** | **1 files** | path: `./` | call density: 0.6/sym

## When to Use

Load this skill when:
- The task involves code in `./`
- The user mentions `Calculator`, `formatResult` or asks how they work
- Adding, modifying, or debugging .-related functionality
- Tracing call chains that pass through the . layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `math.ts` | `add`, `multiply`, `internalHelper`, `Calculator` +(1) | 4 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`Calculator`** `(class)` → `math.ts:14`
- **`formatResult`** `(function)` → `math.ts:35`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `internalHelper` | function | 1 | 2 | `math.ts` |
| `add` | function | 1 | 0 | `math.ts` |
| `multiply` | function | 1 | 0 | `math.ts` |
| `formatResult` | function | 0 | 1 | `math.ts` |
| `Calculator` | class | 0 | 0 | `math.ts` |

## Execution Flows

**2** execution path(s) pass through this area.
Run `code-intel inspect <symbol>` on a hot symbol to trace the full call chain.

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect internalHelper
# Blast radius for entry point
code-intel impact Calculator
# Search this area
code-intel search "."
```
