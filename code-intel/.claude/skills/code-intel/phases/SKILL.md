---
name: phases
description: "Covers the **phases** subsystem of code-intel. 33 symbols across 5 files. Key symbols: `execute`, `execute`, `execute`. Internal call density: 0.7 calls/symbol. Participates in 3 execution flow(s)."
---

# phases

> **33 symbols** | **5 files** | path: `core/src/pipeline/phases/` | call density: 0.7/sym

## When to Use

Load this skill when:
- The task involves code in `core/src/pipeline/phases/`
- The user mentions `execute`, `execute`, `execute` or asks how they work
- Adding, modifying, or debugging phases-related functionality
- Tracing call chains that pass through the phases layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `core/src/pipeline/phases/parse-phase.ts` | `isDefCapture`, `captureKind`, `isExported`, `Param` +(16) | 1 exported |
| `core/src/pipeline/phases/resolve-phase.ts` | `ParsedImport`, `ParsedCall`, `ParsedHeritage`, `execute` +(4) | 1 exported |
| `core/src/pipeline/phases/scan-phase.ts` | `loadIgnorePatterns`, `execute`, `walk` | 2 exported |
| `core/src/pipeline/phases/cluster-phase.ts` | `execute` | 1 exported |
| `core/src/pipeline/phases/flow-phase.ts` | `execute` | 1 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`execute`** `(method)` → `core/src/pipeline/phases/cluster-phase.ts:7`
- **`execute`** `(method)` → `core/src/pipeline/phases/flow-phase.ts:7`
- **`execute`** `(method)` → `core/src/pipeline/phases/parse-phase.ts:460`
- **`execute`** `(method)` → `core/src/pipeline/phases/resolve-phase.ts:37`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `extractFromTree` | function | 1 | 16 | `phases/parse-phase.ts` |
| `execute` | method | 0 | 16 | `phases/parse-phase.ts` |
| `execute` | method | 0 | 16 | `phases/resolve-phase.ts` |
| `execute` | method | 0 | 10 | `phases/cluster-phase.ts` |
| `execute` | method | 0 | 9 | `phases/flow-phase.ts` |
| `extractWithRegex` | function | 1 | 6 | `phases/parse-phase.ts` |
| `isExported` | function | 5 | 0 | `phases/parse-phase.ts` |
| `execute` | method | 1 | 4 | `phases/scan-phase.ts` |
| `extractFromTreeAsync` | function | 1 | 3 | `phases/parse-phase.ts` |
| `extractDoc` | function | 1 | 2 | `phases/parse-phase.ts` |
| `extractCalls` | function | 1 | 2 | `phases/resolve-phase.ts` |
| `extractParams` | function | 1 | 1 | `phases/parse-phase.ts` |

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
code-intel inspect extractFromTree
# Blast radius for entry point
code-intel impact execute
# Search this area
code-intel search "phases"
```
