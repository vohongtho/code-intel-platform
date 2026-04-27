---
name: shared
description: "Covers the **shared** subsystem of code-intel-platform. 25 symbols across 7 files. Key symbols: `detectLanguage`, `getSupportedExtensions`. Internal call density: 0.4 calls/symbol."
---

# shared

> **25 symbols** | **7 files** | path: `code-intel/core/src/shared/` | call density: 0.4/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/shared/`
- The user mentions `detectLanguage`, `getSupportedExtensions` or asks how they work
- Adding, modifying, or debugging shared-related functionality
- Tracing call chains that pass through the shared layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/shared/config-validator.ts` | `ConfigValidationError`, `ConfigValidationResult`, `isSecretKey`, `looksLikeEnvRef` +(5) | 5 exported |
| `code-intel/core/src/shared/logger.ts` | `getActiveTraceCtx`, `Logger`, `maskString`, `deepMask` +(1) | internal |
| `code-intel/core/src/shared/fs-secure.ts` | `secureMkdir`, `secureChmodFile`, `secureWriteFile`, `tightenDbFiles` | 4 exported |
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
| `resolve` | function | 29 | 1 | `shared/config-validator.ts` |
| `secureMkdir` | function | 5 | 0 | `shared/fs-secure.ts` |
| `assertNoPlaintextSecrets` | function | 3 | 1 | `shared/config-validator.ts` |
| `secureChmodFile` | function | 4 | 0 | `shared/fs-secure.ts` |
| `secureWriteFile` | function | 2 | 2 | `shared/fs-secure.ts` |
| `validateConfigForSecrets` | function | 2 | 1 | `shared/config-validator.ts` |
| `walk` | function | 1 | 2 | `shared/config-validator.ts` |
| `looksLikeEnvRef` | function | 2 | 0 | `shared/config-validator.ts` |
| `resolveConfigEnvRefs` | function | 1 | 1 | `shared/config-validator.ts` |
| `tightenDbFiles` | function | 2 | 0 | `shared/fs-secure.ts` |
| `maskString` | function | 2 | 0 | `shared/logger.ts` |
| `deepMask` | function | 1 | 1 | `shared/logger.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect resolve
# Blast radius for entry point
code-intel impact detectLanguage
# Search this area
code-intel search "shared"
```
