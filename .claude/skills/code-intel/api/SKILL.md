---
name: api
description: "Covers the **api** subsystem of code-intel-platform. 39 symbols across 1 files. Key symbols: `constructor`, `login`, `logout`. Internal call density: 0.4 calls/symbol. Participates in 1 execution flow(s)."
---

# api

> **39 symbols** | **1 files** | path: `code-intel/web/src/api/` | call density: 0.4/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/web/src/api/`
- The user mentions `constructor`, `login`, `logout` or asks how they work
- Adding, modifying, or debugging api-related functionality
- Tracing call chains that pass through the api layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/web/src/api/client.ts` | `CountGroup`, `GQLResult`, `AuthStatus`, `NodeInspectInfo` +(35) | 39 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`constructor`** `(method)` → `code-intel/web/src/api/client.ts:49`
- **`login`** `(method)` → `code-intel/web/src/api/client.ts:84`
- **`logout`** `(method)` → `code-intel/web/src/api/client.ts:99`
- **`readFile`** `(method)` → `code-intel/web/src/api/client.ts:176`
- **`grep`** `(method)` → `code-intel/web/src/api/client.ts:212`
- **`listFlows`** `(method)` → `code-intel/web/src/api/client.ts:224`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `ApiClient` | class | 20 | 0 | `api/client.ts` |
| `getCsrfToken` | method | 16 | 1 | `api/client.ts` |
| `search` | method | 10 | 2 | `api/client.ts` |
| `listGroups` | method | 7 | 1 | `api/client.ts` |
| `syncGroup` | method | 5 | 2 | `api/client.ts` |
| `deleteGroup` | method | 4 | 2 | `api/client.ts` |
| `vectorSearch` | method | 2 | 2 | `api/client.ts` |
| `vectorStatus` | method | 3 | 1 | `api/client.ts` |
| `blastRadius` | method | 2 | 2 | `api/client.ts` |
| `getGroup` | method | 3 | 1 | `api/client.ts` |
| `createGroup` | method | 2 | 2 | `api/client.ts` |
| `bootstrap` | method | 1 | 2 | `api/client.ts` |

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
