---
name: pipeline-2
description: "Covers the **pipeline** subsystem of code-intel. 16 symbols across 5 files. Key symbols: `execute`, `extractWithTreeSitter`, `runOnce`. Internal call density: 0.3 calls/symbol."
---

# pipeline

> **16 symbols** | **5 files** | path: `core/tests/unit/pipeline/` | call density: 0.3/sym

## When to Use

Load this skill when:
- The task involves code in `core/tests/unit/pipeline/`
- The user mentions `execute`, `extractWithTreeSitter`, `runOnce` or asks how they work
- Adding, modifying, or debugging pipeline-related functionality
- Tracing call chains that pass through the pipeline layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `core/tests/unit/pipeline/parser-corpus.test.ts` | `ExpectedSymbol`, `GoldenFile`, `ExtractedSymbol`, `captureKind` +(5) | internal |
| `core/tests/unit/pipeline/orchestrator.test.ts` | `makeContext`, `makePhase`, `execute` | internal |
| `core/tests/unit/pipeline/dag-validator.test.ts` | `makePhase`, `execute` | internal |
| `core/tests/unit/pipeline/phases.test.ts` | `makeContext` | internal |
| `core/tests/unit/pipeline/worker-pool.test.ts` | `runOnce` | internal |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `execute` | method | 12 | 0 | `pipeline/orchestrator.test.ts` |
| `extractWithTreeSitter` | function | 1 | 7 | `pipeline/parser-corpus.test.ts` |
| `runOnce` | function | 1 | 3 | `pipeline/worker-pool.test.ts` |
| `extractWithRegex` | function | 1 | 2 | `pipeline/parser-corpus.test.ts` |
| `extractSymbols` | function | 1 | 2 | `pipeline/parser-corpus.test.ts` |
| `makeContext` | function | 1 | 1 | `pipeline/orchestrator.test.ts` |
| `makeContext` | function | 1 | 1 | `pipeline/phases.test.ts` |
| `makePhase` | function | 1 | 0 | `pipeline/dag-validator.test.ts` |
| `makePhase` | function | 1 | 0 | `pipeline/orchestrator.test.ts` |
| `captureKind` | function | 1 | 0 | `pipeline/parser-corpus.test.ts` |
| `isNodeExported` | function | 1 | 0 | `pipeline/parser-corpus.test.ts` |
| `loadGoldenFiles` | function | 1 | 0 | `pipeline/parser-corpus.test.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect execute
# Blast radius for entry point
code-intel impact execute
# Search this area
code-intel search "pipeline"
```
