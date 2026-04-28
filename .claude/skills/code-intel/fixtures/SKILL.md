---
name: fixtures
description: "Covers the **fixtures** subsystem of code-intel-platform. 12 symbols across 2 files. Key symbols: `AdminService`, `create_user`. Internal call density: 0.2 calls/symbol."
---

# fixtures

> **12 symbols** | **2 files** | path: `code-intel/core/tests/parser-corpus/fixtures/` | call density: 0.2/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/tests/parser-corpus/fixtures/`
- The user mentions `AdminService`, `create_user` or asks how they work
- Adding, modifying, or debugging fixtures-related functionality
- Tracing call chains that pass through the fixtures layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/tests/parser-corpus/fixtures/python-sample.py` | `UserService`, `__init__`, `greet`, `_internal` +(3) | 4 exported |
| `code-intel/core/tests/parser-corpus/fixtures/typescript-sample.ts` | `UserService`, `createUser`, `IUser`, `Status` +(1) | 4 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`AdminService`** `(class)` → `code-intel/core/tests/parser-corpus/fixtures/python-sample.py:14`
- **`create_user`** `(function)` → `code-intel/core/tests/parser-corpus/fixtures/python-sample.py:18`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `createUser` | function | 8 | 1 | `fixtures/typescript-sample.ts` |
| `UserService` | class | 1 | 0 | `fixtures/python-sample.py` |
| `greet` | function | 1 | 0 | `fixtures/python-sample.py` |
| `create_user` | function | 0 | 1 | `fixtures/python-sample.py` |
| `UserService` | class | 1 | 0 | `fixtures/typescript-sample.ts` |
| `__init__` | method | 0 | 0 | `fixtures/python-sample.py` |
| `_internal` | function | 0 | 0 | `fixtures/python-sample.py` |
| `AdminService` | class | 0 | 0 | `fixtures/python-sample.py` |
| `_private_helper` | function | 0 | 0 | `fixtures/python-sample.py` |
| `IUser` | interface | 0 | 0 | `fixtures/typescript-sample.ts` |
| `Status` | enum | 0 | 0 | `fixtures/typescript-sample.ts` |
| `internalHelper` | function | 0 | 0 | `fixtures/typescript-sample.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect createUser
# Blast radius for entry point
code-intel impact AdminService
# Search this area
code-intel search "fixtures"
```
