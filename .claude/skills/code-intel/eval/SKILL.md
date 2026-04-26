---
name: eval
description: "Covers the **eval** subsystem of code-intel-platform. 25 symbols across 6 files. Key symbols: `check`, `blockCount`, `baselineAnswer`. Internal call density: 0.9 calls/symbol."
---

# eval

> **25 symbols** | **6 files** | path: `eval/` | call density: 0.9/sym

## When to Use

Load this skill when:
- The task involves code in `eval/`
- The user mentions `check`, `blockCount`, `baselineAnswer` or asks how they work
- Adding, modifying, or debugging eval-related functionality
- Tracing call chains that pass through the eval layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `eval/run-agent-bench.mjs` | `runCLI`, `grepFile`, `readFile`, `score` +(3) | internal |
| `eval/run-eval.mjs` | `pass`, `fail`, `run`, `check` +(1) | internal |
| `eval/run-eval-langs.mjs` | `runCLI`, `pass`, `fail`, `check` | internal |
| `eval/run-mcp-bench.mjs` | `McpClient`, `pass`, `fail`, `bench` | internal |
| `eval/run-eval-multi.mjs` | `pass`, `fail`, `run` | internal |
| `eval/summarize.mjs` | `col`, `col2` | internal |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `check` | function | 2 | 4 | `eval/run-eval.mjs` |
| `blockCount` | function | 0 | 4 | `eval/run-eval.mjs` |
| `baselineAnswer` | function | 1 | 2 | `eval/run-agent-bench.mjs` |
| `col` | function | 0 | 3 | `eval/run-agent-bench.mjs` |
| `check` | function | 0 | 3 | `eval/run-eval-langs.mjs` |
| `bench` | function | 0 | 3 | `eval/run-mcp-bench.mjs` |
| `runCLI` | function | 2 | 0 | `eval/run-agent-bench.mjs` |
| `readFile` | function | 2 | 0 | `eval/run-agent-bench.mjs` |
| `score` | function | 1 | 1 | `eval/run-agent-bench.mjs` |
| `enhancedAnswer` | function | 1 | 1 | `eval/run-agent-bench.mjs` |
| `run` | function | 0 | 2 | `eval/run-eval-multi.mjs` |
| `pass` | function | 2 | 0 | `eval/run-eval.mjs` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect check
# Blast radius for entry point
code-intel impact check
# Search this area
code-intel search "eval"
```
