---
name: auth
description: "Covers the **auth** subsystem of code-intel-platform. 22 symbols across 2 files. Key symbols: `requestIdMiddleware`, `authMiddleware`. Internal call density: 0.4 calls/symbol. Participates in 4 execution flow(s)."
---

# auth

> **22 symbols** | **2 files** | path: `code-intel/core/src/auth/` | call density: 0.4/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/auth/`
- The user mentions `requestIdMiddleware`, `authMiddleware` or asks how they work
- Adding, modifying, or debugging auth-related functionality
- Tracing call chains that pass through the auth layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/auth/middleware.ts` | `Request`, `SessionEntry`, `getSessionTtlMs`, `createSession` +(13) | 13 exported |
| `code-intel/core/src/auth/users-db.ts` | `User`, `Token`, `UsersDB`, `getUsersDBPath` +(1) | 5 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`requestIdMiddleware`** `(function)` → `code-intel/core/src/auth/middleware.ts:68`
- **`authMiddleware`** `(function)` → `code-intel/core/src/auth/middleware.ts:83`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `getOrCreateUsersDB` | function | 4 | 2 | `auth/users-db.ts` |
| `authMiddleware` | function | 0 | 5 | `auth/middleware.ts` |
| `getSession` | function | 2 | 2 | `auth/middleware.ts` |
| `buildSessionCookie` | function | 3 | 1 | `auth/middleware.ts` |
| `getSessionTtlMs` | function | 3 | 0 | `auth/middleware.ts` |
| `UsersDB` | class | 3 | 0 | `auth/users-db.ts` |
| `createSession` | function | 2 | 0 | `auth/middleware.ts` |
| `deleteSession` | function | 1 | 1 | `auth/middleware.ts` |
| `requireRole` | function | 2 | 0 | `auth/middleware.ts` |
| `clearSessionCookie` | function | 2 | 0 | `auth/middleware.ts` |
| `isLocalhost` | function | 1 | 0 | `auth/middleware.ts` |
| `requireAuth` | function | 1 | 0 | `auth/middleware.ts` |

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
code-intel inspect getOrCreateUsersDB
# Blast radius for entry point
code-intel impact requestIdMiddleware
# Search this area
code-intel search "auth"
```
