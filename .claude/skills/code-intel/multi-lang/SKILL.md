---
name: multi-lang
description: "Covers the **multi-lang** subsystem of code-intel-platform. 13 symbols across 2 files. Key symbols: `AuthService`, `register`, `validate_email`. Internal call density: 0.2 calls/symbol."
---

# multi-lang

> **13 symbols** | **2 files** | path: `eval/fixtures/multi-lang/` | call density: 0.2/sym

## When to Use

Load this skill when:
- The task involves code in `eval/fixtures/multi-lang/`
- The user mentions `AuthService`, `register`, `validate_email` or asks how they work
- Adding, modifying, or debugging multi-lang-related functionality
- Tracing call chains that pass through the multi-lang layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `eval/fixtures/multi-lang/auth.py` | `User`, `__init__`, `AuthService`, `register` +(5) | 6 exported |
| `eval/fixtures/multi-lang/router.ts` | `Request`, `Response`, `Router`, `AuthService` | 4 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`AuthService`** `(class)` → `eval/fixtures/multi-lang/auth.py:9`
- **`register`** `(function)` → `eval/fixtures/multi-lang/auth.py:14`
- **`validate_email`** `(function)` → `eval/fixtures/multi-lang/auth.py:39`
- **`Router`** `(class)` → `eval/fixtures/multi-lang/router.ts:16`
- **`AuthService`** `(class)` → `eval/fixtures/multi-lang/router.ts:60`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `login` | function | 3 | 2 | `multi-lang/auth.py` |
| `logout` | function | 3 | 0 | `multi-lang/auth.py` |
| `User` | class | 1 | 0 | `multi-lang/auth.py` |
| `__init__` | method | 1 | 0 | `multi-lang/auth.py` |
| `register` | function | 0 | 1 | `multi-lang/auth.py` |
| `_find_user` | function | 1 | 0 | `multi-lang/auth.py` |
| `_generate_token` | function | 1 | 0 | `multi-lang/auth.py` |
| `AuthService` | class | 0 | 0 | `multi-lang/auth.py` |
| `validate_email` | function | 0 | 0 | `multi-lang/auth.py` |
| `Request` | interface | 0 | 0 | `multi-lang/router.ts` |
| `Response` | interface | 0 | 0 | `multi-lang/router.ts` |
| `Router` | class | 0 | 0 | `multi-lang/router.ts` |

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
code-intel search "multi-lang"
```
