---
name: pipeline-2
description: "Covers the **pipeline** subsystem of code-intel-platform. 26 symbols across 9 files. Key symbols: `execute`, `extractWithTreeSitter`, `rawReq`. Internal call density: 0.2 calls/symbol."
---

# pipeline

> **26 symbols** | **9 files** | path: `code-intel/core/tests/unit/pipeline/` | call density: 0.2/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/tests/unit/pipeline/`
- The user mentions `execute`, `extractWithTreeSitter`, `rawReq` or asks how they work
- Adding, modifying, or debugging pipeline-related functionality
- Tracing call chains that pass through the pipeline layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/tests/unit/pipeline/parser-corpus.test.ts` | `ExpectedSymbol`, `GoldenFile`, `ExtractedSymbol`, `captureKind` +(5) | internal |
| `code-intel/core/tests/unit/pipeline/graceful-degradation.test.ts` | `rawReq`, `summarize`, `execute` | internal |
| `code-intel/core/tests/unit/pipeline/orchestrator.test.ts` | `makeContext`, `makePhase`, `execute` | internal |
| `code-intel/core/tests/unit/pipeline/profile.test.ts` | `makeContext`, `makePhase`, `execute` | internal |
| `code-intel/core/tests/unit/pipeline/summarize-phase.test.ts` | `makeContext`, `makeFakeProvider`, `runPhaseWithProvider` | internal |
| `code-intel/core/tests/unit/pipeline/dag-validator.test.ts` | `makePhase`, `execute` | internal |
| `code-intel/core/tests/unit/pipeline/incremental-indexer.test.ts` | `makeGraph` | internal |
| `code-intel/core/tests/unit/pipeline/phases.test.ts` | `makeContext` | internal |
| `code-intel/core/tests/unit/pipeline/worker-pool.test.ts` | `runOnce` | internal |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `execute` | method | 12 | 0 | `pipeline/profile.test.ts` |
| `extractWithTreeSitter` | function | 1 | 9 | `pipeline/parser-corpus.test.ts` |
| `rawReq` | function | 1 | 4 | `pipeline/graceful-degradation.test.ts` |
| `extractWithRegex` | function | 1 | 3 | `pipeline/parser-corpus.test.ts` |
| `runOnce` | function | 1 | 3 | `pipeline/worker-pool.test.ts` |
| `extractSymbols` | function | 1 | 2 | `pipeline/parser-corpus.test.ts` |
| `runPhaseWithProvider` | function | 1 | 2 | `pipeline/summarize-phase.test.ts` |
| `makeGraph` | function | 1 | 1 | `pipeline/incremental-indexer.test.ts` |
| `makeContext` | function | 1 | 1 | `pipeline/orchestrator.test.ts` |
| `loadGoldenFiles` | function | 1 | 1 | `pipeline/parser-corpus.test.ts` |
| `makeContext` | function | 1 | 1 | `pipeline/phases.test.ts` |
| `makeContext` | function | 1 | 1 | `pipeline/profile.test.ts` |

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
