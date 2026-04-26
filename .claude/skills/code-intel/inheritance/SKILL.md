---
name: inheritance
description: "Covers the **inheritance** subsystem of code-intel-platform. 8 symbols across 3 files. Key symbols: `buildHeritageEdges`, `detectOverrides`. Internal call density: 0.5 calls/symbol."
---

# inheritance

> **8 symbols** | **3 files** | path: `code-intel/core/src/inheritance/` | call density: 0.5/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/inheritance/`
- The user mentions `buildHeritageEdges`, `detectOverrides` or asks how they work
- Adding, modifying, or debugging inheritance-related functionality
- Tracing call chains that pass through the inheritance layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/inheritance/mro-walker.ts` | `computeMRO`, `depthFirstMRO`, `c3Linearize`, `linearize` +(1) | 1 exported |
| `code-intel/core/src/inheritance/heritage-builder.ts` | `HeritageInfo`, `buildHeritageEdges` | 2 exported |
| `code-intel/core/src/inheritance/override-detector.ts` | `detectOverrides` | 1 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`buildHeritageEdges`** `(function)` → `code-intel/core/src/inheritance/heritage-builder.ts:11`
- **`detectOverrides`** `(function)` → `code-intel/core/src/inheritance/override-detector.ts:5`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `computeMRO` | function | 1 | 3 | `inheritance/mro-walker.ts` |
| `depthFirstMRO` | function | 2 | 1 | `inheritance/mro-walker.ts` |
| `linearize` | function | 0 | 2 | `inheritance/mro-walker.ts` |
| `mixinAwareMRO` | function | 1 | 1 | `inheritance/mro-walker.ts` |
| `buildHeritageEdges` | function | 0 | 1 | `inheritance/heritage-builder.ts` |
| `c3Linearize` | function | 1 | 0 | `inheritance/mro-walker.ts` |
| `detectOverrides` | function | 0 | 1 | `inheritance/override-detector.ts` |
| `HeritageInfo` | interface | 0 | 0 | `inheritance/heritage-builder.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect computeMRO
# Blast radius for entry point
code-intel impact buildHeritageEdges
# Search this area
code-intel search "inheritance"
```
