# Tasks: API and Protocol Contract Intelligence

## 1. HTTP consumer access paths
- [x] Add `semantic/api-contracts/consumers/access-paths.ts` and extend `HttpConsumerFact` with backward-compatible normalized nested access paths.
- [x] Support tested direct member, optional chain, destructuring/renaming, nested destructuring and bounded alias propagation for existing fetch/Axios/Angular consumers.
- [x] Add dynamic-computed/local-data-flow cap boundaries and unit fixtures.
- [x] Bump API contract schema/fingerprint only if persisted fact shape requires it.

## 2. HTTP shape check
- [x] Add `semantic/api-contracts/shape-check.ts` with producer/consumer coverage-aware verdicts.
- [x] Expose an optional `api_shape_check` CLI/MCP/HTTP surface or document why additive `api_impact` is sufficient; keep one semantic service either way.
- [x] Add shape findings to `api_impact`/`api_drift` without breaking existing fields.
- [x] Add exact/unknown/optional/nested/response-variant tests.

## 3. GraphQL model/parser
- [x] Audit a proper GraphQL AST parser as a new direct production dependency; document license/package/runtime decision and never rely on transitive hoisting.
- [x] Replace regex-only internals while preserving a migration adapter for existing `parseGraphQLContracts` callers.
- [x] Model object/input/interface/union/enum/scalar, fields, args/defaults, list/non-null wrappers, root operations, coverage and anchors.
- [x] Add schema-depth/file-size limits and malformed-document tests.

## 4. GraphQL operations/resolvers
- [x] Add standalone operation parsing plus tested JS/TS tagged-template/import extraction.
- [x] Add canonical operation identity + selected-field path tree.
- [x] Add framework resolver binding only for source-verified supported adapters; publish capability rows.
- [x] Add exact/candidate/unresolved consumer mapping tests.

## 5. GraphQL compatibility
- [x] Create `contract-drift/graphql-comparator.ts`.
- [x] Implement documented field/argument/type-wrapper/input/enum rules with known-consumer evidence.
- [x] Preserve unknown boundaries for custom scalar semantics/directives/runtime auth.
- [x] Extend contract identity/fingerprint/version and legacy fallback tests.

## 6. Protobuf/gRPC model/parser
- [x] Audit `protobufjs` or another parser as a new direct production dependency; document license/runtime/package behavior and never rely on the current invalid/transitive installation.
- [x] Extend proto parsing for package, services/RPCs, streaming, messages, fields/numbers/types/cardinality, map/oneof, enums and reserved sets.
- [x] Add nested-scope and malformed/depth/file-size tests.
- [x] Version/fingerprint rich gRPC contracts.

## 7. gRPC compatibility
- [x] Create `contract-drift/grpc-comparator.ts` with separate wire/source compatibility dimensions.
- [x] Add rule fixtures for number reuse/change, type/wire changes, field removal/reservation, rename, enum numbers, oneof, RPC/message/streaming changes.
- [x] Document rule table against protobuf compatibility semantics.

## 8. gRPC provider/consumer mapping
- [x] Begin only after rich schema parsing/comparison and canonical RPC identities are stable.
- [x] Add source-verified language/framework binding adapters for the initial supported set.
- [x] Match by canonical service/RPC identity, never simple method name alone.
- [x] Publish unsupported capability boundaries for other languages/frameworks.

## 9. Multi-repo/public integration
- [x] Extend `contract-identity.ts`, `contract-fingerprint.ts`, consumer index and comparator dispatch.
- [x] Make `group_contract_drift` compare new-schema GraphQL/gRPC and keep legacy schema `unknown`.
- [x] Fold affected consumers/tests/flows into PR/group impact only at permitted certainty.
- [x] Update MCP/OpenAPI/CLI docs/contracts after final public surface decision.

## 10. Performance/release
- [x] Benchmark parser/matcher scaling with bounded large schemas/operation sets.
- [x] Run security/license audit for parser dependencies.
- [x] Run core/multi-repo/API/Web/e2e/package/release gates.
