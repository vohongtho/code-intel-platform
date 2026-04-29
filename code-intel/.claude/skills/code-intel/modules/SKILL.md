---
name: modules
description: "Covers the **modules** subsystem of code-intel. 40 symbols across 13 files. Key symbols: `resolveImport`, `isExported`, `extractType`. Internal call density: 0 calls/symbol."
---

# modules

> **40 symbols** | **13 files** | path: `core/src/languages/modules/` | call density: 0/sym

## When to Use

Load this skill when:
- The task involves code in `core/src/languages/modules/`
- The user mentions `resolveImport`, `isExported`, `extractType` or asks how they work
- Adding, modifying, or debugging modules-related functionality
- Tracing call chains that pass through the modules layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `core/src/languages/modules/typescript.ts` | `resolveRelative`, `resolveImport`, `isExported`, `extractType` | 3 exported |
| `core/src/languages/modules/c.ts` | `resolveImport`, `isExported`, `extractType` | 3 exported |
| `core/src/languages/modules/cpp.ts` | `resolveImport`, `isExported`, `extractType` | 3 exported |
| `core/src/languages/modules/csharp.ts` | `resolveImport`, `isExported`, `extractType` | 3 exported |
| `core/src/languages/modules/dart.ts` | `resolveImport`, `isExported`, `extractType` | 3 exported |
| `core/src/languages/modules/go.ts` | `resolveImport`, `isExported`, `extractType` | 3 exported |
| `core/src/languages/modules/java.ts` | `resolveImport`, `isExported`, `extractType` | 3 exported |
| `core/src/languages/modules/kotlin.ts` | `resolveImport`, `isExported`, `extractType` | 3 exported |
| `core/src/languages/modules/php.ts` | `resolveImport`, `isExported`, `extractType` | 3 exported |
| `core/src/languages/modules/python.ts` | `resolveImport`, `isExported`, `extractType` | 3 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`resolveImport`** `(method)` → `core/src/languages/modules/c.ts:14`
- **`isExported`** `(method)` → `core/src/languages/modules/c.ts:20`
- **`extractType`** `(method)` → `core/src/languages/modules/c.ts:24`
- **`resolveImport`** `(method)` → `core/src/languages/modules/cpp.ts:14`
- **`isExported`** `(method)` → `core/src/languages/modules/cpp.ts:20`
- **`extractType`** `(method)` → `core/src/languages/modules/cpp.ts:24`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `resolveImport` | method | 5 | 1 | `modules/typescript.ts` |
| `extractType` | method | 4 | 0 | `modules/typescript.ts` |
| `resolveRelative` | function | 1 | 1 | `modules/typescript.ts` |
| `resolveImport` | method | 0 | 1 | `modules/c.ts` |
| `resolveImport` | method | 0 | 1 | `modules/cpp.ts` |
| `resolveImport` | method | 0 | 1 | `modules/dart.ts` |
| `resolveImport` | method | 0 | 1 | `modules/python.ts` |
| `isExported` | method | 0 | 0 | `modules/c.ts` |
| `extractType` | method | 0 | 0 | `modules/c.ts` |
| `isExported` | method | 0 | 0 | `modules/cpp.ts` |
| `extractType` | method | 0 | 0 | `modules/cpp.ts` |
| `resolveImport` | method | 0 | 0 | `modules/csharp.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect resolveImport
# Blast radius for entry point
code-intel impact resolveImport
# Search this area
code-intel search "modules"
```
