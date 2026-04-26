---
name: state
description: "Covers the **state** subsystem of code-intel-platform. 9 symbols across 2 files. Key symbols: `AppProvider`. Internal call density: 0 calls/symbol."
---

# state

> **9 symbols** | **2 files** | path: `code-intel/web/src/state/` | call density: 0/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/web/src/state/`
- The user mentions `AppProvider` or asks how they work
- Adding, modifying, or debugging state-related functionality
- Tracing call chains that pass through the state layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/web/src/state/types.ts` | `SearchResult`, `ChatCitation`, `ChatToolCall`, `ChatMessage` +(2) | 6 exported |
| `code-intel/web/src/state/app-context.tsx` | `reducer`, `AppProvider`, `useAppState` | 2 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`AppProvider`** `(function)` → `code-intel/web/src/state/app-context.tsx:100`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `useAppState` | function | 12 | 0 | `state/app-context.tsx` |
| `reducer` | function | 0 | 1 | `state/app-context.tsx` |
| `AppProvider` | function | 0 | 0 | `state/app-context.tsx` |
| `SearchResult` | interface | 0 | 0 | `state/types.ts` |
| `ChatCitation` | interface | 0 | 0 | `state/types.ts` |
| `ChatToolCall` | interface | 0 | 0 | `state/types.ts` |
| `ChatMessage` | interface | 0 | 0 | `state/types.ts` |
| `FilterState` | interface | 0 | 0 | `state/types.ts` |
| `AppState` | interface | 0 | 0 | `state/types.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect useAppState
# Blast radius for entry point
code-intel impact AppProvider
# Search this area
code-intel search "state"
```
