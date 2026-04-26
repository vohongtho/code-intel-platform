---
name: mcp-server
description: "Covers the **mcp-server** subsystem of code-intel-platform. 10 symbols across 1 files. Key symbols: `baseRef`, `minConf`, `limit`. Internal call density: 0.4 calls/symbol."
---

# mcp-server

> **10 symbols** | **1 files** | path: `code-intel/core/src/mcp-server/` | call density: 0.4/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/mcp-server/`
- The user mentions `baseRef`, `minConf`, `limit` or asks how they work
- Adding, modifying, or debugging mcp-server-related functionality
- Tracing call chains that pass through the mcp-server layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/mcp-server/server.ts` | `createMcpServer`, `a`, `limit`, `direction` +(6) | 2 exported |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `baseRef` | function | 0 | 7 | `mcp-server/server.ts` |
| `minConf` | function | 0 | 5 | `mcp-server/server.ts` |
| `limit` | function | 0 | 2 | `mcp-server/server.ts` |
| `maxHops` | function | 0 | 2 | `mcp-server/server.ts` |
| `startMcpStdio` | function | 1 | 1 | `mcp-server/server.ts` |
| `findNodeByName` | function | 2 | 0 | `mcp-server/server.ts` |
| `createMcpServer` | function | 1 | 0 | `mcp-server/server.ts` |
| `a` | function | 0 | 1 | `mcp-server/server.ts` |
| `parseDiff` | function | 1 | 0 | `mcp-server/server.ts` |
| `direction` | function | 0 | 0 | `mcp-server/server.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect baseRef
# Blast radius for entry point
code-intel impact baseRef
# Search this area
code-intel search "mcp-server"
```
