# Proposal: Make Retrieval Contracts Truthful, Bounded, and Explainable

## Intent

Ensure search and context responses describe what the platform actually did, obey declared limits, and provide opt-in evidence for debugging ranking quality.

## Why

Version 1.0.7 exposes two correctness-contract failures:

1. Repo-scoped `mode=vector` calls hybrid BM25+vector retrieval but can report top-level `searchMode: vector`.
2. Context `max_tokens` is described as a whole-document limit, but summary, logic, and relation blocks can exceed their allocated budgets because only focus code is actually trimmed.

These failures can cause agents and clients to assume a result is semantic-only when lexical ranking influenced it, receive a context payload larger than requested, and lose relevant content through uncontrolled downstream truncation.

## What changes

### Explicit requested and actual search modes

Search responses add `requestedMode`, `actualMode`, optional `fallbackReason`, `vectorReady`, and compatibility alias `searchMode` equal to `actualMode`.

Execution semantics become:

- `bm25`: lexical retrieval only.
- `vector`: vector only when available and successful; BM25 fallback otherwise.
- `auto`: hybrid BM25+vector when vector succeeds; BM25 fallback otherwise.
- legacy request `hybrid`: accepted by compatibility paths and normalized to `auto`.

### Stable fallback diagnostics

Vector availability and query failures return explicit reasons instead of collapsing into `null` or an empty array.

### Explainable search

Optional `explain: true` returns bounded per-result evidence: lexical rank/score, vector rank/similarity, RRF contribution/final score, matched lexical fields and terms where available, fallback reason, and channel availability.

### Hard context budget

All context blocks become budget-aware. The invariant is `blockTokens.total <= maxTokens` for every accepted request. Responses include `maxTokens`, per-block token counts, `truncated`, and `truncatedBlocks`.

### Shared transport contracts

CLI, HTTP, MCP, group search, and web types consume the same search execution and context types.

## Compatibility

- `searchMode` remains in v1.0.8 and equals `actualMode`.
- `hybrid` is deprecated in favor of `auto` but remains accepted by compatibility paths.
- `explain` defaults to false.
- Existing context block strings remain.
- Invalid `max_tokens` produces a structured validation error.

## Non-goals

- Replacing BM25, embeddings, or RRF.
- Exposing raw embeddings.
- LLM reranking.
- Persisting search explanations.
- Redesigning the full search UI.

## Success measures

- Search metadata never contradicts execution.
- Every requested/actual/fallback matrix case has a test.
- RRF final score can be reproduced from explanation fields.
- `explain=false` retains compact responses.
- Every accepted context response measures at or below its normalized maximum.
