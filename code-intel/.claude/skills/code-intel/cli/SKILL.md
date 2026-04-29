---
name: cli
description: "Covers the **cli** subsystem of code-intel. 23 symbols across 3 files. Key symbols: `loadOrAnalyzeWorkspace`, `analyzeWorkspace`, `buildAreaMap`. Internal call density: 0.4 calls/symbol."
---

# cli

> **23 symbols** | **3 files** | path: `core/src/cli/` | call density: 0.4/sym

## When to Use

Load this skill when:
- The task involves code in `core/src/cli/`
- The user mentions `loadOrAnalyzeWorkspace`, `analyzeWorkspace`, `buildAreaMap` or asks how they work
- Adding, modifying, or debugging cli-related functionality
- Tracing call chains that pass through the cli layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `core/src/cli/main.ts` | `analyzeWorkspace`, `renderBar`, `clearBar`, `startSpinner` +(6) | internal |
| `core/src/cli/skill-writer.ts` | `SkillSummary`, `AreaInfo`, `writeSkillFiles`, `buildAreaMap` +(4) | 2 exported |
| `core/src/cli/context-writer.ts` | `ContextStats`, `writeContextFiles`, `buildBlock`, `upsertFile` +(1) | 2 exported |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `loadOrAnalyzeWorkspace` | function | 1 | 9 | `cli/main.ts` |
| `analyzeWorkspace` | function | 2 | 7 | `cli/main.ts` |
| `buildAreaMap` | function | 1 | 7 | `cli/skill-writer.ts` |
| `renderSkill` | function | 1 | 7 | `cli/skill-writer.ts` |
| `writeContextFiles` | function | 2 | 2 | `cli/context-writer.ts` |
| `writeSkillFiles` | function | 1 | 3 | `cli/skill-writer.ts` |
| `softDeleteCodeIntel` | function | 1 | 2 | `cli/main.ts` |
| `purgeStaleTrashes` | function | 1 | 2 | `cli/main.ts` |
| `buildBlock` | function | 1 | 1 | `cli/context-writer.ts` |
| `upsertFile` | function | 1 | 1 | `cli/context-writer.ts` |
| `uniqueKebab` | function | 1 | 1 | `cli/skill-writer.ts` |
| `findLineMarker` | function | 1 | 0 | `cli/context-writer.ts` |

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
