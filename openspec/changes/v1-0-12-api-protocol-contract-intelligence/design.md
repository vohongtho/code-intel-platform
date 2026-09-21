# Design: API and Protocol Contract Intelligence

## 1. Ownership

HTTP extensions stay in `semantic/api-contracts/*`.
GraphQL/protobuf schema extraction stays under `multi-repo/schema-parsers/*` unless shared semantic facts justify a focused `semantic/protocol-contracts/*` package.
Cross-ref/group compatibility stays in `multi-repo/contract-drift/*`.

Do not duplicate contract identity, fingerprint, consumer index or drift service.

## 2. HTTP access paths

Add:
- `semantic/api-contracts/consumers/access-paths.ts`;
- optional richer field `consumedPaths` to `HttpConsumerFact` while preserving `consumedKeys` compatibility;
- `semantic/api-contracts/shape-check.ts`.

```ts
interface ConsumerAccessPath {
  path: readonly string[];
  optional: boolean;
  sourceRange: SourceRange;
  certainty: ApiCertainty;
}
```

Normalize array traversal with an explicit marker rather than losing shape. Alias propagation is bounded and returns `local-data-flow-exceeded` boundary when capped.

## 3. Shape-check contract

`checkConsumerResponseShapes(route, consumers, responseShapes)` returns:
- finding per consumed path;
- matched response variant(s);
- verdict `compatible|breaking|unknown`;
- evidence;
- producer and consumer coverage.

A missing producer field is breaking only when producer shape is known enough and the consumer path is exact enough. Unknown shape is never a false pass.

## 4. GraphQL parser architecture

The existing regex parser cannot safely model nested types/arguments/wrappers. Replace its internal implementation with an AST parser while preserving `parseGraphQLContracts` compatibility adapter during migration.

`graphql` is not currently a direct production dependency. Audit whether it can be added directly with acceptable license/package/runtime impact. Do not rely on workspace hoisting or an incidental transitive package. Prefer the standard GraphQL AST parser over custom grammar after that gate passes.

Add modules:
- `multi-repo/schema-parsers/graphql-model.ts`;
- `semantic/protocol-contracts/graphql-types.ts`;
- `graphql-operations.ts`;
- `graphql-matcher.ts`;
- `contract-drift/graphql-comparator.ts`.

Version `GRAPHQL_CONTRACT_SCHEMA_VERSION`.

## 5. GraphQL identities/fingerprints

Field identity uses repository/service + canonical schema parent type + field name. Type definitions and operations receive separate identity namespaces.

Fingerprint includes type wrapper structure, arguments/defaults, enum values, possible-type membership and normalized selected fields where applicable.

Ordering is canonical and insensitive to source formatting/field declaration ordering only where GraphQL semantics allow.

## 6. Resolver/client evidence

Resolver binding adapters emit references to semantic symbols with framework adapter/version/evidence. Schema-only contracts are still valid if no handler is known.

Client operation extractor produces operation facts with selected field tree and source anchors. Matching uses operation/schema semantics, not operation display-name equality.

## 7. Protobuf parser architecture

Create:
- `schema-parsers/proto-model.ts`;
- richer parser behind `parseProtoContracts`;
- `semantic/protocol-contracts/grpc-types.ts`;
- `contract-drift/grpc-comparator.ts`;
- optional language-specific `grpc-bindings/*`.

`protobufjs` is not a usable direct dependency in the verified baseline; its installed appearance is invalid/transitive. Audit it or another parser as a new direct production dependency and record licensing and packaged-runtime behavior. If no dependency passes, use a bounded in-repository parser rather than depending on incidental installation state. Parser output must preserve source-level contract semantics required by compatibility; generated code is not required.

Protocol delivery order is model/parser -> schema comparator -> canonical consumer/provider references -> source-verified language/framework bindings. Each completed stage exposes its narrower capability honestly; missing bindings prevent handler-level impact claims but not schema drift.

Version `GRPC_CONTRACT_SCHEMA_VERSION`.

## 8. gRPC compatibility result

Extend finding metadata without changing top-level `ContractDriftCompatibility`:
```ts
interface ProtocolCompatibilityDimensions {
  wire?: 'compatible'|'breaking'|'unknown';
  source?: 'compatible'|'potentially-breaking'|'breaking'|'unknown';
}
```

Overall compatibility is conservative aggregation, but dimensions remain visible so users can distinguish wire vs generated API concerns.

## 9. Contract drift integration

`compareContractVersions` dispatches `graphql` and `grpc` to new comparators when schema version/fingerprint supports them. Legacy contracts retain current `unknown` behavior with explicit reason.

`contract-identity.ts` and `contract-fingerprint.ts` are extended, not replaced.

## 10. Public surfaces

HTTP:
- `api_shape_check` service exposure via CLI/MCP/HTTP naming consistent with project conventions;
- existing `api_impact`/`api_drift` get additive shape findings.

GraphQL/gRPC:
- primarily exposed through `group_contracts`, `group_contract_drift`, `pr_impact` where affected;
- add focused `protocol_contract`/drift query only if existing generic group/API surfaces cannot represent results without ambiguity.

Avoid tool proliferation if the generic contract surfaces suffice.

## 11. Migration

Generation/group state gains protocol producer fingerprints. Legacy persisted contracts do not receive synthetic rich fields. Ordinary analyze/group sync rebuilds them.

## 12. Tests

HTTP:
- nested/optional/destructured/aliased field paths;
- dynamic computed boundary.

GraphQL:
- schema AST, wrappers, args/defaults, enums/interfaces/unions/input;
- client operations and selected fields;
- resolver/client match exact/candidate/unknown;
- compatibility table.

gRPC:
- nested messages, enums, fields/numbers, oneof, reserved, streaming;
- wire/source compatibility table;
- handler/client match capabilities.

Integration:
- cross-repo group drift with known affected consumers;
- legacy snapshot unknown fallback;
- PR impact projection.

## 13. Performance/limits

Add parser depth/file-size/selection-count/candidate caps with explicit coverage boundary. Cache contract fingerprints and indexed identities.
