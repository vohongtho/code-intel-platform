---
name: shared
description: "Covers the **shared** subsystem of code-intel-platform. 31 symbols across 7 files. Key symbols: `detectLanguage`, `getSupportedExtensions`. Internal call density: 0.5 calls/symbol. Participates in 8 execution flow(s)."
---

# shared

> **31 symbols** | **7 files** | path: `code-intel/core/src/shared/` | call density: 0.5/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/shared/`
- The user mentions `detectLanguage`, `getSupportedExtensions` or asks how they work
- Adding, modifying, or debugging shared-related functionality
- Tracing call chains that pass through the shared layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/shared/logger.ts` | `getActiveTraceCtx`, `Logger`, `maskSensitiveData`, `maskSensitive` +(7) | internal |
| `code-intel/core/src/shared/config-validator.ts` | `ConfigValidationError`, `ConfigValidationResult`, `isSecretKey`, `looksLikeEnvRef` +(5) | 6 exported |
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
| `resolve` | function | 51 | 2 | `shared/config-validator.ts` |
| `warn` | method | 31 | 1 | `shared/logger.ts` |
| `error` | method | 16 | 1 | `shared/logger.ts` |
| `getLogger` | method | 5 | 2 | `shared/logger.ts` |
| `secureMkdir` | function | 5 | 0 | `shared/fs-secure.ts` |
| `walk` | function | 1 | 3 | `shared/config-validator.ts` |
| `assertNoPlaintextSecrets` | function | 3 | 1 | `shared/config-validator.ts` |
| `secureChmodFile` | function | 4 | 0 | `shared/fs-secure.ts` |
| `secureWriteFile` | function | 2 | 2 | `shared/fs-secure.ts` |
| `deepMask` | function | 0 | 4 | `shared/logger.ts` |
| `validateConfigForSecrets` | function | 2 | 1 | `shared/config-validator.ts` |
| `maskSensitiveData` | method | 3 | 0 | `shared/logger.ts` |

## Execution Flows

**8** execution path(s) pass through this area.
Run `code-intel inspect <symbol>` on a hot symbol to trace the full call chain.

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
