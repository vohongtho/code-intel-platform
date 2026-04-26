---
name: skill
description: "Covers the **.** subsystem of multi-lang. 13 symbols across 2 files. Key symbols: `AuthService`, `register`, `validate_email`. Internal call density: 0.2 calls/symbol."
---

# .

> **13 symbols** | **2 files** | path: `./` | call density: 0.2/sym

## When to Use

Load this skill when:
- The task involves code in `./`
- The user mentions `AuthService`, `register`, `validate_email` or asks how they work
- Adding, modifying, or debugging .-related functionality
- Tracing call chains that pass through the . layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `auth.py` | `User`, `__init__`, `AuthService`, `register` +(5) | 6 exported |
| `router.ts` | `Request`, `Response`, `Router`, `AuthService` | 4 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`AuthService`** `(class)` → `auth.py:9`
- **`register`** `(function)` → `auth.py:14`
- **`validate_email`** `(function)` → `auth.py:39`
- **`Router`** `(class)` → `router.ts:16`
- **`AuthService`** `(class)` → `router.ts:60`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `login` | function | 1 | 2 | `auth.py` |
| `User` | class | 1 | 0 | `auth.py` |
| `register` | function | 0 | 1 | `auth.py` |
| `logout` | function | 1 | 0 | `auth.py` |
| `_find_user` | function | 1 | 0 | `auth.py` |
| `_generate_token` | function | 1 | 0 | `auth.py` |
| `__init__` | method | 0 | 0 | `auth.py` |
| `AuthService` | class | 0 | 0 | `auth.py` |
| `validate_email` | function | 0 | 0 | `auth.py` |
| `Request` | interface | 0 | 0 | `router.ts` |
| `Response` | interface | 0 | 0 | `router.ts` |
| `Router` | class | 0 | 0 | `router.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect login
# Blast radius for entry point
code-intel impact AuthService
# Search this area
code-intel search "."
```
