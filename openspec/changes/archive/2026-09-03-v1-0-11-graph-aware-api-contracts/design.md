# Design: Graph-Aware API Contracts

## Architecture

```text
Tree-sitter / framework adapters
  -> semantic route + shape + consumer facts
  -> canonical identity
  -> API contract resolver
  -> graph projection + contract index
  -> MCP/HTTP/Web consumers
```

The API layer consumes the universal semantic fact model. Framework adapters MUST NOT write graph rows directly.

## Core contracts

```ts
interface RouteContractFact {
  id: string;
  method: HttpMethod | 'ANY';
  path: string;
  normalizedPath: string;
  handlerSymbolId?: string;
  middlewareSymbolIds: string[];
  authEvidence?: EvidenceRef[];
  request?: ApiShapeRef;
  responses: ApiResponseVariant[];
  source: SourceAnchor;
}

interface ApiResponseVariant {
  status?: number | 'default';
  shape?: ApiShapeRef;
  keys?: string[];
  evidence: EvidenceRef[];
}

interface ApiConsumerFact {
  id: string;
  method?: HttpMethod;
  urlExpression: StaticStringExpression;
  consumedKeys?: string[];
  expectedShapeSymbolId?: string;
  source: SourceAnchor;
}
```

## Route normalization

Normalization keeps semantic parameter positions while removing framework spelling differences. Example `/users/:id`, `/users/{id}`, and `/users/<id>` may normalize to `/users/{}` only after framework parsing proves the segment is a parameter. Literal segments remain case-sensitive/case-insensitive according to framework rules; the shared layer must not assume one global behavior.

Nested routers/controller prefixes are composed as semantic facts. Unknown dynamic prefixes create an incomplete boundary rather than a guessed route.

## Consumer matching

Candidate lookup key is `(method, normalizedPathSkeleton)` with bounded fallback when method is unknown. Final resolution considers literal segment equality, parameter positions, base URL evidence, imported/generated client identity, and repository-group contract context.

A consumer with dynamic URL construction may resolve to candidate routes only when evidence supports a bounded set. It MUST NOT become an exact edge from a suffix/substring match.

## Shape model

Prefer references to canonical DTO/schema symbols. Inline object shapes use stable shape fingerprints composed from property name, requiredness when knowable, and normalized type category. Nested shapes may reference child fingerprints to avoid recursive duplication.

Response extraction is conservative. A returned object literal, typed DTO, serializer call with statically known schema, or explicit response-schema registration can produce evidence. Runtime mutation after serialization boundary reduces coverage.

## Graph projection

Add standard relationships such as:

- consumer `CONSUMES_API` route
- route `HANDLED_BY` symbol if not already represented equivalently
- route `RETURNS_SHAPE` shape/schema
- route `ACCEPTS_SHAPE` shape/schema

Before adding edge kinds, inspect existing equivalents and reuse them when semantics match.

Compact edge metadata references certainty/evidence rather than embedding verbose records.

## Compatibility engine

Compatibility compares base/head route contracts:

- removed route -> breaking for resolved consumers;
- method change -> breaking unless matching replacement exists;
- removed consumed response property -> breaking;
- added optional response property -> compatible;
- added required request property -> breaking/potentially-breaking depending on evidence;
- unknown/dynamic shape -> unknown, never safe by default.

## Public interfaces

`api_contract` returns one route/consumer contract plus evidence and coverage.

`api_impact` accepts canonical selector, route identity, or changed files/ref context and returns producers, consumers, flows, repositories, tests, compatibility, certainty, and boundaries.

`api_drift` compares two semantic states when branch snapshot support exists; before that, it may compare an indexed state with a bounded Git-derived candidate set but MUST identify reduced coverage.

## Incremental invalidation

Changed route facts invalidate normalized route index rows, directly linked consumers, compatibility findings, and derived group contracts. Consumer-only edits do not invalidate unrelated producers.

## Observability

Track producer facts, consumer facts, resolved links, ambiguous links, dynamic boundaries, shape extraction coverage, compatibility findings, and time spent per adapter.

## Failure semantics

Adapter failure is bounded to the file/framework unit and recorded diagnostically. Missing response shape does not delete a known route; it reduces shape coverage. Missing consumer resolution does not fabricate a producer target.

## Baseline inventory (task 1.1–1.3)

Actual paths differ from the paths named in `tasks.md`; `code-intel/core/src/shared/types.ts` does not exist. Shared graph types are `shared/graph-types.ts` + `shared/evidence-types.ts`, re-exported (with `identity/contracts.ts` and `semantic/index.ts`) through `shared/index.ts`.

**Authoritative today, extended (not replaced):**
- `NodeKind` `'route'` and `EdgeKind` `'handles'` (`shared/graph-types.ts`) — the route node/handler-edge shape stays; new HTTP fields are additive.
- `RouteFact` (`semantic/facts.ts`) — the existing route fact from the framework-adapter pipeline (`frameworks/adapters/{express,nest,aspnet-core}.ts` → `semantic/graph-projector.ts#projectFactBundle`). API-contract producer facts extend this pipeline rather than forking a second route scanner.
- `resolution/contracts.ts` (`ResolutionCertainty`, `ResolutionCandidate`, `ResolutionCoverage`, `ResolutionOutcome`) and `shared/evidence-types.ts` (`RelationshipCertainty`, `AnalysisBoundary`) — the matcher and compatibility engine reuse this certainty/evidence vocabulary instead of inventing a parallel one.
- `evidence/store.ts` (`SqliteResolutionEvidenceStore`, `evidence.db`) — API-contract match/compatibility evidence is recorded here, keyed by the same `referenceId`/`resolverVersion` pattern.
- `incremental/artifact-delta-plan.ts` + `pipeline/analysis-plan.ts`'s fingerprint-mismatch check — API-contract invalidation routes through this, not a separate ad-hoc path.
- `CodeNode.metadata` / `CodeEdge.metadata` (untyped JSON bag, already persisted end-to-end through `storage/graph-loader.ts` and reloaded by `multi-repo/graph-from-db.ts`) — first home for new API-contract fields; promote to a typed DB column only if query performance requires it.

**Additive (new):**
- `HttpRouteFact`, `HttpRequestShapeFact`, `HttpResponseShapeFact`, `HttpConsumerFact` (`semantic/api-contracts/types.ts`), added to the `SemanticFact` union in `semantic/facts.ts` so they flow through the existing `FactBundle`/`createFactBundle`/`projectFactBundle` plumbing.
- New edge kinds for consumer→route and route→shape relationships (`shared/graph-types.ts` `EdgeKind`).
- `apiContractFingerprint`/`apiContractSchemaVersion` in `storage/index-generation.ts` (`IndexGenerationManifestV2`) and `storage/metadata.ts` (`IndexMetadata`), checked in `analysis-plan.ts#hasSemanticFingerprintMismatch`.
- `api_contract`/`api_impact`/`api_drift` MCP tools, HTTP routes, and (optionally) CLI surface — wholly new, no existing equivalent.

**Known extraction gaps (framework adapters, pre-existing):**
- `frameworks/adapters/{express,nest,aspnet-core}.ts` extract method + path + handler only — no middleware list as structured data, no request/response shape, no guards/DTOs. This is exactly the gap tasks 3.1–3.5 close.
- Nest's `@Controller()` prefix is emitted as a separate `RegistrationFact` that produces its own disconnected `route` node (`graph-projector.ts` registration-fact branch), not composed into the `@Get()` route's path — today a single Nest endpoint can produce two unlinked `route` nodes. Task 3.3 must compose the controller prefix directly into the route fact's `path` instead of relying on the registration-fact node.
- `multi-repo/group-sync.ts#matchContracts` matches routes by **exact `name` string equality or substring/camelCase containment** (`name-match`/`route-match`, confidence 0.4 on substring) — this is the weak "URL substring matching" the proposal (task 5.1, 8.6) replaces with method+normalized-path evidence.
- No consumer-side (fetch/Axios/Angular) extraction exists anywhere in the codebase; no request/response shape extraction exists anywhere. Both are wholly new (sections 2–4).
