---
name: http-2
description: "Covers the **http** subsystem of code-intel-platform. 14 symbols across 2 files. Key symbols: `createApp`, `loadRepoGraph`, `ensureVectorIndex`. Internal call density: 0.4 calls/symbol."
---

# http

> **14 symbols** | **2 files** | path: `code-intel/core/src/http/` | call density: 0.4/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/http/`
- The user mentions `createApp`, `loadRepoGraph`, `ensureVectorIndex` or asks how they work
- Adding, modifying, or debugging http-related functionality
- Tracing call chains that pass through the http layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/http/app.ts` | `getAllowedOrigins`, `createDefaultLimiter`, `createApp`, `durationSec` +(5) | 2 exported |
| `code-intel/core/src/http/websocket-auth.ts` | `WebSocketUser`, `verifyWebSocketHandshake`, `cookieHeader`, `authHeader` +(1) | 2 exported |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `createApp` | function | 7 | 6 | `http/app.ts` |
| `loadRepoGraph` | function | 2 | 4 | `http/app.ts` |
| `ensureVectorIndex` | function | 1 | 4 | `http/app.ts` |
| `startHttpServer` | function | 1 | 3 | `http/app.ts` |
| `lookupTokenUser` | function | 2 | 1 | `http/websocket-auth.ts` |
| `getGraphForRepo` | function | 1 | 1 | `http/app.ts` |
| `embedder` | function | 2 | 0 | `http/app.ts` |
| `cookieHeader` | function | 0 | 2 | `http/websocket-auth.ts` |
| `getAllowedOrigins` | function | 1 | 0 | `http/app.ts` |
| `createDefaultLimiter` | function | 1 | 0 | `http/app.ts` |
| `verifyWebSocketHandshake` | function | 1 | 0 | `http/websocket-auth.ts` |
| `authHeader` | function | 0 | 1 | `http/websocket-auth.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect createApp
# Blast radius for entry point
code-intel impact createApp
# Search this area
code-intel search "http"
```
