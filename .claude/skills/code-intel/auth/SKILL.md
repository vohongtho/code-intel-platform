---
name: auth
description: "Covers the **auth** subsystem of code-intel-platform. 63 symbols across 5 files. Key symbols: `authMiddleware`. Internal call density: 0.6 calls/symbol. Participates in 4 execution flow(s)."
---

# auth

> **63 symbols** | **5 files** | path: `code-intel/core/src/auth/` | call density: 0.6/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/auth/`
- The user mentions `authMiddleware` or asks how they work
- Adding, modifying, or debugging auth-related functionality
- Tracing call chains that pass through the auth layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/auth/oidc.ts` | `OIDCPendingFlow`, `cleanExpiredFlows`, `OIDCConfig`, `getOIDCConfig` +(14) | 16 exported |
| `code-intel/core/src/auth/middleware.ts` | `Request`, `SessionEntry`, `getSessionTtlMs`, `createSession` +(13) | 14 exported |
| `code-intel/core/src/auth/secret-store.ts` | `getScryptN`, `SecretsBlob`, `getSecretsPath`, `getMasterPassword` +(9) | 10 exported |
| `code-intel/core/src/auth/keychain.ts` | `getKeytar`, `k`, `KeychainBackendInfo`, `keychainBackend` +(4) | 6 exported |
| `code-intel/core/src/auth/users-db.ts` | `User`, `Token`, `OIDCIdentity`, `UsersDB` +(3) | 7 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`authMiddleware`** `(function)` → `code-intel/core/src/auth/middleware.ts:84`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `saveSecrets` | function | 3 | 5 | `auth/secret-store.ts` |
| `UsersDB` | class | 8 | 0 | `auth/users-db.ts` |
| `getOrCreateUsersDB` | function | 6 | 2 | `auth/users-db.ts` |
| `getOIDCConfig` | function | 7 | 0 | `auth/oidc.ts` |
| `resetUsersDBForTesting` | function | 7 | 0 | `auth/users-db.ts` |
| `getSession` | function | 4 | 2 | `auth/middleware.ts` |
| `authMiddleware` | function | 0 | 6 | `auth/middleware.ts` |
| `loadSecrets` | function | 5 | 1 | `auth/secret-store.ts` |
| `buildSessionCookie` | function | 4 | 1 | `auth/middleware.ts` |
| `getDiscoveredConfig` | function | 4 | 1 | `auth/oidc.ts` |
| `handleOIDCCallback` | function | 2 | 3 | `auth/oidc.ts` |
| `setSecret` | function | 2 | 3 | `auth/secret-store.ts` |

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
code-intel inspect saveSecrets
# Blast radius for entry point
code-intel impact authMiddleware
# Search this area
code-intel search "auth"
```
