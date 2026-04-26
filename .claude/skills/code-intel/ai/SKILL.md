---
name: ai
description: "Covers the **ai** subsystem of code-intel-platform. 7 symbols across 1 files. Key symbols: `runAgent`, `hybridSearch`, `parseIntent`. Internal call density: 0.4 calls/symbol."
---

# ai

> **7 symbols** | **1 files** | path: `code-intel/web/src/ai/` | call density: 0.4/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/web/src/ai/`
- The user mentions `runAgent`, `hybridSearch`, `parseIntent` or asks how they work
- Adding, modifying, or debugging ai-related functionality
- Tracing call chains that pass through the ai layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/web/src/ai/agent.ts` | `AgentStreamEvent`, `Intent`, `parseIntent`, `citationFor` +(3) | 2 exported |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `runAgent` | function | 1 | 1 | `ai/agent.ts` |
| `hybridSearch` | function | 0 | 2 | `ai/agent.ts` |
| `parseIntent` | function | 1 | 0 | `ai/agent.ts` |
| `citationFor` | function | 1 | 0 | `ai/agent.ts` |
| `fmtCite` | function | 1 | 0 | `ai/agent.ts` |
| `AgentStreamEvent` | interface | 0 | 0 | `ai/agent.ts` |
| `Intent` | interface | 0 | 0 | `ai/agent.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect runAgent
# Blast radius for entry point
code-intel impact runAgent
# Search this area
code-intel search "ai"
```
