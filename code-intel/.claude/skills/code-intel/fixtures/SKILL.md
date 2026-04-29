---
name: fixtures
description: "Covers the **fixtures** subsystem of code-intel. 75 symbols across 10 files. Key symbols: `server_init`, `server_start`, `internal_calc`. Internal call density: 0 calls/symbol."
---

# fixtures

> **75 symbols** | **10 files** | path: `core/tests/parser-corpus/fixtures/` | call density: 0/sym

## When to Use

Load this skill when:
- The task involves code in `core/tests/parser-corpus/fixtures/`
- The user mentions `server_init`, `server_start`, `internal_calc` or asks how they work
- Adding, modifying, or debugging fixtures-related functionality
- Tracing call chains that pass through the fixtures layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `core/tests/parser-corpus/fixtures/php-sample.php` | `UserService`, `__construct`, `getUser`, `saveUser` +(6) | 10 exported |
| `core/tests/parser-corpus/fixtures/csharp-sample.cs` | `UserService`, `GetUser`, `SaveUser`, `FormatName` +(5) | 5 exported |
| `core/tests/parser-corpus/fixtures/rust-sample.rs` | `Server`, `Config`, `ServerError`, `Handler` +(5) | internal |
| `core/tests/parser-corpus/fixtures/java-sample.java` | `UserService`, `getUser`, `saveUser`, `formatName` +(4) | 5 exported |
| `core/tests/parser-corpus/fixtures/go-sample.go` | `Server`, `Config`, `Handler`, `New` +(3) | 6 exported |
| `core/tests/parser-corpus/fixtures/python-sample.py` | `UserService`, `__init__`, `greet`, `_internal` +(3) | 4 exported |
| `core/tests/parser-corpus/fixtures/ruby-sample.rb` | `UserService`, `initialize`, `get_user`, `save_user` +(3) | 7 exported |
| `core/tests/parser-corpus/fixtures/typescript-sample.ts` | `UserService`, `constructor`, `greet`, `createUser` +(3) | 6 exported |
| `core/tests/parser-corpus/fixtures/cpp-sample.cpp` | `HttpServer`, `TcpServer`, `TcpServer`, `Config` +(2) | 6 exported |
| `core/tests/parser-corpus/fixtures/c-sample.c` | `Point`, `server_init`, `server_start`, `internal_calc` +(1) | 5 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`server_init`** `(function)` → `core/tests/parser-corpus/fixtures/c-sample.c:17`
- **`server_start`** `(function)` → `core/tests/parser-corpus/fixtures/c-sample.c:22`
- **`internal_calc`** `(function)` → `core/tests/parser-corpus/fixtures/c-sample.c:27`
- **`parse_config`** `(function)` → `core/tests/parser-corpus/fixtures/c-sample.c:32`
- **`TcpServer`** `(class)` → `core/tests/parser-corpus/fixtures/cpp-sample.cpp:17`
- **`TcpServer`** `(function)` → `core/tests/parser-corpus/fixtures/cpp-sample.cpp:19`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `createUser` | function | 8 | 1 | `fixtures/typescript-sample.ts` |
| `log` | method | 8 | 0 | `fixtures/php-sample.php` |
| `HttpServer` | class | 2 | 0 | `fixtures/cpp-sample.cpp` |
| `start` | function | 2 | 0 | `fixtures/rust-sample.rs` |
| `TcpServer` | function | 0 | 1 | `fixtures/cpp-sample.cpp` |
| `UserService` | class | 1 | 0 | `fixtures/csharp-sample.cs` |
| `Start` | method | 0 | 1 | `fixtures/go-sample.go` |
| `Stop` | method | 0 | 1 | `fixtures/go-sample.go` |
| `UserService` | class | 1 | 0 | `fixtures/java-sample.java` |
| `UserService` | class | 1 | 0 | `fixtures/python-sample.py` |
| `create_user` | function | 0 | 1 | `fixtures/python-sample.py` |
| `Server` | class | 1 | 0 | `fixtures/rust-sample.rs` |

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
code-intel impact server_init
# Search this area
code-intel search "fixtures"
```
