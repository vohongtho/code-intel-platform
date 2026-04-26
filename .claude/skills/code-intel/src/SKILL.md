---
name: src
description: "Covers the **src** subsystem of code-intel-platform. 7 symbols across 4 files. Key symbols: `detectLanguage`, `getSupportedExtensions`, `CodeNode`. Internal call density: 0 calls/symbol."
---

# src

> **7 symbols** | **4 files** | path: `code-intel/shared/src/` | call density: 0/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/shared/src/`
- The user mentions `detectLanguage`, `getSupportedExtensions`, `CodeNode` or asks how they work
- Adding, modifying, or debugging src-related functionality
- Tracing call chains that pass through the src layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/shared/src/detection.ts` | `detectLanguage`, `getSupportedExtensions` | 2 exported |
| `code-intel/shared/src/graph-types.ts` | `CodeNode`, `CodeEdge` | 2 exported |
| `code-intel/shared/src/pipeline-types.ts` | `PipelineProgress`, `PipelineResult` | 2 exported |
| `code-intel/shared/src/languages.ts` | `Language` | 1 exported |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `detectLanguage` | function | 4 | 0 | `src/detection.ts` |
| `getSupportedExtensions` | function | 2 | 0 | `src/detection.ts` |
| `CodeNode` | interface | 0 | 0 | `src/graph-types.ts` |
| `CodeEdge` | interface | 0 | 0 | `src/graph-types.ts` |
| `Language` | enum | 0 | 0 | `src/languages.ts` |
| `PipelineProgress` | interface | 0 | 0 | `src/pipeline-types.ts` |
| `PipelineResult` | interface | 0 | 0 | `src/pipeline-types.ts` |

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
code-intel search "src"
```
