---
name: auth
description: "Covers the **auth** subsystem of code-intel-platform. 85 symbols across 5 files. Key symbols: `authMiddleware`, `constructor`, `createUser`. Internal call density: 0.6 calls/symbol."
---

# auth

> **85 symbols** | **5 files** | path: `code-intel/core/src/auth/` | call density: 0.6/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/auth/`
- The user mentions `authMiddleware`, `constructor`, `createUser` or asks how they work
- Adding, modifying, or debugging auth-related functionality
- Tracing call chains that pass through the auth layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/auth/users-db.ts` | `User`, `Token`, `OIDCIdentity`, `UsersDB` +(26) | 30 exported |
| `code-intel/core/src/auth/middleware.ts` | `Request`, `SessionEntry`, `getSessionTtlMs`, `createSession` +(14) | 14 exported |
| `code-intel/core/src/auth/oidc.ts` | `OIDCPendingFlow`, `cleanExpiredFlows`, `OIDCConfig`, `getOIDCConfig` +(13) | 16 exported |
| `code-intel/core/src/auth/secret-store.ts` | `getScryptN`, `SecretsBlob`, `getSecretsPath`, `getMasterPassword` +(9) | 10 exported |
| `code-intel/core/src/auth/keychain.ts` | `getKeytar`, `KeychainBackendInfo`, `keychainBackend`, `setKeychainSecret` +(3) | 6 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`authMiddleware`** `(function)` → `code-intel/core/src/auth/middleware.ts:84`
- **`constructor`** `(method)` → `code-intel/core/src/auth/users-db.ts:45`
- **`createUser`** `(method)` → `code-intel/core/src/auth/users-db.ts:111`
- **`createToken`** `(method)` → `code-intel/core/src/auth/users-db.ts:162`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `authMiddleware` | function | 0 | 13 | `auth/middleware.ts` |
| `UsersDB` | class | 10 | 0 | `auth/users-db.ts` |
| `resetUsersDBForTesting` | function | 9 | 1 | `auth/users-db.ts` |
| `getSession` | function | 4 | 4 | `auth/middleware.ts` |
| `getDiscoveredConfig` | function | 5 | 3 | `auth/oidc.ts` |
| `saveSecrets` | function | 3 | 5 | `auth/secret-store.ts` |
| `getOrCreateUsersDB` | function | 6 | 2 | `auth/users-db.ts` |
| `requireRole` | function | 3 | 4 | `auth/middleware.ts` |
| `getOIDCConfig` | function | 7 | 0 | `auth/oidc.ts` |
| `handleOIDCCallback` | function | 2 | 5 | `auth/oidc.ts` |
| `createSession` | function | 3 | 3 | `auth/middleware.ts` |
| `buildOIDCLoginUrl` | function | 2 | 4 | `auth/oidc.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect authMiddleware
# Blast radius for entry point
code-intel impact authMiddleware
# Search this area
code-intel search "auth"
```
