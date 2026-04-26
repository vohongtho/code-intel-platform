---
name: parsing
description: "Covers the **parsing** subsystem of code-intel-platform. 7 symbols across 3 files. Key symbols: `AstCache`, `parseSource`, `runQuery`. Internal call density: 0.4 calls/symbol. Participates in 1 execution flow(s)."
---

# parsing

> **7 symbols** | **3 files** | path: `code-intel/core/src/parsing/` | call density: 0.4/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/parsing/`
- The user mentions `AstCache`, `parseSource`, `runQuery` or asks how they work
- Adding, modifying, or debugging parsing-related functionality
- Tracing call chains that pass through the parsing layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/parsing/parser-manager.ts` | `initParser`, `getParser`, `getLanguage`, `parseSource` | 4 exported |
| `code-intel/core/src/parsing/query-runner.ts` | `QueryCapture`, `runQuery` | 2 exported |
| `code-intel/core/src/parsing/ast-cache.ts` | `AstCache` | 1 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`AstCache`** `(class)` → `code-intel/core/src/parsing/ast-cache.ts:5`
- **`parseSource`** `(function)` → `code-intel/core/src/parsing/parser-manager.ts:45`
- **`runQuery`** `(function)` → `code-intel/core/src/parsing/query-runner.ts:9`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `getParser` | function | 1 | 1 | `parsing/parser-manager.ts` |
| `parseSource` | function | 0 | 2 | `parsing/parser-manager.ts` |
| `initParser` | function | 1 | 0 | `parsing/parser-manager.ts` |
| `getLanguage` | function | 1 | 0 | `parsing/parser-manager.ts` |
| `AstCache` | class | 0 | 0 | `parsing/ast-cache.ts` |
| `QueryCapture` | interface | 0 | 0 | `parsing/query-runner.ts` |
| `runQuery` | function | 0 | 0 | `parsing/query-runner.ts` |

## Execution Flows

**1** execution path(s) pass through this area.
Run `code-intel inspect <symbol>` on a hot symbol to trace the full call chain.

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect getParser
# Blast radius for entry point
code-intel impact AstCache
# Search this area
code-intel search "parsing"
```
