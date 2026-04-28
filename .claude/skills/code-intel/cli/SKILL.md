---
name: cli
description: "Covers the **cli** subsystem of code-intel-platform. 26 symbols across 3 files. Key symbols: `loadOrAnalyzeWorkspace`, `writeContextFiles`, `buildAreaMap`. Internal call density: 0.3 calls/symbol."
---

# cli

> **26 symbols** | **3 files** | path: `code-intel/core/src/cli/` | call density: 0.3/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/cli/`
- The user mentions `loadOrAnalyzeWorkspace`, `writeContextFiles`, `buildAreaMap` or asks how they work
- Adding, modifying, or debugging cli-related functionality
- Tracing call chains that pass through the cli layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/cli/main.ts` | `analyzeWorkspace`, `renderBar`, `pctStr`, `clearBar` +(8) | internal |
| `code-intel/core/src/cli/skill-writer.ts` | `SkillSummary`, `AreaInfo`, `writeSkillFiles`, `buildAreaMap` +(4) | 2 exported |
| `code-intel/core/src/cli/context-writer.ts` | `ContextStats`, `writeContextFiles`, `buildBlock`, `upsertFile` +(2) | 2 exported |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `loadOrAnalyzeWorkspace` | function | 1 | 7 | `cli/main.ts` |
| `writeContextFiles` | function | 2 | 2 | `cli/context-writer.ts` |
| `buildAreaMap` | function | 1 | 2 | `cli/skill-writer.ts` |
| `upsertFile` | function | 1 | 1 | `cli/context-writer.ts` |
| `analyzeWorkspace` | function | 2 | 0 | `cli/main.ts` |
| `softDeleteCodeIntel` | function | 1 | 1 | `cli/main.ts` |
| `renderSkill` | function | 1 | 1 | `cli/skill-writer.ts` |
| `buildBlock` | function | 1 | 0 | `cli/context-writer.ts` |
| `findLineMarker` | function | 1 | 0 | `cli/context-writer.ts` |
| `renderBar` | function | 1 | 0 | `cli/main.ts` |
| `clearBar` | function | 1 | 0 | `cli/main.ts` |
| `startSpinner` | function | 1 | 0 | `cli/main.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect loadOrAnalyzeWorkspace
# Blast radius for entry point
code-intel impact loadOrAnalyzeWorkspace
# Search this area
code-intel search "cli"
```
