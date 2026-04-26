---
name: go-repo
description: "Covers the **go-repo** subsystem of code-intel-platform. 10 symbols across 1 files. Key symbols: `FindByID`, `Delete`, `Count`. Internal call density: 0.3 calls/symbol."
---

# go-repo

> **10 symbols** | **1 files** | path: `eval/fixtures/go-repo/` | call density: 0.3/sym

## When to Use

Load this skill when:
- The task involves code in `eval/fixtures/go-repo/`
- The user mentions `FindByID`, `Delete`, `Count` or asks how they work
- Adding, modifying, or debugging go-repo-related functionality
- Tracing call chains that pass through the go-repo layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `eval/fixtures/go-repo/main.go` | `User`, `UserRepository`, `NewUserRepository`, `Create` +(6) | 9 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`FindByID`** `(method)` → `eval/fixtures/go-repo/main.go:27`
- **`Delete`** `(method)` → `eval/fixtures/go-repo/main.go:32`
- **`Count`** `(method)` → `eval/fixtures/go-repo/main.go:40`
- **`ValidateEmail`** `(function)` → `eval/fixtures/go-repo/main.go:44`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `main` | function | 0 | 3 | `go-repo/main.go` |
| `NewUserRepository` | function | 1 | 0 | `go-repo/main.go` |
| `Create` | method | 1 | 0 | `go-repo/main.go` |
| `FormatUser` | function | 1 | 0 | `go-repo/main.go` |
| `User` | struct | 0 | 0 | `go-repo/main.go` |
| `UserRepository` | struct | 0 | 0 | `go-repo/main.go` |
| `FindByID` | method | 0 | 0 | `go-repo/main.go` |
| `Delete` | method | 0 | 0 | `go-repo/main.go` |
| `Count` | method | 0 | 0 | `go-repo/main.go` |
| `ValidateEmail` | function | 0 | 0 | `go-repo/main.go` |

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
code-intel search "go-repo"
```
