---
name: skill
description: "Covers the **.** subsystem of go-repo. 10 symbols across 1 files. Key symbols: `FindByID`, `Delete`, `Count`. Internal call density: 0.3 calls/symbol."
---

# .

> **10 symbols** | **1 files** | path: `./` | call density: 0.3/sym

## When to Use

Load this skill when:
- The task involves code in `./`
- The user mentions `FindByID`, `Delete`, `Count` or asks how they work
- Adding, modifying, or debugging .-related functionality
- Tracing call chains that pass through the . layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `main.go` | `User`, `UserRepository`, `NewUserRepository`, `Create` +(6) | 9 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`FindByID`** `(method)` → `main.go:27`
- **`Delete`** `(method)` → `main.go:32`
- **`Count`** `(method)` → `main.go:40`
- **`ValidateEmail`** `(function)` → `main.go:44`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `main` | function | 0 | 3 | `main.go` |
| `NewUserRepository` | function | 1 | 0 | `main.go` |
| `Create` | method | 1 | 0 | `main.go` |
| `FormatUser` | function | 1 | 0 | `main.go` |
| `User` | struct | 0 | 0 | `main.go` |
| `UserRepository` | struct | 0 | 0 | `main.go` |
| `FindByID` | method | 0 | 0 | `main.go` |
| `Delete` | method | 0 | 0 | `main.go` |
| `Count` | method | 0 | 0 | `main.go` |
| `ValidateEmail` | function | 0 | 0 | `main.go` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect main
# Blast radius for entry point
code-intel impact FindByID
# Search this area
code-intel search "."
```
