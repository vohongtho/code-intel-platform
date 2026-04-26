---
name: java-repo
description: "Covers the **java-repo** subsystem of code-intel-platform. 13 symbols across 1 files. Key symbols: `UserRepository`, `create`, `findById`. Internal call density: 0.3 calls/symbol."
---

# java-repo

> **13 symbols** | **1 files** | path: `eval/fixtures/java-repo/` | call density: 0.3/sym

## When to Use

Load this skill when:
- The task involves code in `eval/fixtures/java-repo/`
- The user mentions `UserRepository`, `create`, `findById` or asks how they work
- Adding, modifying, or debugging java-repo-related functionality
- Tracing call chains that pass through the java-repo layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `eval/fixtures/java-repo/UserRepository.java` | `UserRepository`, `create`, `findById`, `delete` +(9) | 11 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`UserRepository`** `(class)` → `eval/fixtures/java-repo/UserRepository.java:7`
- **`create`** `(method)` → `eval/fixtures/java-repo/UserRepository.java:11`
- **`findById`** `(method)` → `eval/fixtures/java-repo/UserRepository.java:18`
- **`delete`** `(method)` → `eval/fixtures/java-repo/UserRepository.java:22`
- **`count`** `(method)` → `eval/fixtures/java-repo/UserRepository.java:26`
- **`getId`** `(method)` → `eval/fixtures/java-repo/UserRepository.java:42`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `User` | class | 2 | 0 | `java-repo/UserRepository.java` |
| `format` | method | 0 | 2 | `java-repo/UserRepository.java` |
| `create` | method | 0 | 1 | `java-repo/UserRepository.java` |
| `count` | method | 0 | 1 | `java-repo/UserRepository.java` |
| `getName` | method | 1 | 0 | `java-repo/UserRepository.java` |
| `getEmail` | method | 1 | 0 | `java-repo/UserRepository.java` |
| `UserRepository` | class | 0 | 0 | `java-repo/UserRepository.java` |
| `findById` | method | 0 | 0 | `java-repo/UserRepository.java` |
| `delete` | method | 0 | 0 | `java-repo/UserRepository.java` |
| `getId` | method | 0 | 0 | `java-repo/UserRepository.java` |
| `setName` | method | 0 | 0 | `java-repo/UserRepository.java` |
| `EmailValidator` | class | 0 | 0 | `java-repo/UserRepository.java` |

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
code-intel search "java-repo"
```
