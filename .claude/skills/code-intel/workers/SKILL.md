---
name: workers
description: "Covers the **workers** subsystem of code-intel-platform. 34 symbols across 5 files. Key symbols: `execute`, `execute`, `constructor`. Internal call density: 0.3 calls/symbol. Participates in 7 execution flow(s)."
---

# workers

> **34 symbols** | **5 files** | path: `code-intel/core/src/pipeline/workers/` | call density: 0.3/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/pipeline/workers/`
- The user mentions `execute`, `execute`, `constructor` or asks how they work
- Adding, modifying, or debugging workers-related functionality
- Tracing call chains that pass through the workers layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/pipeline/workers/worker-pool.ts` | `WorkerPoolOptions`, `PendingTask`, `ActiveWorker`, `WorkerPool` +(9) | 11 exported |
| `code-intel/core/src/pipeline/workers/resolve-worker.ts` | `ResolveSnapshot`, `ResolveTask`, `ResolveResult`, `ParsedImport` +(6) | 3 exported |
| `code-intel/core/src/pipeline/workers/parse-worker.ts` | `ParseTask`, `ParseResult`, `captureKind`, `isDefCapture` +(2) | 2 exported |
| `code-intel/core/src/pipeline/workers/resolve-phase-parallel.ts` | `workerScriptPath`, `execute`, `runTask` | 2 exported |
| `code-intel/core/src/pipeline/workers/parse-phase-parallel.ts` | `workerScriptPath`, `execute` | 1 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`execute`** `(method)` → `code-intel/core/src/pipeline/workers/parse-phase-parallel.ts:51`
- **`execute`** `(method)` → `code-intel/core/src/pipeline/workers/resolve-phase-parallel.ts:28`
- **`constructor`** `(method)` → `code-intel/core/src/pipeline/workers/worker-pool.ts:43`
- **`init`** `(method)` → `code-intel/core/src/pipeline/workers/worker-pool.ts:52`
- **`queueLength`** `(method)` → `code-intel/core/src/pipeline/workers/worker-pool.ts:141`
- **`size`** `(method)` → `code-intel/core/src/pipeline/workers/worker-pool.ts:142`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `execute` | method | 0 | 19 | `workers/parse-phase-parallel.ts` |
| `execute` | method | 0 | 18 | `workers/resolve-phase-parallel.ts` |
| `extractTreeSitter` | function | 1 | 9 | `workers/parse-worker.ts` |
| `spawnWorker` | method | 1 | 7 | `workers/worker-pool.ts` |
| `extractCalls` | function | 1 | 2 | `workers/resolve-worker.ts` |
| `drainQueue` | method | 2 | 1 | `workers/worker-pool.ts` |
| `runTask` | function | 1 | 1 | `workers/resolve-phase-parallel.ts` |
| `extractImports` | function | 1 | 1 | `workers/resolve-worker.ts` |
| `extractHeritage` | function | 1 | 1 | `workers/resolve-worker.ts` |
| `run` | method | 1 | 1 | `workers/worker-pool.ts` |
| `dequeue` | method | 2 | 0 | `workers/worker-pool.ts` |
| `workerScriptPath` | function | 1 | 0 | `workers/parse-phase-parallel.ts` |

## Execution Flows

**7** execution path(s) pass through this area.
Run `code-intel inspect <symbol>` on a hot symbol to trace the full call chain.

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
code-intel search "workers"
```
