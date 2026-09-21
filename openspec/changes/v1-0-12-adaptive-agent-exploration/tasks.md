# Tasks: Adaptive Agent Exploration

## 1. Explore orchestration
- [ ] Create `code-intel/core/src/query/explore.ts` with request/result contracts, intent selection, bounded expansion, and coverage aggregation.
- [ ] Add `code-intel/core/tests/unit/query/explore.test.ts` for all six intents, empty/partial evidence, deterministic ordering, and hard work limits.
- [ ] Reuse existing scoped search, path/flow, API-contract, PR/test, security and context services.
- [ ] Start with the current index; add optional `ReadIndexView` binding only after the ref-aware foundation is available.

## 2. Graph-aware reranking
- [ ] Create `search/graph-reranker.ts` with a versioned deterministic scorer.
- [ ] Include lexical/vector, exact identity, graph/path/flow, API, certainty/ambiguity, generated/test/config path features.
- [ ] Add negative tests proving ambiguous edges cannot become exact ranking evidence.
- [ ] Add optional top-contribution diagnostics without expanding default MCP output.

## 3. Render policy
- [ ] Create `context/render-policy.ts` and the five render modes.
- [ ] Create `context/skeletonizer.ts` with per-language capability declarations.
- [ ] Modify `context/builder.ts` to accept an optional render plan while preserving legacy defaults.
- [ ] Extend `context/session.ts` so references include selected index/snapshot identity.
- [ ] Add Unicode, overload/polymorphism, unsupported-language, stale-session, and budget tests.
- [ ] Enable each skeleton capability row only after its syntax-preservation fixtures pass; otherwise retain snippet/signature fallback.

## 4. Public surfaces
- [ ] Add `explore` MCP schema/handler.
- [ ] Add `code-intel explore` CLI.
- [ ] Add `POST /api/v1/explore` and OpenAPI schema.
- [ ] Prove all transports call the same orchestrator.

## 5. Evaluation
- [ ] Extend agent benchmark with paired baseline-vs-Explore cases.
- [ ] Gate >=25% median token reduction with <=2pp correctness regression.
- [ ] Record structural counters and rerank/render latency.
- [ ] Produce language skeleton capability matrix; unsupported rows must safely fall back.

## 6. Release
- [ ] Update README/MCP docs only after behavior matches spec.
- [ ] Run typecheck, core/Web/e2e, evaluation, packaging and release validation.
