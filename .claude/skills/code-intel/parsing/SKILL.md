---
name: parsing
description: "Covers the **parsing** subsystem of code-intel-platform. 20 symbols across 3 files. Key symbols: `AstCache`, `constructor`, `set`. Internal call density: 0.6 calls/symbol. Participates in 6 execution flow(s)."
---

# parsing

> **20 symbols** | **3 files** | path: `code-intel/core/src/parsing/` | call density: 0.6/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/parsing/`
- The user mentions `AstCache`, `constructor`, `set` or asks how they work
- Adding, modifying, or debugging parsing-related functionality
- Tracing call chains that pass through the parsing layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/parsing/ast-cache.ts` | `AstCache`, `constructor`, `get`, `set` +(4) | 8 exported |
| `code-intel/core/src/parsing/parser-manager.ts` | `findBundledWasmDir`, `wasmPath`, `initParser`, `getLanguage` +(3) | 5 exported |
| `code-intel/core/src/parsing/query-runner.ts` | `QueryCapture`, `QueryMatch`, `getOrCompileQuery`, `runQuery` +(1) | 4 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`AstCache`** `(class)` → `code-intel/core/src/parsing/ast-cache.ts:5`
- **`constructor`** `(method)` → `code-intel/core/src/parsing/ast-cache.ts:9`
- **`set`** `(method)` → `code-intel/core/src/parsing/ast-cache.ts:22`
- **`clear`** `(method)` → `code-intel/core/src/parsing/ast-cache.ts:33`
- **`size`** `(method)` → `code-intel/core/src/parsing/ast-cache.ts:37`
- **`isTreeSitterAvailable`** `(function)` → `code-intel/core/src/parsing/parser-manager.ts:164`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `get` | method | 70 | 1 | `parsing/ast-cache.ts` |
| `has` | method | 55 | 0 | `parsing/ast-cache.ts` |
| `getLanguage` | function | 5 | 5 | `parsing/parser-manager.ts` |
| `runQueryMatches` | function | 3 | 2 | `parsing/query-runner.ts` |
| `getParser` | function | 1 | 3 | `parsing/parser-manager.ts` |
| `parseSource` | function | 3 | 1 | `parsing/parser-manager.ts` |
| `getOrCompileQuery` | function | 2 | 2 | `parsing/query-runner.ts` |
| `set` | method | 0 | 2 | `parsing/ast-cache.ts` |
| `evictLRU` | method | 1 | 1 | `parsing/ast-cache.ts` |
| `wasmPath` | function | 1 | 1 | `parsing/parser-manager.ts` |
| `initParser` | function | 1 | 1 | `parsing/parser-manager.ts` |
| `runQuery` | function | 0 | 2 | `parsing/query-runner.ts` |

## Execution Flows

**6** execution path(s) pass through this area.
Run `code-intel inspect <symbol>` on a hot symbol to trace the full call chain.

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect get
# Blast radius for entry point
code-intel impact AstCache
# Search this area
code-intel search "parsing"
```
