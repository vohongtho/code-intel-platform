---
name: shared
description: "Covers the **shared** subsystem of code-intel-platform. 7 symbols across 4 files. Key symbols: `detectLanguage`, `getSupportedExtensions`. Internal call density: 0 calls/symbol."
---

# shared

> **7 symbols** | **4 files** | path: `code-intel/core/src/shared/` | call density: 0/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/shared/`
- The user mentions `detectLanguage`, `getSupportedExtensions` or asks how they work
- Adding, modifying, or debugging shared-related functionality
- Tracing call chains that pass through the shared layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/shared/detection.ts` | `detectLanguage`, `getSupportedExtensions` | 2 exported |
| `code-intel/core/src/shared/graph-types.ts` | `CodeNode`, `CodeEdge` | 2 exported |
| `code-intel/core/src/shared/pipeline-types.ts` | `PipelineProgress`, `PipelineResult` | 2 exported |
| `code-intel/core/src/shared/languages.ts` | `Language` | 1 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`detectLanguage`** `(function)` → `code-intel/core/src/shared/detection.ts:33`
- **`getSupportedExtensions`** `(function)` → `code-intel/core/src/shared/detection.ts:38`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `detectLanguage` | function | 0 | 0 | `shared/detection.ts` |
| `getSupportedExtensions` | function | 0 | 0 | `shared/detection.ts` |
| `CodeNode` | interface | 0 | 0 | `shared/graph-types.ts` |
| `CodeEdge` | interface | 0 | 0 | `shared/graph-types.ts` |
| `Language` | enum | 0 | 0 | `shared/languages.ts` |
| `PipelineProgress` | interface | 0 | 0 | `shared/pipeline-types.ts` |
| `PipelineResult` | interface | 0 | 0 | `shared/pipeline-types.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect detectLanguage
# Blast radius for entry point
code-intel impact detectLanguage
# Search this area
code-intel search "shared"
```
