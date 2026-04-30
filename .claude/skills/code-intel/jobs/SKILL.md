---
name: jobs
description: "Covers the **jobs** subsystem of code-intel-platform. 18 symbols across 1 files. Key symbols: `constructor`, `close`. Internal call density: 0.6 calls/symbol."
---

# jobs

> **18 symbols** | **1 files** | path: `code-intel/core/src/jobs/` | call density: 0.6/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/jobs/`
- The user mentions `constructor`, `close` or asks how they work
- Adding, modifying, or debugging jobs-related functionality
- Tracing call chains that pass through the jobs layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/jobs/jobs-db.ts` | `Job`, `JobsDB`, `constructor`, `createTables` +(14) | 18 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`constructor`** `(method)` → `code-intel/core/src/jobs/jobs-db.ts:41`
- **`close`** `(method)` → `code-intel/core/src/jobs/jobs-db.ts:195`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `submit` | method | 1 | 5 | `jobs/jobs-db.ts` |
| `getJob` | method | 4 | 2 | `jobs/jobs-db.ts` |
| `_mapRow` | method | 5 | 0 | `jobs/jobs-db.ts` |
| `listJobs` | method | 2 | 2 | `jobs/jobs-db.ts` |
| `markFailed` | method | 1 | 3 | `jobs/jobs-db.ts` |
| `detectStuckJobs` | method | 1 | 3 | `jobs/jobs-db.ts` |
| `cancel` | method | 2 | 1 | `jobs/jobs-db.ts` |
| `getPendingRetries` | method | 1 | 2 | `jobs/jobs-db.ts` |
| `recoverStuckJobs` | method | 1 | 2 | `jobs/jobs-db.ts` |
| `getOrCreateJobsDB` | function | 1 | 2 | `jobs/jobs-db.ts` |
| `JobsDB` | class | 2 | 0 | `jobs/jobs-db.ts` |
| `constructor` | method | 0 | 2 | `jobs/jobs-db.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect submit
# Blast radius for entry point
code-intel impact constructor
# Search this area
code-intel search "jobs"
```
