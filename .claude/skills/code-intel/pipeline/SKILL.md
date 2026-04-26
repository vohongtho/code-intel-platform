---
name: pipeline
description: "Covers the **pipeline** subsystem of code-intel-platform. 10 symbols across 3 files. Key symbols: `runPipeline`, `validateDAG`, `topologicalSort`. Internal call density: 0.2 calls/symbol."
---

# pipeline

> **10 symbols** | **3 files** | path: `code-intel/core/src/pipeline/` | call density: 0.2/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/pipeline/`
- The user mentions `runPipeline`, `validateDAG`, `topologicalSort` or asks how they work
- Adding, modifying, or debugging pipeline-related functionality
- Tracing call chains that pass through the pipeline layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/pipeline/dag-validator.ts` | `ValidationError`, `validateDAG`, `dfs`, `topologicalSort` +(1) | 3 exported |
| `code-intel/core/src/pipeline/types.ts` | `PhaseResult`, `PipelineContext`, `Phase` | 3 exported |
| `code-intel/core/src/pipeline/orchestrator.ts` | `PipelineRunResult`, `runPipeline` | 2 exported |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `runPipeline` | function | 2 | 2 | `pipeline/orchestrator.ts` |
| `validateDAG` | function | 2 | 1 | `pipeline/dag-validator.ts` |
| `topologicalSort` | function | 2 | 0 | `pipeline/dag-validator.ts` |
| `dfs` | function | 0 | 1 | `pipeline/dag-validator.ts` |
| `ValidationError` | interface | 0 | 0 | `pipeline/dag-validator.ts` |
| `newDegree` | function | 0 | 0 | `pipeline/dag-validator.ts` |
| `PipelineRunResult` | interface | 0 | 0 | `pipeline/orchestrator.ts` |
| `PhaseResult` | interface | 0 | 0 | `pipeline/types.ts` |
| `PipelineContext` | interface | 0 | 0 | `pipeline/types.ts` |
| `Phase` | interface | 0 | 0 | `pipeline/types.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect runPipeline
# Blast radius for entry point
code-intel impact runPipeline
# Search this area
code-intel search "pipeline"
```
