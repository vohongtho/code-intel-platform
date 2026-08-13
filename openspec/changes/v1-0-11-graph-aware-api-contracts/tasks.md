# Tasks: Graph-Aware API Contracts

## 1. Baseline inventory and ownership

- [ ] 1.1 Inspect `code-intel/core/src/pipeline/phases/parse-phase.ts`, existing route extraction code, `code-intel/core/src/shared/types.ts`, `code-intel/core/src/graph/*`, `code-intel/core/src/storage/graph-loader.ts`, `code-intel/core/src/storage/index-generation.ts`, `code-intel/core/src/multi-repo/group-sync.ts`, `code-intel/core/src/multi-repo/types.ts`, `code-intel/core/src/mcp-server/server.ts`, `code-intel/core/src/http/app.ts`, `code-intel/core/src/http/openapi.ts`, and `code-intel/core/src/cli/app.ts` before changing behavior.
- [ ] 1.2 Document which existing route node/edge fields remain authoritative and which API-contract fields are additive. Do not create a second route model if the current graph Route node can be extended safely.
- [ ] 1.3 Identify existing framework route extraction paths and record exact production gaps for Express/Fastify, NestJS, ASP.NET Core, response bodies, request DTOs, middleware/guards, and frontend consumers.

## 2. Code-level semantic contracts

- [ ] 2.1 Create `code-intel/core/src/semantic/api-contracts/types.ts` defining discriminated unions for `HttpRouteFact`, `HttpRequestShapeFact`, `HttpResponseShapeFact`, `HttpConsumerFact`, `ApiContractMatch`, and compatibility findings. Every fact MUST contain source anchor, repository identity, canonical symbol references where available, framework, and certainty/coverage metadata.
- [ ] 2.2 Create `code-intel/core/src/semantic/api-contracts/route-normalizer.ts` for HTTP method normalization, path-segment normalization, parameter normalization, nested prefix composition, and dynamic-path boundary reporting. Do not normalize two semantically different routes to the same key.
- [ ] 2.3 Create `code-intel/core/src/semantic/api-contracts/shape-normalizer.ts` to normalize object keys, DTO/type references, optional/required fields, primitive/type-category information, status code variants, and unknown/dynamic shapes.
- [ ] 2.4 Export the new contracts through the semantic-layer barrel used by the 1.0.11 universal semantic fact implementation instead of importing framework-specific files from MCP/HTTP handlers.

## 3. Producer extraction

- [ ] 3.1 Refactor existing Express/Fastify route extraction in `code-intel/core/src/pipeline/phases/parse-phase.ts` and/or the framework-semantic adapter introduced by `v1-0-11-framework-semantic-adapters` so it emits `HttpRouteFact` while preserving existing Route nodes and `routes` output.
- [ ] 3.2 Implement Express/Fastify nested router prefix composition, HTTP method, handler canonical ID, middleware list, path parameters, request-body evidence, and statically knowable response status/shape extraction.
- [ ] 3.3 Add NestJS producer adapter under the framework-semantic adapter directory. Resolve `@Controller()` prefix + method decorator, handler canonical ID, guards/interceptors where statically known, `@Body()` DTO/type, `@Param()`/`@Query()`, status decorators, and return DTO/object-literal keys.
- [ ] 3.4 Add ASP.NET Core producer adapter for `[Route]`, `[HttpGet/Post/Put/Patch/Delete]`, controller prefixes, action symbols, request DTOs, `ActionResult<T>`/typed result evidence, and minimal API `MapGet/MapPost/...` handlers where statically resolvable.
- [ ] 3.5 For every producer adapter, emit explicit `unsupported-dynamic`/`partial` evidence for computed route strings, reflection/runtime registration, unresolved DTO types, or response construction that cannot be proven. Never fabricate exact shapes.

## 4. Consumer extraction

- [ ] 4.1 Create `code-intel/core/src/semantic/api-contracts/consumers/fetch.ts` for `fetch(...)`, including method, URL expression, body, expected response usage, and source call-site anchor.
- [ ] 4.2 Create `code-intel/core/src/semantic/api-contracts/consumers/axios.ts` for `axios.get/post/...`, `axios({...})`, and configured clients when base URL is statically knowable.
- [ ] 4.3 Create `code-intel/core/src/semantic/api-contracts/consumers/angular-http.ts` for Angular `HttpClient` method calls and generic response type arguments.
- [ ] 4.4 Track consumed response properties when they can be linked through immediate destructuring/member access or typed result usage. Bound local data-flow depth and return partial coverage when exceeded.
- [ ] 4.5 Add negative extraction fixtures for dynamic URLs, concatenation with unknown host/path, aliases that cannot be proven, and unrelated methods named `get`/`post`.

## 5. Producer-consumer resolution

- [ ] 5.1 Create `code-intel/core/src/semantic/api-contracts/matcher.ts`. Match by repository/service scope, normalized HTTP method, normalized path, known base path, route parameters, and framework evidence; simple suffix or substring equality MUST NOT produce exact links.
- [ ] 5.2 Define deterministic candidate ordering and a configurable hard candidate cap. Exceeding the cap MUST return truncated/lower-bound coverage through the shared relationship-certainty model.
- [ ] 5.3 Resolve consumer-to-route links through canonical IDs and emit evidence strategy such as `exact-method-path`, `exact-normalized-base-path`, `candidate-dynamic-segment`, or `unresolved-dynamic-url`.
- [ ] 5.4 Add fixture assertions for `/api/users/:id` vs `/users/:id`, `/v1/users` vs `/v2/users`, same route in different services, method mismatch, trailing slash, query strings, and path parameters.

## 6. Graph and persistence

- [ ] 6.1 Extend `code-intel/core/src/shared/types.ts` and graph schema only where required to persist API-contract relationship metadata. Reuse existing Route nodes where possible; add new node/edge kinds only after proving an existing representation cannot preserve semantics.
- [ ] 6.2 Update `code-intel/core/src/storage/graph-loader.ts`, CSV/bulk persistence code, and `code-intel/core/src/multi-repo/graph-from-db.ts` so API relationship certainty, call-site/source anchor, method/path identity, evidence reference, and shape fingerprint survive close/reopen.
- [ ] 6.3 Update Generation V2 metadata in `code-intel/core/src/storage/index-generation.ts` / `metadata.ts` with API-contract schema/fingerprint versions. A generation with incompatible API-contract schema MUST degrade explicitly rather than appear fresh.
- [ ] 6.4 Add read-back tests comparing normalized in-memory and reopened API contracts/relationships, not only counts.

## 7. Compatibility engine

- [ ] 7.1 Create `code-intel/core/src/semantic/api-contracts/compatibility.ts` returning `compatible | potentially-breaking | breaking | unknown` plus evidence and coverage.
- [ ] 7.2 Implement route removal, HTTP method change, required request-field addition, request type-category change, response-field removal, response type-category change, success-status removal, and optional additive-field rules.
- [ ] 7.3 Do not label a change safe when base/head shapes are partial, consumer usage is unknown, or route matching is ambiguous; return `unknown`/`potentially-breaking` with boundary reasons.
- [ ] 7.4 Add base/head unit fixtures for every compatibility rule and at least one negative fixture proving an unrelated same-name DTO/route is not compared.

## 8. MCP, HTTP, CLI and existing impact integration

- [ ] 8.1 Add service functions outside transport layers, e.g. `code-intel/core/src/semantic/api-contracts/service.ts`, for contract lookup, impact, and drift. `mcp-server/server.ts` and `http/app.ts` MUST only validate/route/serialize.
- [ ] 8.2 Register `api_contract`, `api_impact`, and `api_drift` in `code-intel/core/src/mcp-server/server.ts` using existing repository/scope/selector resolution and additive certainty/coverage fields.
- [ ] 8.3 Add equivalent HTTP routes in `code-intel/core/src/http/app.ts` and document schemas in `code-intel/core/src/http/openapi.ts`. Preserve existing auth, 400 malformed-scope, and 404 unknown-repository behavior.
- [ ] 8.4 Add optional CLI commands/subcommands in `code-intel/core/src/cli/app.ts` only if they expose unique API-contract output; do not duplicate generic `impact` behavior under another name.
- [ ] 8.5 Extend existing `pr_impact` execution path so changed route/request/response facts appear as an additive API compatibility section with certainty and known-consumer coverage.
- [ ] 8.6 Extend `code-intel/core/src/multi-repo/group-sync.ts` and `types.ts` to consume the same normalized HTTP contract facts rather than maintain a second route-shape parser.

## 9. Incremental analysis

- [ ] 9.1 Extend semantic invalidation from `v1-0-11-dependency-aware-incremental-resolution` so changed route facts invalidate route keys, reverse API-consumer matches, compatibility findings, and affected group contract fingerprints.
- [ ] 9.2 Update `code-intel/core/src/pipeline/analysis-plan.ts` / `incremental-indexer.ts` only through the shared artifact delta plan. Do not introduce a separate ad-hoc API incremental path.
- [ ] 9.3 Add convergence tests proving clean full analysis and incremental analysis produce identical normalized API contracts after route rename, response-key removal, consumer URL change, file move, and deletion.

## 10. Web UI

- [ ] 10.1 After MCP/HTTP schemas are stable, add API contract client types/API calls under `code-intel/web/src` using the existing Web API layer.
- [ ] 10.2 Add a contract detail/impact view showing method + path, handler, request/response shape, known consumers, compatibility findings, certainty, and incomplete-analysis boundaries.
- [ ] 10.3 Add Web tests for loading/error/partial/truncated states; UI MUST visually distinguish `no known consumer` from `proven no consumer`.

## 11. Tests, metrics and release gates

- [ ] 11.1 Add focused unit tests under `code-intel/core/tests/unit` for normalizers, shape comparison, extraction, and matching.
- [ ] 11.2 Add integration fixtures under `code-intel/core/tests/integration` covering Express/Fastify, NestJS, ASP.NET Core, fetch, Axios, and Angular HttpClient across multiple files and same-name symbols.
- [ ] 11.3 Add persistence/reopen and MCP/HTTP contract tests, including malformed scope, ambiguous match, unavailable evidence store, and analysis truncation.
- [ ] 11.4 Add performance counters for producer facts, consumer facts, exact/ambiguous/unresolved matches, comparison count, candidate cap hits, and elapsed matching time.
- [ ] 11.5 Run the canonical 15-language semantic matrix. Languages where HTTP contract extraction is not applicable MAY report `not-applicable`; shared semantic/persistence behavior must still pass.
- [ ] 11.6 Run `npm test`, integration/e2e suites, MCP benchmark where affected, build/typecheck/lint, and Generation V2 reopen/read-back validation before marking the proposal complete.

## 12. Documentation and release notes — mandatory Definition of Done

- [ ] 12.1 Update root `README.md` Features section with Graph-Aware API Contracts, supported producer/consumer frameworks for 1.0.11, example `api_contract`/`api_impact`/`api_drift` usage, certainty limitations, and cross-repo integration. Do not advertise adapters that are only planned/partial as fully supported.
- [ ] 12.2 Update root `CHANGELOG.md` under a new/active `## [1.0.11]` section with user-visible API-contract capabilities, new MCP/HTTP/CLI surface, compatibility behavior, incremental-analysis impact, and known limitations.
- [ ] 12.3 If MCP tool tables/examples exist elsewhere in repository docs or generated agent instructions, update them in the same implementation commit so tool names and fields match runtime schemas.
- [ ] 12.4 Run a documentation consistency check: every README/CHANGELOG command and MCP field MUST exist in production code and at least one test; documentation updates are required before this OpenSpec change can be checked complete.
