---
name: auth-2
description: "Covers the **auth** subsystem of code-intel. 19 symbols across 5 files. Key symbols: `json`, `on`, `setHeader`. Internal call density: 0 calls/symbol. Participates in 4 execution flow(s)."
---

# auth

> **19 symbols** | **5 files** | path: `core/tests/unit/auth/` | call density: 0/sym

## When to Use

Load this skill when:
- The task involves code in `core/tests/unit/auth/`
- The user mentions `json`, `on`, `setHeader` or asks how they work
- Adding, modifying, or debugging auth-related functionality
- Tracing call chains that pass through the auth layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `core/tests/unit/auth/auth-coverage.test.ts` | `makeReq`, `makeRes`, `status`, `json` +(3) | internal |
| `core/tests/unit/auth/middleware.test.ts` | `makeReq`, `makeRes`, `status`, `json` +(2) | internal |
| `core/tests/unit/auth/oidc.test.ts` | `tempDbPath`, `setOIDCEnv`, `clearOIDCEnv` | internal |
| `core/tests/unit/auth/keychain.test.ts` | `setupSecretStore`, `cleanup` | internal |
| `core/tests/unit/auth/auth.test.ts` | `tempDbPath` | internal |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `json` | method | 28 | 0 | `auth/middleware.test.ts` |
| `on` | method | 15 | 0 | `auth/auth-coverage.test.ts` |
| `setHeader` | method | 4 | 0 | `auth/middleware.test.ts` |
| `tempDbPath` | function | 1 | 1 | `auth/auth.test.ts` |
| `tempDbPath` | function | 1 | 1 | `auth/oidc.test.ts` |
| `setOIDCEnv` | function | 1 | 1 | `auth/oidc.test.ts` |
| `clearOIDCEnv` | function | 1 | 1 | `auth/oidc.test.ts` |
| `makeReq` | function | 1 | 0 | `auth/auth-coverage.test.ts` |
| `makeRes` | function | 1 | 0 | `auth/auth-coverage.test.ts` |
| `makeNext` | function | 1 | 0 | `auth/auth-coverage.test.ts` |
| `setupSecretStore` | function | 1 | 0 | `auth/keychain.test.ts` |
| `makeReq` | function | 1 | 0 | `auth/middleware.test.ts` |

## Execution Flows

**4** execution path(s) pass through this area.
Run `code-intel inspect <symbol>` on a hot symbol to trace the full call chain.

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect json
# Blast radius for entry point
code-intel impact json
# Search this area
code-intel search "auth"
```
