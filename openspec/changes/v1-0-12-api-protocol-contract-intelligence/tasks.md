# Tasks: API and Protocol Contract Intelligence

## 1. HTTP consumer access paths
- [ ] Add `semantic/api-contracts/consumers/access-paths.ts` and extend `HttpConsumerFact` with backward-compatible normalized nested access paths.
- [ ] Support tested direct member, optional chain, destructuring/renaming, nested destructuring and bounded alias propagation for existing fetch/Axios/Angular consumers.
- [ ] Add dynamic-computed/local-data-flow cap boundaries and unit fixtures.
- [ ] Bump API contract schema/fingerprint only if persisted fact shape requires it.

## 2. HTTP shape check
- [ ] Add `semantic/api-contracts/shape-check.ts` with producer/consumer coverage-aware verdicts.
- [ ] Expose an optional `api_shape_check` CLI/MCP/HTTP surface or document why additive `api_impact` is sufficient; keep one semantic service either way.
- [ ] Add shape findings to `api_impact`/`api_drift` without breaking existing fields.
- [ ] Add exact/unknown/optional/nested/response-variant tests.

## 3. GraphQL model/parser
- [ ] Audit a proper GraphQL AST parser as a new direct production dependency; document license/package/runtime decision and never rely on transitive hoisting.
- [ ] Replace regex-only internals while preserving a migration adapter for existing `parseGraphQLContracts` callers.
- [ ] Model object/input/interface/union/enum/scalar, fields, args/defaults, list/non-null wrappers, root operations, coverage and anchors.
- [ ] Add schema-depth/file-size limits and malformed-document tests.

## 4. GraphQL operations/resolvers
- [ ] Add standalone operation parsing plus tested JS/TS tagged-template/import extraction.
- [ ] Add canonical operation identity + selected-field path tree.
- [ ] Add framework resolver binding only for source-verified supported adapters; publish capability rows.
- [ ] Add exact/candidate/unresolved consumer mapping tests.

## 5. GraphQL compatibility
- [ ] Create `contract-drift/graphql-comparator.ts`.
- [ ] Implement documented field/argument/type-wrapper/input/enum rules with known-consumer evidence.
- [ ] Preserve unknown boundaries for custom scalar semantics/directives/runtime auth.
- [ ] Extend contract identity/fingerprint/version and legacy fallback tests.

## 6. Protobuf/gRPC model/parser
- [ ] Audit `protobufjs` or another parser as a new direct production dependency; document license/runtime/package behavior and never rely on the current invalid/transitive installation.
- [ ] Extend proto parsing for package, services/RPCs, streaming, messages, fields/numbers/types/cardinality, map/oneof, enums and reserved sets.
- [ ] Add nested-scope and malformed/depth/file-size tests.
- [ ] Version/fingerprint rich gRPC contracts.

## 7. gRPC compatibility
- [ ] Create `contract-drift/grpc-comparator.ts` with separate wire/source compatibility dimensions.
- [ ] Add rule fixtures for number reuse/change, type/wire changes, field removal/reservation, rename, enum numbers, oneof, RPC/message/streaming changes.
- [ ] Document rule table against protobuf compatibility semantics.

## 8. gRPC provider/consumer mapping
- [ ] Begin only after rich schema parsing/comparison and canonical RPC identities are stable.
- [ ] Add source-verified language/framework binding adapters for the initial supported set.
- [ ] Match by canonical service/RPC identity, never simple method name alone.
- [ ] Publish unsupported capability boundaries for other languages/frameworks.

## 9. Multi-repo/public integration
- [ ] Extend `contract-identity.ts`, `contract-fingerprint.ts`, consumer index and comparator dispatch.
- [ ] Make `group_contract_drift` compare new-schema GraphQL/gRPC and keep legacy schema `unknown`.
- [ ] Fold affected consumers/tests/flows into PR/group impact only at permitted certainty.
- [ ] Update MCP/OpenAPI/CLI docs/contracts after final public surface decision.

## 10. Performance/release
- [ ] Benchmark parser/matcher scaling with bounded large schemas/operation sets.
- [ ] Run security/license audit for parser dependencies.
- [ ] Run core/multi-repo/API/Web/e2e/package/release gates.
