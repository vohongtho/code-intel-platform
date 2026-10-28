# Protocol contract compatibility (v1.0.12)

This is the rule table behind `group_contract_drift` for GraphQL and protobuf/gRPC contracts, and behind `api_shape_check` for HTTP. The comparators are `code-intel/core/src/multi-repo/contract-drift/graphql-comparator.ts` and `grpc-comparator.ts`; every row below has a fixture in `tests/unit/multi-repo/graphql-comparator.test.ts` or `grpc-protocol.test.ts`.

## How contracts and consumers are built

Group sync parses each member's `.graphql`/`.gql` and `.proto` files (scan depth 8) into versioned models and emits one contract per GraphQL type and one per proto service, message and enum. Root operation types (`Query`, `Mutation`, `Subscription`, or whatever `schema {}` names) are ordinary type contracts, so a removed root field is a field change on that type.

Canonical identities:

| Element | Identity |
| --- | --- |
| GraphQL field | `graphql:<service>:<ParentType>.<field>` |
| GraphQL type contract | `graphql:<service>:type:<Type>` |
| GraphQL operation | `graphql-op:<query\|mutation\|subscription>:<name or anonymous>:<document fingerprint>` |
| gRPC RPC | `grpc:<package>.<Service>/<Method>` |
| proto definition contract | `grpc:<service\|message\|enum>:<fully.qualified.Name>` |

`<service>` is the member's registry name. Anonymous operations are identified by fingerprint only. The fingerprint hashes the printed (whitespace- and comment-normalized) operation plus the fragments it uses.

Consumers come from evidence, not names:

- GraphQL operations from `.graphql` documents and `gql`/`graphql` tagged templates are mapped onto a schema by walking the selection tree with type context (inline fragment and fragment-spread type conditions included). A mapping is `exact` only when exactly one schema in the group validates the whole selection; two fully-validating schemas make both `candidate`, and a partial match is at most `candidate`.
- gRPC clients and servers bind to an RPC only when the source proves the package (see [Binding capabilities](#binding-capabilities)). Without a proven package the binding is a `candidate` across every same-named service. A method name alone never binds.

A finding is `breaking` for a consumer only when that consumer's evidence names the changed element (`Type.field`, `Type.field(arg)`, `Enum.VALUE`, `input:Type`, `rpc:<id>`). Without such evidence the same change is `potentially-breaking` and lists no consumers.

## GraphQL rules

"Reader" means a known operation whose evidence names the element.

| Change | With reader | Without reader |
| --- | --- | --- |
| Output field removed | breaking | potentially-breaking |
| Output field named type or list shape changed | breaking | potentially-breaking |
| Output field `T!` → `T` (weakened) | potentially-breaking | potentially-breaking |
| Output field `T` → `T!` (strengthened) | compatible | compatible |
| Output field added (nullable or not) | compatible, no consumers listed | compatible |
| Field deprecated | compatible | compatible |
| Required argument added (non-null, no default) | breaking for operations calling the field without it | potentially-breaking |
| Optional argument added | compatible | compatible |
| Argument removed | breaking for operations passing it | potentially-breaking |
| Argument/input field type changed | breaking for senders | potentially-breaking |
| Argument/input field became required without default | breaking for omitters | potentially-breaking |
| Argument/input field became optional | compatible | compatible |
| Default value changed | potentially-breaking | potentially-breaking |
| Input field removed | breaking for operations sending the input type | potentially-breaking |
| Required input field added | breaking for operations sending the input type | potentially-breaking |
| Optional input field added | compatible | compatible |
| Enum value removed | breaking if an operation sends it literally; potentially-breaking if only through a variable | potentially-breaking |
| Enum value added | potentially-breaking (exhaustive client switches) | potentially-breaking |
| Union/interface possible type added or removed | potentially-breaking | potentially-breaking |
| Object stops implementing an interface | potentially-breaking | potentially-breaking |
| Type removed | breaking | potentially-breaking |
| Type kind changed | breaking | potentially-breaking |
| Custom scalar definition changed (e.g. `@specifiedBy`) | unknown, `custom-scalar-semantics` | unknown |
| Non-`@deprecated` directive changed | unknown, `directive-semantics-not-modeled` | unknown |

Not modeled: runtime authorization, directive behavior, and value semantics of a custom scalar whose definition did not change. A scalar whose meaning changes under the same name produces no finding.

## Protobuf / gRPC rules

Every gRPC finding carries `protocolDimensions: { wire, source }`. `wire` is binary compatibility between old and new peers. `source` is compatibility of code generated from the old and new protos. The top-level `compatibility` is the conservative aggregate: any `breaking` dimension → breaking, then `potentially-breaking` source, then any `unknown` → unknown.

The table follows the "Updating A Message Type" section of the protobuf language guide.

| Change | wire | source |
| --- | --- | --- |
| Field renamed, same number and type | compatible | breaking (accessors, JSON names) |
| Field number changed, same name | breaking | compatible |
| Number reused by a field with another name and type | breaking | breaking |
| Type change within one wire group (`int32`/`uint32`/`int64`/`uint64`/`bool`/enum; `sint32`/`sint64`; `fixed32`/`sfixed32`; `fixed64`/`sfixed64`; `string`/`bytes`) | compatible (values may truncate) | breaking |
| Type change across wire groups | breaking | breaking |
| Message type ↔ other message, or message ↔ `bytes` | unknown | breaking |
| Field removed, number and name reserved | compatible | breaking |
| Field removed without reserving the number | unknown, `field-number-reuse-risk` | breaking |
| Field added on a new number | compatible | compatible |
| Field added on a number/name reserved in base | breaking | breaking |
| proto2 `required` field added | breaking | breaking |
| singular ↔ `optional` | compatible | potentially-breaking |
| scalar ↔ `repeated`/`map` | unknown | breaking |
| Field moved into or out of a `oneof` | unknown, `oneof-membership-change` | potentially-breaking |
| Enum value number changed | breaking | compatible |
| Enum value renamed, same number | compatible | breaking |
| Enum value removed, number reserved | compatible | breaking |
| Enum value removed, number not reserved | unknown, `enum-number-reuse-risk` | breaking |
| Enum value added | compatible | potentially-breaking |
| Enum value reuses a reserved number | breaking | breaking |
| RPC removed | breaking | breaking |
| RPC request or response message changed | breaking | breaking |
| RPC streaming mode changed | breaking | breaking |
| RPC added | compatible | compatible |
| Service removed | breaking | breaking |
| Message or enum removed | unknown | breaking |
| Package changed | breaking | breaking |

The guide notes that moving a single field into a new `oneof` can be wire-safe. We report `unknown` instead because safety depends on no sender setting more than one member, and we can't verify that statically. Extensions and proto2 groups are skipped with an `extensions-not-modeled` / `groups-not-modeled` boundary.

## Binding capabilities

Group sync publishes these rows as `protocolCapabilities`, so "no consumer found" can be told apart from "not analyzed".

| Protocol | Ecosystem | Role | Status |
| --- | --- | --- | --- |
| GraphQL | SDL documents (graphql-js AST) | schema | supported |
| GraphQL | `.graphql` operations, attributed via relative `import X from './x.graphql'` | consumer | supported |
| GraphQL | `gql`/`graphql` tagged templates; `${...}` interpolations are a boundary | consumer | supported |
| GraphQL | `@nestjs/graphql` `@Query`/`@Mutation`/`@Subscription`; resolver maps `Query: { field }` | provider (root fields) | supported |
| GraphQL | `@ResolveField` / non-root type resolvers | provider | unsupported |
| GraphQL | persisted queries / generated hooks without documents | consumer | unsupported |
| gRPC | `.proto` (in-repo parser) | schema | supported |
| gRPC | `@grpc/grpc-js` `new <loadPackageDefinition path>.<Service>(...)` + calls | consumer | supported |
| gRPC | `@grpc/grpc-js` `server.addService(<path>.<Service>.service, {...})` | provider | supported |
| gRPC | NestJS `@GrpcMethod` / `ClientGrpc.getService`, package from the repo's single `Transport.GRPC` `options.package` | provider, consumer | supported |
| gRPC | grpc-java, grpc-go, Grpc.AspNetCore/Grpc.Net.Client, grpcio | provider, consumer | unsupported (schema drift only) |

When a NestJS repository declares several gRPC packages, its bindings stay `candidate`.

## Legacy data

Contracts persisted by v1.0.11 group sync have no `protocol` payload. They compare as `unknown` with changeKind `graphql-legacy-schema` / `grpc-legacy-schema` and boundary `legacy-schema`; missing structure is never inferred. Ref-based drift reads a `protocol-contracts.json` sidecar written into each snapshot at build time. A snapshot without it (built by an older version) produces the same legacy finding for that repository's protocol contracts, not an "added" or "removed" finding. Re-running `group sync` and letting snapshots rebuild clears these. `GROUP_CONTRACT_SCHEMA_VERSION` and `API_CONTRACT_SCHEMA_VERSION` are both `1.0.12`, so the first sync after upgrading reports every contract as changed.

## Limits

GraphQL and proto files are untrusted input. Nothing is executed: options and directives are kept as text.

| Limit | GraphQL | Proto |
| --- | --- | --- |
| File size | 4 MB | 1 MB |
| Tokens | 1,000,000 (graphql-js `maxTokens`) | 200,000 |
| Nesting depth | 32 (type wrappers, selection sets) | 32 (messages) |
| Files per repository | 1,000 | 1,000 |
| Other | 5,000 types per schema; 2,000 operations per repo; 2,000 selections per operation; 8 candidate schemas per operation | 5,000 definitions per file |

Each limit hit becomes a coverage boundary on the schema, file or operation (`file-size-limit`, `token-limit`, `depth-limit`, `selection-limit`, `type-count-limit`, `definition-limit`, ...). A partially parsed schema with no detected change reports `graphql-structure-incomplete` / `grpc-structure-incomplete` as `unknown` rather than nothing.

## HTTP shape check

`api_shape_check` (CLI `api-shape-check --method GET --path /users/:id`, MCP `api_shape_check`, HTTP `GET /api/v1/api-shape-check`) compares the nested response paths each consumer reads, such as `user.profile.displayName` or `items[].price`, against the route's 2xx/default response shapes. It follows member access, optional chaining, literal bracket keys, renamed/nested/defaulted destructuring, `for...of` and array-callback elements, and up to three alias hops.

A path is `breaking` only when every success response has a complete inline shape that lacks it and the read is exact, meaning an exact path through an exact route match. The overall verdict is `compatible` only when nothing broke and both producer and consumer coverage are complete. These leave it `unknown`: computed keys (`dynamic-computed-access`), the whole response escaping the scan, a known object passed on whole, symbol-typed or spread producer shapes, a path present in only some success responses, and consumer facts indexed before 1.0.12 (`legacy-consumer-facts`). `api_impact` and `api_drift` embed the same results in an additive `shapeChecks` field, capped at 20 findings per route. `totalFindings` stays exact.
