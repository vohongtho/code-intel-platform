---
name: cli
description: "Covers the **cli** subsystem of code-intel-platform. 14 symbols across 3 files. Key symbols: `analyzeWorkspace`, `writeSkillFiles`, `writeContextFiles`. Internal call density: 0.7 calls/symbol."
---

# cli

> **14 symbols** | **3 files** | path: `code-intel/core/src/cli/` | call density: 0.7/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/cli/`
- The user mentions `analyzeWorkspace`, `writeSkillFiles`, `writeContextFiles` or asks how they work
- Adding, modifying, or debugging cli-related functionality
- Tracing call chains that pass through the cli layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/cli/skill-writer.ts` | `SkillSummary`, `AreaInfo`, `writeSkillFiles`, `buildAreaMap` +(4) | 2 exported |
| `code-intel/core/src/cli/context-writer.ts` | `ContextStats`, `writeContextFiles`, `buildBlock`, `upsertFile` +(1) | 2 exported |
| `code-intel/core/src/cli/main.ts` | `analyzeWorkspace` | internal |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `analyzeWorkspace` | function | 0 | 16 | `cli/main.ts` |
| `writeSkillFiles` | function | 1 | 4 | `cli/skill-writer.ts` |
| `writeContextFiles` | function | 1 | 2 | `cli/context-writer.ts` |
| `buildAreaMap` | function | 1 | 2 | `cli/skill-writer.ts` |
| `upsertFile` | function | 1 | 1 | `cli/context-writer.ts` |
| `renderSkill` | function | 1 | 1 | `cli/skill-writer.ts` |
| `buildBlock` | function | 1 | 0 | `cli/context-writer.ts` |
| `findLineMarker` | function | 1 | 0 | `cli/context-writer.ts` |
| `uniqueKebab` | function | 1 | 0 | `cli/skill-writer.ts` |
| `relPath` | function | 1 | 0 | `cli/skill-writer.ts` |
| `relFile` | function | 1 | 0 | `cli/skill-writer.ts` |
| `ContextStats` | interface | 0 | 0 | `cli/context-writer.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect analyzeWorkspace
# Blast radius for entry point
code-intel impact analyzeWorkspace
# Search this area
code-intel search "cli"
```
