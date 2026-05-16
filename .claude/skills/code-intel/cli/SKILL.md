---
name: cli
description: "Covers the **cli** subsystem of code-intel-platform. 132 symbols across 9 files. Key symbols: `expandEnvRefs`, `detectEditors`, `parse`. Internal call density: 0.7 calls/symbol."
---

# cli

> **132 symbols** | **9 files** | path: `code-intel/core/src/cli/` | call density: 0.7/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/cli/`
- The user mentions `expandEnvRefs`, `detectEditors`, `parse` or asks how they work
- Adding, modifying, or debugging cli-related functionality
- Tracing call chains that pass through the cli layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/cli/main.ts` | `ensureGitignore`, `analyzeWorkspace`, `renderBar`, `clearBar` +(26) | internal |
| `code-intel/core/src/cli/init-wizard.ts` | `CodeIntelConfig`, `configExists`, `loadConfig`, `saveConfig` +(22) | 9 exported |
| `code-intel/core/src/cli/config-manager.ts` | `isSensitiveKey`, `maskValue`, `maskConfig`, `getByPath` +(12) | 14 exported |
| `code-intel/core/src/cli/hook-rewriter.ts` | `findCodeIntelDir`, `loadIndexedCommit`, `getHeadCommit`, `runCodeIntelAugment` +(11) | 6 exported |
| `code-intel/core/src/cli/sarif-builder.ts` | `SARIFRegion`, `SARIFArtifactLocation`, `SARIFPhysicalLocation`, `SARIFLocation` +(9) | 13 exported |
| `code-intel/core/src/cli/update-checker.ts` | `UpdateMeta`, `loadMeta`, `saveMeta`, `isNewer` +(6) | 4 exported |
| `code-intel/core/src/cli/completion.ts` | `loadRepoPaths`, `loadGroupNames`, `bashCompletion`, `zshCompletion` +(4) | 2 exported |
| `code-intel/core/src/cli/skill-writer.ts` | `SkillSummary`, `AreaInfo`, `writeSkillFiles`, `buildAreaMap` +(4) | 2 exported |
| `code-intel/core/src/cli/context-writer.ts` | `ContextStats`, `binaryOnPath`, `writeContextFiles`, `buildBlock` +(2) | 2 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`expandEnvRefs`** `(function)` → `code-intel/core/src/cli/config-manager.ts:193`
- **`detectEditors`** `(function)` → `code-intel/core/src/cli/init-wizard.ts:507`
- **`parse`** `(function)` → `code-intel/core/src/cli/update-checker.ts:46`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `runInitWizard` | function | 1 | 15 | `cli/init-wizard.ts` |
| `analyzeWorkspace` | function | 2 | 10 | `cli/main.ts` |
| `rewriteCommand` | function | 5 | 6 | `cli/hook-rewriter.ts` |
| `runClaudeHook` | function | 2 | 8 | `cli/hook-rewriter.ts` |
| `startWatcher` | function | 1 | 9 | `cli/main.ts` |
| `loadOrAnalyzeWorkspace` | function | 1 | 9 | `cli/main.ts` |
| `configSet` | function | 1 | 8 | `cli/config-manager.ts` |
| `buildAreaMap` | function | 1 | 8 | `cli/skill-writer.ts` |
| `backgroundVersionCheck` | function | 1 | 8 | `cli/update-checker.ts` |
| `runUpdate` | function | 1 | 8 | `cli/update-checker.ts` |
| `configGet` | function | 1 | 7 | `cli/config-manager.ts` |
| `renderSkill` | function | 1 | 7 | `cli/skill-writer.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect runInitWizard
# Blast radius for entry point
code-intel impact expandEnvRefs
# Search this area
code-intel search "cli"
```
