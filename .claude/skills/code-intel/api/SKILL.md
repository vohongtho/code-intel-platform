---
name: api
description: "Covers the **api** subsystem of code-intel-platform. 28 symbols across 1 files. Key symbols: `constructor`, `login`, `logout`. Internal call density: 0.4 calls/symbol. Participates in 1 execution flow(s)."
---

# api

> **28 symbols** | **1 files** | path: `code-intel/web/src/api/` | call density: 0.4/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/web/src/api/`
- The user mentions `constructor`, `login`, `logout` or asks how they work
- Adding, modifying, or debugging api-related functionality
- Tracing call chains that pass through the api layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/web/src/api/client.ts` | `AuthStatus`, `NodeInspectInfo`, `BlastRadiusResult`, `GrepHit` +(24) | 28 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`constructor`** `(method)` → `code-intel/web/src/api/client.ts:35`
- **`login`** `(method)` → `code-intel/web/src/api/client.ts:70`
- **`logout`** `(method)` → `code-intel/web/src/api/client.ts:85`
- **`readFile`** `(method)` → `code-intel/web/src/api/client.ts:147`
- **`grep`** `(method)` → `code-intel/web/src/api/client.ts:181`
- **`listFlows`** `(method)` → `code-intel/web/src/api/client.ts:193`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `ApiClient` | class | 16 | 0 | `api/client.ts` |
| `getCsrfToken` | method | 10 | 1 | `api/client.ts` |
| `search` | method | 6 | 2 | `api/client.ts` |
| `listGroups` | method | 6 | 1 | `api/client.ts` |
| `syncGroup` | method | 4 | 2 | `api/client.ts` |
| `vectorSearch` | method | 2 | 2 | `api/client.ts` |
| `vectorStatus` | method | 3 | 1 | `api/client.ts` |
| `blastRadius` | method | 2 | 2 | `api/client.ts` |
| `bootstrap` | method | 1 | 2 | `api/client.ts` |
| `inspectNode` | method | 2 | 1 | `api/client.ts` |
| `getGroup` | method | 2 | 1 | `api/client.ts` |
| `bootstrapStatus` | method | 1 | 1 | `api/client.ts` |

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
code-intel inspect ApiClient
# Blast radius for entry point
code-intel impact constructor
# Search this area
code-intel search "api"
```
