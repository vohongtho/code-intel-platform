---
name: src
description: "Covers the **src** subsystem of rust-repo. 12 symbols across 1 files. Key symbols: `new`, `create`, `find_by_id`. Internal call density: 0.1 calls/symbol."
---

# src

> **12 symbols** | **1 files** | path: `src/` | call density: 0.1/sym

## When to Use

Load this skill when:
- The task involves code in `src/`
- The user mentions `new`, `create`, `find_by_id` or asks how they work
- Adding, modifying, or debugging src-related functionality
- Tracing call chains that pass through the src layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `src/lib.rs` | `User`, `UserRepository`, `UserRepository`, `new` +(8) | 10 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`new`** `(function)` → `src/lib.rs:15`
- **`create`** `(function)` → `src/lib.rs:19`
- **`find_by_id`** `(function)` → `src/lib.rs:26`
- **`delete`** `(function)` → `src/lib.rs:30`
- **`count`** `(function)` → `src/lib.rs:34`
- **`validate_email`** `(function)` → `src/lib.rs:39`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `internal_hash` | function | 1 | 0 | `src/lib.rs` |
| `generate_token` | function | 0 | 1 | `src/lib.rs` |
| `User` | struct | 0 | 0 | `src/lib.rs` |
| `UserRepository` | struct | 0 | 0 | `src/lib.rs` |
| `UserRepository` | class | 0 | 0 | `src/lib.rs` |
| `new` | function | 0 | 0 | `src/lib.rs` |
| `create` | function | 0 | 0 | `src/lib.rs` |
| `find_by_id` | function | 0 | 0 | `src/lib.rs` |
| `delete` | function | 0 | 0 | `src/lib.rs` |
| `count` | function | 0 | 0 | `src/lib.rs` |
| `validate_email` | function | 0 | 0 | `src/lib.rs` |
| `format_user` | function | 0 | 0 | `src/lib.rs` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect internal_hash
# Blast radius for entry point
code-intel impact new
# Search this area
code-intel search "src"
```
