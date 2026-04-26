---
name: skill
description: "Covers the **.** subsystem of java-repo. 13 symbols across 1 files. Key symbols: `UserRepository`, `create`, `findById`. Internal call density: 0.3 calls/symbol."
---

# .

> **13 symbols** | **1 files** | path: `./` | call density: 0.3/sym

## When to Use

Load this skill when:
- The task involves code in `./`
- The user mentions `UserRepository`, `create`, `findById` or asks how they work
- Adding, modifying, or debugging .-related functionality
- Tracing call chains that pass through the . layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `UserRepository.java` | `UserRepository`, `create`, `findById`, `delete` +(9) | 11 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`UserRepository`** `(class)` → `UserRepository.java:7`
- **`create`** `(method)` → `UserRepository.java:11`
- **`findById`** `(method)` → `UserRepository.java:18`
- **`delete`** `(method)` → `UserRepository.java:22`
- **`count`** `(method)` → `UserRepository.java:26`
- **`getId`** `(method)` → `UserRepository.java:42`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `User` | class | 2 | 0 | `UserRepository.java` |
| `format` | method | 0 | 2 | `UserRepository.java` |
| `create` | method | 0 | 1 | `UserRepository.java` |
| `count` | method | 0 | 1 | `UserRepository.java` |
| `getName` | method | 1 | 0 | `UserRepository.java` |
| `getEmail` | method | 1 | 0 | `UserRepository.java` |
| `UserRepository` | class | 0 | 0 | `UserRepository.java` |
| `findById` | method | 0 | 0 | `UserRepository.java` |
| `delete` | method | 0 | 0 | `UserRepository.java` |
| `getId` | method | 0 | 0 | `UserRepository.java` |
| `setName` | method | 0 | 0 | `UserRepository.java` |
| `EmailValidator` | class | 0 | 0 | `UserRepository.java` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect User
# Blast radius for entry point
code-intel impact UserRepository
# Search this area
code-intel search "."
```
