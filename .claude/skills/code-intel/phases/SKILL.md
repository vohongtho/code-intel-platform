---
name: phases
description: "Covers the **phases** subsystem of code-intel-platform. 38 symbols across 6 files. Key symbols: `execute`, `execute`, `execute`. Internal call density: 0.7 calls/symbol. Participates in 8 execution flow(s)."
---

# phases

> **38 symbols** | **6 files** | path: `code-intel/core/src/pipeline/phases/` | call density: 0.7/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/pipeline/phases/`
- The user mentions `execute`, `execute`, `execute` or asks how they work
- Adding, modifying, or debugging phases-related functionality
- Tracing call chains that pass through the phases layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/pipeline/phases/parse-phase.ts` | `isDefCapture`, `captureKind`, `isExported`, `Param` +(16) | 1 exported |
| `code-intel/core/src/pipeline/phases/resolve-phase.ts` | `ParsedImport`, `ParsedCall`, `ParsedHeritage`, `execute` +(4) | 1 exported |
| `code-intel/core/src/pipeline/phases/summarize-phase.ts` | `buildPrompt`, `codeHash`, `trimSnippet`, `createSummarizePhase` +(1) | 2 exported |
| `code-intel/core/src/pipeline/phases/scan-phase.ts` | `loadIgnorePatterns`, `execute`, `walk` | 2 exported |
| `code-intel/core/src/pipeline/phases/cluster-phase.ts` | `execute` | 1 exported |
| `code-intel/core/src/pipeline/phases/flow-phase.ts` | `execute` | 1 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`execute`** `(method)` → `code-intel/core/src/pipeline/phases/cluster-phase.ts:7`
- **`execute`** `(method)` → `code-intel/core/src/pipeline/phases/flow-phase.ts:7`
- **`execute`** `(method)` → `code-intel/core/src/pipeline/phases/parse-phase.ts:460`
- **`execute`** `(method)` → `code-intel/core/src/pipeline/phases/resolve-phase.ts:37`
- **`execute`** `(method)` → `code-intel/core/src/pipeline/phases/summarize-phase.ts:40`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `extractFromTree` | function | 1 | 19 | `phases/parse-phase.ts` |
| `execute` | method | 0 | 16 | `phases/parse-phase.ts` |
| `execute` | method | 0 | 16 | `phases/resolve-phase.ts` |
| `execute` | method | 0 | 16 | `phases/summarize-phase.ts` |
| `execute` | method | 0 | 10 | `phases/cluster-phase.ts` |
| `execute` | method | 0 | 10 | `phases/flow-phase.ts` |
| `extractWithRegex` | function | 1 | 7 | `phases/parse-phase.ts` |
| `isExported` | function | 5 | 0 | `phases/parse-phase.ts` |
| `execute` | method | 1 | 4 | `phases/scan-phase.ts` |
| `extractFromTreeAsync` | function | 1 | 3 | `phases/parse-phase.ts` |
| `createSummarizePhase` | function | 4 | 0 | `phases/summarize-phase.ts` |
| `extractParams` | function | 1 | 2 | `phases/parse-phase.ts` |

## Execution Flows

**8** execution path(s) pass through this area.
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
