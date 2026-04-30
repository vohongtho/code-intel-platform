---
name: multi-lang
description: "Covers the **multi-lang** subsystem of code-intel-platform. 21 symbols across 2 files. Key symbols: `AuthService`, `register`, `login`. Internal call density: 0.4 calls/symbol. Participates in 5 execution flow(s)."
---

# multi-lang

> **21 symbols** | **2 files** | path: `eval/fixtures/multi-lang/` | call density: 0.4/sym

## When to Use

Load this skill when:
- The task involves code in `eval/fixtures/multi-lang/`
- The user mentions `AuthService`, `register`, `login` or asks how they work
- Adding, modifying, or debugging multi-lang-related functionality
- Tracing call chains that pass through the multi-lang layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `eval/fixtures/multi-lang/router.ts` | `Request`, `Response`, `Router`, `constructor` +(8) | 12 exported |
| `eval/fixtures/multi-lang/auth.py` | `User`, `__init__`, `AuthService`, `register` +(5) | 6 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`AuthService`** `(class)` → `eval/fixtures/multi-lang/auth.py:9`
- **`register`** `(function)` → `eval/fixtures/multi-lang/auth.py:14`
- **`login`** `(function)` → `eval/fixtures/multi-lang/auth.py:19`
- **`logout`** `(function)` → `eval/fixtures/multi-lang/auth.py:28`
- **`validate_email`** `(function)` → `eval/fixtures/multi-lang/auth.py:39`
- **`Router`** `(class)` → `eval/fixtures/multi-lang/router.ts:16`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `registerRoutes` | method | 1 | 4 | `multi-lang/router.ts` |
| `handle` | method | 1 | 2 | `multi-lang/router.ts` |
| `login` | method | 3 | 0 | `multi-lang/router.ts` |
| `login` | function | 0 | 2 | `multi-lang/auth.py` |
| `_find_user` | function | 1 | 1 | `multi-lang/auth.py` |
| `_generate_token` | function | 1 | 1 | `multi-lang/auth.py` |
| `handleLogin` | method | 1 | 1 | `multi-lang/router.ts` |
| `handleLogout` | method | 1 | 1 | `multi-lang/router.ts` |
| `logout` | method | 2 | 0 | `multi-lang/router.ts` |
| `User` | class | 1 | 0 | `multi-lang/auth.py` |
| `__init__` | function | 1 | 0 | `multi-lang/auth.py` |
| `register` | function | 0 | 1 | `multi-lang/auth.py` |

## Execution Flows

**5** execution path(s) pass through this area.
Run `code-intel inspect <symbol>` on a hot symbol to trace the full call chain.

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect registerRoutes
# Blast radius for entry point
code-intel impact AuthService
# Search this area
code-intel search "multi-lang"
```
