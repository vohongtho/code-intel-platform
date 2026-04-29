---
name: pipeline
description: "Covers the **pipeline** subsystem of code-intel. 16 symbols across 4 files. Key symbols: `runPhase`. Internal call density: 0.3 calls/symbol. Participates in 1 execution flow(s)."
---

# pipeline

> **16 symbols** | **4 files** | path: `core/src/pipeline/` | call density: 0.3/sym

## When to Use

Load this skill when:
- The task involves code in `core/src/pipeline/`
- The user mentions `runPhase` or asks how they work
- Adding, modifying, or debugging pipeline-related functionality
- Tracing call chains that pass through the pipeline layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `core/src/pipeline/incremental.ts` | `getCurrentCommitHash`, `getChangedFilesSince`, `filterChangedByMtime`, `buildMtimeSnapshot` +(2) | 6 exported |
| `core/src/pipeline/dag-validator.ts` | `ValidationError`, `validateDAG`, `dfs`, `topologicalSort` | 4 exported |
| `core/src/pipeline/orchestrator.ts` | `PipelineRunResult`, `runPipeline`, `runPhase` | 3 exported |
| `core/src/pipeline/types.ts` | `PhaseResult`, `PipelineContext`, `Phase` | 3 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`runPhase`** `(function)` → `core/src/pipeline/orchestrator.ts:30`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `decideIncremental` | function | 2 | 9 | `pipeline/incremental.ts` |
| `runPipeline` | function | 4 | 7 | `pipeline/orchestrator.ts` |
| `topologicalSort` | function | 2 | 2 | `pipeline/dag-validator.ts` |
| `validateDAG` | function | 2 | 1 | `pipeline/dag-validator.ts` |
| `dfs` | function | 1 | 2 | `pipeline/dag-validator.ts` |
| `filterChangedByMtime` | function | 2 | 1 | `pipeline/incremental.ts` |
| `buildMtimeSnapshot` | function | 2 | 1 | `pipeline/incremental.ts` |
| `runPhase` | function | 0 | 3 | `pipeline/orchestrator.ts` |
| `getCurrentCommitHash` | function | 2 | 0 | `pipeline/incremental.ts` |
| `getChangedFilesSince` | function | 2 | 0 | `pipeline/incremental.ts` |
| `ValidationError` | interface | 0 | 0 | `pipeline/dag-validator.ts` |
| `IncrementalDecision` | interface | 0 | 0 | `pipeline/incremental.ts` |

## Execution Flows

**1** execution path(s) pass through this area.
Run `code-intel inspect <symbol>` on a hot symbol to trace the full call chain.

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect decideIncremental
# Blast radius for entry point
code-intel impact runPhase
# Search this area
code-intel search "pipeline"
```
