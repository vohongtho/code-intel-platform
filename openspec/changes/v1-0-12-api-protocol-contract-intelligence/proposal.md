# v1.0.12: API and Protocol Contract Intelligence

## Change ID
`v1-0-12-api-protocol-contract-intelligence`

## Feature IDs
F09, F16, F17

## Priority
P0/P1

## Summary
Extend the existing HTTP contract engine with explicit consumer-shape validation, and turn the existing GraphQL/protobuf extraction placeholders into evidence-backed producer/consumer compatibility analysis with cross-repository impact.

## 1. Source-verified baseline

### HTTP
`code-intel/core/src/semantic/api-contracts/types.ts` already defines normalized HTTP route, request/response shape, and consumer facts. `HttpConsumerFact` already carries `consumedKeys`, optional expected response-shape symbol, and coverage boundaries. The current engine supports producer/consumer matching and compatibility rules for route removal, method changes, request requiredness/type changes, response field removal/type changes, success-status removal, and optional additions.

The remaining HTTP gap is not "add response-shape validation from zero". It is to make consumer field-use analysis more explicit and robust for nested access paths, aliases, destructuring/optional chaining, and to expose a dedicated shape-check result rather than burying all evidence inside broader contract/impact responses.

### GraphQL
`multi-repo/schema-parsers/graphql-parser.ts` currently scans `.graphql/.gql` files with regex, emitting only:
- `query.<field>`, `mutation.<field>`, `subscription.<field>`;
- `type.<TypeName>`;
- flat field-name arrays.

It does not model argument types, nullability/list wrappers, enums/interfaces/unions/input objects, client operation selections, resolver bindings, or field-level compatibility.

### Protobuf/gRPC
`multi-repo/schema-parsers/proto-parser.ts` currently emits service/RPC name plus input/output type names. It does not retain packages, message fields/numbers/types/cardinality, enum values, oneofs/reserved numbers, streaming mode, or client/handler links.

### Drift
`multi-repo/contract-drift/comparator.ts` intentionally returns `unknown` with `*-unsupported` for `graphql` and `grpc` in v1.0.11.

This change SHALL extend those owners instead of introducing a second contract registry.

## 2. HTTP consumer shape check

Add a reusable shape-check service that compares a resolved route's response variants to statically observed consumer access paths.

Extend consumer evidence from flat `consumedKeys` toward normalized nested paths such as:
```text
user.id
user.profile.displayName
items[].price
```

Initial supported JS/TS constructs should include, where statically provable:
- direct member access;
- optional chaining;
- object destructuring, including renamed bindings;
- nested destructuring;
- bounded local alias propagation;
- array element/property access when the container shape is known;
- Axios/fetch/Angular response wrappers already modeled by existing adapters.

Dynamic computed properties remain a coverage boundary.

Expose:
```bash
code-intel api-shape-check --method GET --path /users/:id
```
plus MCP/HTTP equivalent. Also add shape findings to `api_impact`/`api_drift` where applicable.

A "no mismatch" result is only `compatible` when producer shape and consumer-use coverage are sufficiently complete; otherwise it is `unknown`.

## 3. GraphQL contract model

Replace the flat regex-only semantic model with a versioned GraphQL contract representation while preserving legacy extraction fallback when parsing fails.

Model:
- schema type kind: object/input/interface/union/enum/scalar;
- field name;
- argument names/types/default/requiredness;
- return/input type references including list/non-null wrappers;
- enum values;
- possible interface/union members where statically known;
- query/mutation/subscription root field;
- source anchor/coverage;
- client operation identity;
- selected field paths;
- variables and variable type signatures.

Canonical server field identity:
```text
graphql:<schema-or-service>:<parentType>.<field>
```

Client operation identity includes operation type/name and a normalized document fingerprint. Anonymous operations use fingerprint identity rather than a fabricated name.

## 4. GraphQL producer/consumer mapping

Server side:
- schema documents provide field/type contracts;
- framework adapter evidence may bind root/type fields to resolver symbols where supported (initially target frameworks already represented by TypeScript/NestJS-style and other statically discoverable resolver decorators only after source verification during implementation);
- missing resolver binding does not invalidate schema compatibility analysis but prevents handler-level blast-radius claims.

Client side:
- parse standalone `.graphql/.gql` operations;
- support a tested subset of JS/TS tagged-template/document imports (e.g. common `gql` usage) through a dedicated extractor;
- map operation selected fields to canonical schema fields using type context where statically known.

Consumer links carry certainty and selected field paths.

## 5. GraphQL compatibility

Initial rules:
- selected field removed -> breaking for known consumer;
- field return type named-type change -> breaking/unknown according to compatibility table;
- non-null/list wrapper strengthening/shape change -> classify explicitly;
- required argument added without default -> breaking;
- argument removed/type changed -> breaking/potentially-breaking;
- input field newly required -> breaking for applicable clients;
- enum value removed -> potentially-breaking or breaking when known consumer uses it;
- additive nullable output field -> compatible;
- additive optional input field -> compatible;
- custom scalar semantic change with same scalar name -> unknown;
- directives/runtime authorization/deprecation semantics not statically modeled -> boundary.

The comparator must distinguish schema-level potential breakage from a proven affected known consumer.

## 6. Protobuf/gRPC contract model

Extend parser to capture:
- `package`;
- service and RPC;
- unary/client-stream/server-stream/bidi-stream mode;
- fully-qualified request/response message identity;
- message fields: name, number, type, repeated/optional, oneof membership;
- map fields;
- enum names/numeric values;
- `reserved` numbers/names;
- nested message/enum ownership;
- source anchors/coverage.

Prefer a proper protobuf parser/library already available in the dependency graph if license/runtime audit and packaged behavior support it; otherwise implement a bounded parser sufficient for this contract subset. Do not continue growing fragile regex once nested scopes/oneofs/reserved sets are required.

## 7. gRPC compatibility dimensions

Report at least two dimensions:
- `wireCompatibility`;
- `sourceCompatibility`.

This avoids incorrectly calling a schema change globally "safe" when protobuf wire compatibility and generated-client API compatibility differ.

Examples:
- field number reuse -> wire breaking;
- changing field number -> wire breaking;
- changing between incompatible wire types -> wire breaking;
- removing a field while reserving its number/name -> often wire compatible but source breaking for code referencing it;
- removing without reservation -> source breaking and reuse-risk finding;
- renaming a field with same number/type -> usually wire compatible, source breaking;
- adding optional/new-number field -> wire compatible, generally source compatible;
- enum number reuse/change -> wire breaking;
- service/RPC removal -> source/API breaking;
- request/response message identity change -> breaking unless a proven compatible alias model exists;
- streaming mode change -> breaking;
- moving a field into/out of oneof -> classify conservatively and expose boundary.

The exact table SHALL be tested against protobuf language-guide compatibility semantics and documented.

## 8. gRPC handler/client mapping

Where language/framework facts can prove:
- generated/client stub call -> RPC contract;
- server handler/implementation -> RPC contract;

store consumer/provider references with certainty. Do not infer a link from method-name equality alone.

Initial implementation may focus on TypeScript/Java/C#/Go patterns with explicit capability rows; unsupported ecosystems keep schema-level drift only.

## 9. Multi-repository integration

Continue using `Contract`, `GroupContractVersion`, consumer index and `group_contract_drift`.

Add:
- GraphQL comparator;
- gRPC comparator;
- canonical/fingerprint logic for richer protocol structures;
- consumer links from operations/stubs;
- affected consumer and test/flow guidance only when evidence certainty permits.

Existing `graphql`/`grpc` unknown behavior remains the fallback for legacy snapshots lacking the new schema version.

## 10. Persistence and migration

Add protocol contract schema/fingerprint versions. Old group-sync/snapshot data with legacy flat contracts must not be interpreted as fully comparable. It either rebuilds or returns `unknown/legacy-schema`.

Do not silently upgrade old fingerprints using only old fields.

## 11. Performance

Parsing is repository-analysis time, not per-query. Consumer matching uses indexed canonical identities/operation references, not O(producers × all source files) scans.

Bound:
- max operation selections retained;
- max dynamic alias propagation depth;
- max candidate schema/handler/client matches;
- max protocol findings per query with total counts preserved.

## 12. Security

GraphQL/proto documents are untrusted input. Parsers must enforce source/file size and recursion/depth limits. No schema directives/options are executed. Imported descriptors never trigger code generation.

## 13. Non-goals

- executing GraphQL introspection against live servers;
- runtime tracing of resolver selection;
- validating business semantics of custom scalars/directives;
- generating protobuf clients;
- claiming all language-specific gRPC frameworks are supported in 1.0.12;
- replacing the existing HTTP engine.

## 14. Acceptance

Known frontend nested-field use can be matched against HTTP producer shapes; GraphQL known operations map to selected fields and compatible schema changes; protobuf/gRPC drift reports wire/source dimensions; group drift no longer returns unconditional unsupported for new-schema GraphQL/gRPC contracts; legacy data degrades explicitly.
