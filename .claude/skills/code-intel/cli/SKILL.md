---
name: cli
description: "Covers the **cli** subsystem of code-intel-platform. 21 symbols across 3 files. Key symbols: `writeContextFiles`, `buildAreaMap`, `upsertFile`. Internal call density: 0.2 calls/symbol."
---

# cli

> **21 symbols** | **3 files** | path: `code-intel/core/src/cli/` | call density: 0.2/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/cli/`
- The user mentions `writeContextFiles`, `buildAreaMap`, `upsertFile` or asks how they work
- Adding, modifying, or debugging cli-related functionality
- Tracing call chains that pass through the cli layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/cli/skill-writer.ts` | `SkillSummary`, `AreaInfo`, `writeSkillFiles`, `buildAreaMap` +(4) | 2 exported |
| `code-intel/core/src/cli/main.ts` | `analyzeWorkspace`, `renderBar`, `pctStr`, `clearBar` +(3) | internal |
| `code-intel/core/src/cli/context-writer.ts` | `ContextStats`, `writeContextFiles`, `buildBlock`, `upsertFile` +(2) | 2 exported |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `writeContextFiles` | function | 2 | 2 | `cli/context-writer.ts` |
| `buildAreaMap` | function | 1 | 2 | `cli/skill-writer.ts` |
| `upsertFile` | function | 1 | 1 | `cli/context-writer.ts` |
| `renderSkill` | function | 1 | 1 | `cli/skill-writer.ts` |
| `buildBlock` | function | 1 | 0 | `cli/context-writer.ts` |
| `findLineMarker` | function | 1 | 0 | `cli/context-writer.ts` |
| `analyzeWorkspace` | function | 1 | 0 | `cli/main.ts` |
| `renderBar` | function | 1 | 0 | `cli/main.ts` |
| `clearBar` | function | 1 | 0 | `cli/main.ts` |
| `startSpinner` | function | 1 | 0 | `cli/main.ts` |
| `stopSpinner` | function | 1 | 0 | `cli/main.ts` |
| `writeSkillFiles` | function | 1 | 0 | `cli/skill-writer.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect writeContextFiles
# Blast radius for entry point
code-intel impact writeContextFiles
# Search this area
code-intel search "cli"
```
