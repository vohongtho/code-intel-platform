# Design: Adaptive Agent Exploration

## Existing control flow
Today clients commonly execute `search -> inspect/find_path -> context`. `context/builder.ts` owns allocation/rendering; `hybrid-search.ts` owns BM25/vector fusion. The design keeps those owners.

## New modules
- `code-intel/core/src/query/explore.ts` — transport-independent orchestrator.
- `code-intel/core/src/search/graph-reranker.ts` — deterministic second-stage feature scorer.
- `code-intel/core/src/context/render-policy.ts` — source-mode assignment and budget weights.
- `code-intel/core/src/context/skeletonizer.ts` — language-capability-gated structural rendering.

Modify `context/builder.ts`, `context/session.ts`, `search/hybrid-search.ts`, MCP definitions/server, CLI app, HTTP app/OpenAPI.

## Pipeline
```text
task
 -> intent
 -> scoped hybrid retrieval
 -> graph-aware rerank
 -> seed resolution
 -> bounded intent expansion
 -> render policy
 -> existing context builder
 -> coverage/trust/omission aggregation
```

Implement the transport-independent orchestrator against current-index services first. Integrate `ReadIndexView` only after the ref-aware foundation exists, and introduce each skeleton language row only after syntax-preservation fixtures pass. Public transports are last so they expose one proven orchestrator rather than parallel behavior.

Intent expansion reuses existing services rather than duplicating semantics:
- understand: path/flow/cluster evidence;
- debug: caller/callee/path evidence plus falsification-relevant source;
- change/review: impact, contracts, tests;
- security: security/taint capability and guard evidence;
- api: route/consumer/shape evidence.

## Reranker
Introduce a versioned `GraphRerankFeatureSet`. Contributions are inspectable and stably sorted. Ambiguous/heuristic edges are certainty-bounded. Missing graph evidence cannot erase otherwise relevant lexical/vector candidates.

## Render policy
```ts
type ContextRenderMode = 'full' | 'snippet' | 'signature' | 'skeleton' | 'reference';
```
A render decision includes canonical node ID, mode, token allocation, reason, and capability boundary if degraded.

Skeleton output preserves declaration signature, selected control headings, selected flow-spine calls, relevant return/throw statements, and source location. Unsupported constructs return `unsupported`, not best-effort corrupted text.

## Session freshness
Reuse `ContextDeliverySession` and `contentFingerprint`. A `reference` is valid only when canonical identity, content fingerprint, and selected index/snapshot identity match.

## Ref integration
When `v1-0-12-ref-aware-portable-indexes` is available, Explore accepts optional `ref` and binds all subqueries to one `ReadIndexView`. Until then it uses the current index and reports alternate-ref capability unavailable.

## Failure semantics
- vector unavailable -> BM25 + graph rerank;
- graph path missing -> candidate remains without invented path;
- skeleton unsupported -> snippet/signature;
- session stale -> resend source;
- budget exhausted -> omission receipts;
- incomplete semantic evidence -> coverage boundary retained.

## Observability
Counters: candidate counts, graph lookups, render-mode distribution, tokens requested/delivered/saved, skeleton fallback, omissions, per-stage duration. No raw source/task telemetry by default.

## Tests
Add `tests/unit/query/explore.test.ts`, `tests/unit/search/graph-reranker.test.ts`, `tests/unit/context/render-policy.test.ts`, `tests/unit/context/skeletonizer.test.ts`; extend builder/session tests; add MCP/CLI/HTTP integration and paired `eval/run-agent-bench.mjs` cases.

## Alternatives rejected
- replacing all specialized tools with one tool;
- default remote/LLM reranking;
- regex skeletonization across all languages;
- separate Explore index.
