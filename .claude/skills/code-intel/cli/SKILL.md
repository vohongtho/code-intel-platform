---
name: cli
description: "Covers the **cli** subsystem of code-intel-platform. 36 symbols across 4 files. Key symbols: `loadOrAnalyzeWorkspace`, `analyzeWorkspace`, `buildAreaMap`. Internal call density: 0.3 calls/symbol."
---

# cli

> **36 symbols** | **4 files** | path: `code-intel/core/src/cli/` | call density: 0.3/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/cli/`
- The user mentions `loadOrAnalyzeWorkspace`, `analyzeWorkspace`, `buildAreaMap` or asks how they work
- Adding, modifying, or debugging cli-related functionality
- Tracing call chains that pass through the cli layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/cli/sarif-builder.ts` | `SARIFRegion`, `SARIFArtifactLocation`, `SARIFPhysicalLocation`, `SARIFLocation` +(9) | 13 exported |
| `code-intel/core/src/cli/main.ts` | `analyzeWorkspace`, `renderBar`, `clearBar`, `startSpinner` +(6) | internal |
| `code-intel/core/src/cli/skill-writer.ts` | `SkillSummary`, `AreaInfo`, `writeSkillFiles`, `buildAreaMap` +(4) | 2 exported |
| `code-intel/core/src/cli/context-writer.ts` | `ContextStats`, `writeContextFiles`, `buildBlock`, `upsertFile` +(1) | 2 exported |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `loadOrAnalyzeWorkspace` | function | 1 | 9 | `cli/main.ts` |
| `analyzeWorkspace` | function | 2 | 7 | `cli/main.ts` |
| `buildAreaMap` | function | 1 | 8 | `cli/skill-writer.ts` |
| `renderSkill` | function | 1 | 7 | `cli/skill-writer.ts` |
| `writeSkillFiles` | function | 1 | 4 | `cli/skill-writer.ts` |
| `writeContextFiles` | function | 2 | 2 | `cli/context-writer.ts` |
| `purgeStaleTrashes` | function | 1 | 3 | `cli/main.ts` |
| `buildBlock` | function | 1 | 2 | `cli/context-writer.ts` |
| `softDeleteCodeIntel` | function | 1 | 2 | `cli/main.ts` |
| `buildSARIF` | function | 2 | 1 | `cli/sarif-builder.ts` |
| `upsertFile` | function | 1 | 1 | `cli/context-writer.ts` |
| `uniqueKebab` | function | 1 | 1 | `cli/skill-writer.ts` |

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
