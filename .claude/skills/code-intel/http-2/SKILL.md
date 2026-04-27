---
name: http-2
description: "Covers the **http** subsystem of code-intel-platform. 12 symbols across 4 files. Key symbols: `makeTestCtx`, `createToken`, `login`. Internal call density: 0.2 calls/symbol."
---

# http

> **12 symbols** | **4 files** | path: `code-intel/core/tests/integration/http/` | call density: 0.2/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/tests/integration/http/`
- The user mentions `makeTestCtx`, `createToken`, `login` or asks how they work
- Adding, modifying, or debugging http-related functionality
- Tracing call chains that pass through the http layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/tests/integration/http/rbac.test.ts` | `rawReq`, `getCsrf`, `authReq`, `TestCtx` +(4) | internal |
| `code-intel/core/tests/integration/http/api.test.ts` | `rawReq`, `req` | internal |
| `code-intel/core/tests/integration/http/observability.test.ts` | `rawReq` | internal |
| `code-intel/core/tests/integration/http/transport-security.test.ts` | `rawReq` | internal |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `makeTestCtx` | function | 1 | 4 | `http/rbac.test.ts` |
| `createToken` | function | 5 | 0 | `http/rbac.test.ts` |
| `login` | function | 1 | 2 | `http/rbac.test.ts` |
| `closeTestCtx` | function | 1 | 2 | `http/rbac.test.ts` |
| `rawReq` | function | 2 | 0 | `http/rbac.test.ts` |
| `getCsrf` | function | 2 | 0 | `http/rbac.test.ts` |
| `rawReq` | function | 1 | 0 | `http/api.test.ts` |
| `req` | function | 1 | 0 | `http/api.test.ts` |
| `rawReq` | function | 1 | 0 | `http/observability.test.ts` |
| `authReq` | function | 1 | 0 | `http/rbac.test.ts` |
| `rawReq` | function | 1 | 0 | `http/transport-security.test.ts` |
| `TestCtx` | interface | 0 | 0 | `http/rbac.test.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect makeTestCtx
# Blast radius for entry point
code-intel impact makeTestCtx
# Search this area
code-intel search "http"
```
