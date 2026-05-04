---
name: src
description: "Covers the **src** subsystem of code-intel-platform. 26 symbols across 1 files. Key symbols: `activate`, `deactivate`. Internal call density: 1 calls/symbol."
---

# src

> **26 symbols** | **1 files** | path: `extensions/vscode/src/` | call density: 1/sym

## When to Use

Load this skill when:
- The task involves code in `extensions/vscode/src/`
- The user mentions `activate`, `deactivate` or asks how they work
- Adding, modifying, or debugging src-related functionality
- Tracing call chains that pass through the src layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `extensions/vscode/src/extension.ts` | `getServerUrl`, `getToken`, `authHeaders`, `GraphNode` +(22) | 2 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`activate`** `(function)` → `extensions/vscode/src/extension.ts:272`
- **`deactivate`** `(function)` → `extensions/vscode/src/extension.ts:407`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `update` | method | 19 | 2 | `src/extension.ts` |
| `activate` | function | 0 | 12 | `src/extension.ts` |
| `getServerUrl` | function | 5 | 0 | `src/extension.ts` |
| `authHeaders` | function | 4 | 1 | `src/extension.ts` |
| `apiSearch` | function | 2 | 3 | `src/extension.ts` |
| `apiHealth` | function | 2 | 3 | `src/extension.ts` |
| `constructor` | method | 3 | 2 | `src/extension.ts` |
| `apiNodeDetail` | function | 1 | 3 | `src/extension.ts` |
| `apiFileSymbols` | function | 1 | 3 | `src/extension.ts` |
| `provideHover` | method | 0 | 4 | `src/extension.ts` |
| `refresh` | method | 3 | 1 | `src/extension.ts` |
| `loadSymbols` | method | 2 | 1 | `src/extension.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect update
# Blast radius for entry point
code-intel impact activate
# Search this area
code-intel search "src"
```
