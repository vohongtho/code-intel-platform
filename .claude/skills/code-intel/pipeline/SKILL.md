---
name: pipeline
description: "Covers the **pipeline** subsystem of code-intel-platform. 30 symbols across 6 files. Key symbols: `constructor`, `isWatching`, `lastEventAt`. Internal call density: 0.2 calls/symbol. Participates in 3 execution flow(s)."
---

# pipeline

> **30 symbols** | **6 files** | path: `code-intel/core/src/pipeline/` | call density: 0.2/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/pipeline/`
- The user mentions `constructor`, `isWatching`, `lastEventAt` or asks how they work
- Adding, modifying, or debugging pipeline-related functionality
- Tracing call chains that pass through the pipeline layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/pipeline/file-watcher.ts` | `FileWatcherOptions`, `FileWatcher`, `constructor`, `isWatching` +(5) | 9 exported |
| `code-intel/core/src/pipeline/incremental.ts` | `getCurrentCommitHash`, `getChangedFilesSince`, `filterChangedByMtime`, `buildMtimeSnapshot` +(2) | 6 exported |
| `code-intel/core/src/pipeline/incremental-indexer.ts` | `PatchResult`, `IncrementalIndexer`, `constructor`, `patchGraph` +(1) | 5 exported |
| `code-intel/core/src/pipeline/dag-validator.ts` | `ValidationError`, `validateDAG`, `dfs`, `topologicalSort` | 4 exported |
| `code-intel/core/src/pipeline/orchestrator.ts` | `PipelineRunResult`, `runPipeline`, `runPhase` | 3 exported |
| `code-intel/core/src/pipeline/types.ts` | `PhaseResult`, `PipelineContext`, `Phase` | 3 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`constructor`** `(method)` → `code-intel/core/src/pipeline/file-watcher.ts:43`
- **`isWatching`** `(method)` → `code-intel/core/src/pipeline/file-watcher.ts:49`
- **`lastEventAt`** `(method)` → `code-intel/core/src/pipeline/file-watcher.ts:53`
- **`start`** `(method)` → `code-intel/core/src/pipeline/file-watcher.ts:58`
- **`handle`** `(function)` → `code-intel/core/src/pipeline/file-watcher.ts:70`
- **`stop`** `(method)` → `code-intel/core/src/pipeline/file-watcher.ts:93`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `patchGraph` | method | 2 | 20 | `pipeline/incremental-indexer.ts` |
| `runPipeline` | function | 10 | 7 | `pipeline/orchestrator.ts` |
| `decideIncremental` | function | 2 | 9 | `pipeline/incremental.ts` |
| `dfs` | function | 1 | 4 | `pipeline/dag-validator.ts` |
| `handle` | function | 0 | 5 | `pipeline/file-watcher.ts` |
| `validateDAG` | function | 2 | 2 | `pipeline/dag-validator.ts` |
| `topologicalSort` | function | 2 | 2 | `pipeline/dag-validator.ts` |
| `start` | method | 0 | 4 | `pipeline/file-watcher.ts` |
| `stop` | method | 0 | 3 | `pipeline/file-watcher.ts` |
| `filterChangedByMtime` | function | 2 | 1 | `pipeline/incremental.ts` |
| `buildMtimeSnapshot` | function | 2 | 1 | `pipeline/incremental.ts` |
| `runPhase` | function | 0 | 3 | `pipeline/orchestrator.ts` |

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
code-intel inspect patchGraph
# Blast radius for entry point
code-intel impact constructor
# Search this area
code-intel search "pipeline"
```
