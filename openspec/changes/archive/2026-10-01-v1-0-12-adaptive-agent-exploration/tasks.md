# Tasks: Adaptive Agent Exploration

## 1. Explore orchestration
- [x] Create `code-intel/core/src/query/explore.ts` with request/result contracts, intent selection, bounded expansion, and coverage aggregation.
- [x] Add `code-intel/core/tests/unit/query/explore.test.ts` for all six intents, empty/partial evidence, deterministic ordering, and hard work limits.
- [x] Reuse existing scoped search, path/flow, API-contract, PR/test, security and context services.
- [x] Start with the current index; add optional `ReadIndexView` binding only after the ref-aware foundation is available.

## 2. Graph-aware reranking
- [x] Create `search/graph-reranker.ts` with a versioned deterministic scorer.
- [x] Include lexical/vector, exact identity, graph/path/flow, API, certainty/ambiguity, generated/test/config path features.
- [x] Add negative tests proving ambiguous edges cannot become exact ranking evidence.
- [x] Add optional top-contribution diagnostics without expanding default MCP output.

## 3. Render policy
- [x] Create `context/render-policy.ts` and the five render modes.
- [x] Create `context/skeletonizer.ts` with per-language capability declarations.
- [x] Modify `context/builder.ts` to accept an optional render plan while preserving legacy defaults.
- [x] Extend `context/session.ts` so references include selected index/snapshot identity.
- [x] Add Unicode, overload/polymorphism, unsupported-language, stale-session, and budget tests.
- [x] Enable each skeleton capability row only after its syntax-preservation fixtures pass; otherwise retain snippet/signature fallback.

## 4. Public surfaces
- [x] Add `explore` MCP schema/handler.
- [x] Add `code-intel explore` CLI.
- [x] Add `POST /api/v1/explore` and OpenAPI schema.
- [x] Prove all transports call the same orchestrator.

## 5. Evaluation
- [x] Extend agent benchmark with paired baseline-vs-Explore cases.
- [x] Gate >=25% median token reduction with <=2pp correctness regression.
- [x] Record structural counters and rerank/render latency.
- [x] Produce language skeleton capability matrix; unsupported rows must safely fall back.

## 6. Release
- [x] Update README/MCP docs only after behavior matches spec.
- [x] Run typecheck, core/Web/e2e, evaluation, packaging and release validation.
