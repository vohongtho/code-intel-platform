---
name: phases
description: "Covers the **phases** subsystem of code-intel-platform. 16 symbols across 3 files. Key symbols: `loadIgnorePatterns`, `extractSymbol`, `estimateEndLine`. Internal call density: 0 calls/symbol."
---

# phases

> **16 symbols** | **3 files** | path: `code-intel/core/src/pipeline/phases/` | call density: 0/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/pipeline/phases/`
- The user mentions `loadIgnorePatterns`, `extractSymbol`, `estimateEndLine` or asks how they work
- Adding, modifying, or debugging phases-related functionality
- Tracing call chains that pass through the phases layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/pipeline/phases/resolve-phase.ts` | `ParsedImport`, `ParsedCall`, `ParsedHeritage`, `extractImports` +(4) | internal |
| `code-intel/core/src/pipeline/phases/parse-phase.ts` | `ExtractedSymbol`, `extractSymbol`, `estimateEndLine`, `startIndent` +(2) | internal |
| `code-intel/core/src/pipeline/phases/scan-phase.ts` | `loadIgnorePatterns`, `walk` | internal |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `loadIgnorePatterns` | function | 1 | 1 | `phases/scan-phase.ts` |
| `extractSymbol` | function | 1 | 0 | `phases/parse-phase.ts` |
| `estimateEndLine` | function | 1 | 0 | `phases/parse-phase.ts` |
| `extractBlock` | function | 1 | 0 | `phases/parse-phase.ts` |
| `extractImports` | function | 1 | 0 | `phases/resolve-phase.ts` |
| `extractCalls` | function | 1 | 0 | `phases/resolve-phase.ts` |
| `extractHeritage` | function | 1 | 0 | `phases/resolve-phase.ts` |
| `findEnclosingFunctionFast` | function | 1 | 0 | `phases/resolve-phase.ts` |
| `walk` | function | 1 | 0 | `phases/scan-phase.ts` |
| `ExtractedSymbol` | interface | 0 | 0 | `phases/parse-phase.ts` |
| `startIndent` | function | 0 | 0 | `phases/parse-phase.ts` |
| `indent` | function | 0 | 0 | `phases/parse-phase.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect loadIgnorePatterns
# Blast radius for entry point
code-intel impact loadIgnorePatterns
# Search this area
code-intel search "phases"
```
