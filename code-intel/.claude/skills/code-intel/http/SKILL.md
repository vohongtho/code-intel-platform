---
name: http
description: "Covers the **http** subsystem of code-intel. 18 symbols across 5 files. Key symbols: `rawReq`, `makeCtx`, `makeTestCtx`. Internal call density: 0.6 calls/symbol."
---

# http

> **18 symbols** | **5 files** | path: `core/tests/integration/http/` | call density: 0.6/sym

## When to Use

Load this skill when:
- The task involves code in `core/tests/integration/http/`
- The user mentions `rawReq`, `makeCtx`, `makeTestCtx` or asks how they work
- Adding, modifying, or debugging http-related functionality
- Tracing call chains that pass through the http layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `core/tests/integration/http/rbac.test.ts` | `rawReq`, `getCsrf`, `authReq`, `TestCtx` +(4) | internal |
| `core/tests/integration/http/security.test.ts` | `rawReq`, `getCsrf`, `csrfReq`, `TestCtx` +(2) | internal |
| `core/tests/integration/http/api.test.ts` | `rawReq`, `req` | internal |
| `core/tests/integration/http/observability.test.ts` | `rawReq` | internal |
| `core/tests/integration/http/transport-security.test.ts` | `rawReq` | internal |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `rawReq` | function | 4 | 3 | `http/rbac.test.ts` |
| `makeCtx` | function | 1 | 6 | `http/security.test.ts` |
| `makeTestCtx` | function | 1 | 5 | `http/rbac.test.ts` |
| `createToken` | function | 6 | 0 | `http/rbac.test.ts` |
| `rawReq` | function | 3 | 3 | `http/security.test.ts` |
| `rawReq` | function | 2 | 3 | `http/api.test.ts` |
| `rawReq` | function | 1 | 4 | `http/transport-security.test.ts` |
| `rawReq` | function | 1 | 3 | `http/observability.test.ts` |
| `getCsrf` | function | 3 | 1 | `http/rbac.test.ts` |
| `closeTestCtx` | function | 1 | 3 | `http/rbac.test.ts` |
| `closeCtx` | function | 1 | 3 | `http/security.test.ts` |
| `authReq` | function | 1 | 2 | `http/rbac.test.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect rawReq
# Blast radius for entry point
code-intel impact rawReq
# Search this area
code-intel search "http"
```
