---
name: eval
description: "Covers the **eval** subsystem of code-intel-platform. 29 symbols across 6 files. Key symbols: `run`, `start`, `call`. Internal call density: 0.2 calls/symbol. Participates in 1 execution flow(s)."
---

# eval

> **29 symbols** | **6 files** | path: `eval/` | call density: 0.2/sym

## When to Use

Load this skill when:
- The task involves code in `eval/`
- The user mentions `run`, `start`, `call` or asks how they work
- Adding, modifying, or debugging eval-related functionality
- Tracing call chains that pass through the eval layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `eval/run-mcp-bench.mjs` | `McpClient`, `constructor`, `start`, `_sendRaw` +(5) | internal |
| `eval/run-agent-bench.mjs` | `runCLI`, `grepFile`, `readFile`, `score` +(3) | internal |
| `eval/run-eval-langs.mjs` | `runCLI`, `pass`, `fail`, `check` | internal |
| `eval/run-eval.mjs` | `pass`, `fail`, `run`, `check` | internal |
| `eval/run-eval-multi.mjs` | `pass`, `fail`, `run` | internal |
| `eval/summarize.mjs` | `col`, `col2` | internal |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `run` | function | 17 | 0 | `eval/run-eval.mjs` |
| `start` | method | 5 | 7 | `eval/run-mcp-bench.mjs` |
| `call` | method | 3 | 5 | `eval/run-mcp-bench.mjs` |
| `bench` | function | 1 | 4 | `eval/run-mcp-bench.mjs` |
| `baselineAnswer` | function | 1 | 3 | `eval/run-agent-bench.mjs` |
| `stop` | method | 4 | 0 | `eval/run-mcp-bench.mjs` |
| `readFile` | function | 3 | 0 | `eval/run-agent-bench.mjs` |
| `enhancedAnswer` | function | 1 | 2 | `eval/run-agent-bench.mjs` |
| `runCLI` | function | 2 | 0 | `eval/run-agent-bench.mjs` |
| `pass` | function | 1 | 1 | `eval/run-eval-langs.mjs` |
| `fail` | function | 1 | 1 | `eval/run-eval-langs.mjs` |
| `pass` | function | 1 | 1 | `eval/run-eval.mjs` |

## Execution Flows

**1** execution path(s) pass through this area.
Run `code-intel inspect <symbol>` on a hot symbol to trace the full call chain.

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect run
# Blast radius for entry point
code-intel impact run
# Search this area
code-intel search "eval"
```
