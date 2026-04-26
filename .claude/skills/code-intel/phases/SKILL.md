---
name: phases
description: "Covers the **phases** subsystem of code-intel-platform. 12 symbols across 3 files. Key symbols: `walk`, `loadIgnorePatterns`, `extractSymbol`. Internal call density: 0 calls/symbol."
---

# phases

> **12 symbols** | **3 files** | path: `code-intel/core/src/pipeline/phases/` | call density: 0/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/pipeline/phases/`
- The user mentions `walk`, `loadIgnorePatterns`, `extractSymbol` or asks how they work
- Adding, modifying, or debugging phases-related functionality
- Tracing call chains that pass through the phases layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/pipeline/phases/resolve-phase.ts` | `ParsedImport`, `ParsedCall`, `ParsedHeritage`, `extractImports` +(3) | internal |
| `code-intel/core/src/pipeline/phases/parse-phase.ts` | `ExtractedSymbol`, `extractSymbol`, `extractBlock` | internal |
| `code-intel/core/src/pipeline/phases/scan-phase.ts` | `loadIgnorePatterns`, `walk` | internal |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `walk` | function | 0 | 3 | `phases/scan-phase.ts` |
| `loadIgnorePatterns` | function | 0 | 2 | `phases/scan-phase.ts` |
| `extractSymbol` | function | 1 | 0 | `phases/parse-phase.ts` |
| `extractBlock` | function | 1 | 0 | `phases/parse-phase.ts` |
| `extractImports` | function | 1 | 0 | `phases/resolve-phase.ts` |
| `extractCalls` | function | 1 | 0 | `phases/resolve-phase.ts` |
| `extractHeritage` | function | 1 | 0 | `phases/resolve-phase.ts` |
| `findEnclosingFunction` | function | 1 | 0 | `phases/resolve-phase.ts` |
| `ExtractedSymbol` | interface | 0 | 0 | `phases/parse-phase.ts` |
| `ParsedImport` | interface | 0 | 0 | `phases/resolve-phase.ts` |
| `ParsedCall` | interface | 0 | 0 | `phases/resolve-phase.ts` |
| `ParsedHeritage` | interface | 0 | 0 | `phases/resolve-phase.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect walk
# Blast radius for entry point
code-intel impact walk
# Search this area
code-intel search "phases"
```
