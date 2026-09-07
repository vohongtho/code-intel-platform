# Design: Resilient GQL query results and Query Panel rendering

## 1. Context

`POST /api/v1/query` supports four statement families:

- `FIND`;
- `TRAVERSE`;
- `PATH`;
- `COUNT`.

The executor currently returns a structurally heterogeneous object. `COUNT` returns `groups` but no `nodes`, while the Web client type declares `nodes` as required. The Query Panel then reads `result.nodes.length` for every successful result.

The backend response is valid according to the core type, but invalid according to the Web type. Because JSON is cast rather than validated, the mismatch becomes a render-time exception.

This design introduces one stable transport contract and a layered containment strategy.

---

## 2. Design principles

1. A successful first-party API response must always be safe for first-party clients to render.
2. Transport shapes must be stable even when statement semantics differ.
3. Statement-specific behavior must be represented explicitly through a discriminant.
4. Network JSON must be normalized or validated at runtime.
5. Frontend rendering must not rely on unchecked optional fields.
6. A panel failure must not unmount the whole application.
7. Legacy response compatibility must be preserved during local server/UI version skew.

---

## 3. Target architecture

```text
GQL text
  → lexer/parser
  → QueryAST
  → statement executor
  → normalized GQLResult
  → HTTP contract validation
  → JSON response
  → Web runtime normalization
  → render by result.kind
  → local error boundary
```

The normalized contract becomes the single representation used by core tests, HTTP, the Web API client, and the Query Panel.

---

## 4. Result model

### 4.1 Discriminant

```ts
export type GQLResultKind =
  | 'nodes'
  | 'traversal'
  | 'path'
  | 'aggregate';
```

### 4.2 Stable result

```ts
export interface GQLResult {
  kind: GQLResultKind;
  nodes: CodeNode[];
  edges: CodeEdge[];
  groups: CountGroup[];
  path: CodeNode[] | null;
  executionTimeMs: number;
  truncated: boolean;
  totalCount: number;
}
```

Every successful result includes every field. Fields that do not apply use an empty array or `null`.

### 4.3 Mapping

| AST type | Result kind | Populated collections |
| --- | --- | --- |
| `FIND` | `nodes` | `nodes` |
| `TRAVERSE` | `traversal` | `nodes`, `edges` |
| `PATH` | `path` | `path`, `nodes`, `edges` |
| `COUNT` | `aggregate` | `groups` |

---

## 5. Core implementation

### 5.1 Result factory

Create one internal result factory in `gql-executor.ts` or a dedicated `gql-result.ts` module.

```ts
function createGQLResult(
  kind: GQLResultKind,
  input: Partial<GQLResult>,
): GQLResult;
```

The factory must:

- populate empty arrays;
- populate `path: null`;
- normalize finite non-negative numeric metadata;
- preserve truncation state;
- reject impossible result kinds in development/tests.

### 5.2 Executor behavior

Each executor calls the result factory. No executor returns a partial transport object directly.

`executeCOUNT()` continues to avoid materializing matching nodes. It only builds group counts and passes empty collections to the factory.

### 5.3 Default switch behavior

The default branch in `executeGQL()` must not silently return a node-like empty result for an unknown AST. It should be unreachable in TypeScript and throw a controlled internal error if reached at runtime.

---

## 6. HTTP implementation

### 6.1 Response validation

The route validates the normalized result before serialization. Validation may be a dedicated type guard or schema function.

```ts
validateGQLResult(result): GQLResult
```

Validation verifies:

- known `kind`;
- arrays for `nodes`, `edges`, `groups`;
- array or `null` for `path`;
- finite non-negative execution time;
- finite non-negative integer count;
- boolean truncation flag;
- valid group records.

### 6.2 Error behavior

The existing status behavior remains:

- `400` invalid request body;
- `422` parse error;
- `408` truncated execution;
- `500` unexpected internal result or exception.

The server logs the full exception with request ID. The client receives a safe error envelope.

### 6.3 OpenAPI

Document one successful response schema with stable fields and `kind` enum. Use examples for all four result kinds.

---

## 7. Shared types

Preferred location: a shared query-contract module consumable by core and Web.

Possible path:

```text
code-intel/shared/src/query.ts
```

Exports:

- `GQLResultKind`;
- `CountGroup`;
- transport-safe `GQLResult`.

If moving the type creates excessive release risk, retain separate definitions temporarily but add a compile-time assignability test and identical runtime contract tests.

---

## 8. Web API normalization

### 8.1 Normalizer

Add a pure function:

```ts
export function normalizeGQLResult(value: unknown): GQLResult
```

It accepts both the new result and legacy responses.

### 8.2 Legacy kind inference

Inference order:

1. known explicit `kind`;
2. `groups` array present → `aggregate`;
3. `path` array or `null` explicitly present → `path`;
4. non-empty `edges` → `traversal`;
5. otherwise → `nodes`.

### 8.3 Collection normalization

```ts
nodes: Array.isArray(value.nodes) ? value.nodes : []
edges: Array.isArray(value.edges) ? value.edges : []
groups: Array.isArray(value.groups) ? value.groups : []
path: Array.isArray(value.path) ? value.path : null
```

Group entries must be filtered or rejected when malformed. The chosen policy must be deterministic and tested.

### 8.4 Invalid response

A response with unusable scalar metadata or invalid collection primitives throws `InvalidGQLResultError`. `queryGQL()` converts it to a user-safe message.

---

## 9. Query Panel rendering

### 9.1 Safe local variables

```ts
const nodes = result?.nodes ?? [];
const edges = result?.edges ?? [];
const groups = result?.groups ?? [];
```

No render expression accesses a response field without normalization.

### 9.2 Render switch

```tsx
switch (result.kind) {
  case 'aggregate':
    return <GroupTable groups={groups} />;
  case 'path':
    return <PathResult ... />;
  case 'traversal':
    return <NodeTable ... />;
  case 'nodes':
    return <NodeTable ... />;
}
```

The initial patch may reuse the existing NodeTable for path and traversal results, but aggregate rendering must be explicit.

### 9.3 Empty states

- empty `nodes`: `No matching nodes.`
- empty `aggregate`: `Count: 0` or `No groups matched.`
- missing path: `No path found.`
- traversal with no start node: `No traversal result.`

### 9.4 Error containment

Add a local error boundary around the Query Panel result renderer. It resets when a new query begins or when the query text changes, according to the final component contract.

The fallback displays an error and a retry action while preserving the rest of the application.

---

## 10. State behavior

On query start:

- set loading true;
- clear current error;
- use the existing product decision on whether to retain or clear the prior result.

On success:

- normalize response;
- update result;
- update history only after successful normalization.

On failure:

- set a panel-scoped error;
- ensure loading becomes false;
- never update history with a failed query unless an explicit future requirement changes this behavior.

---

## 11. Test design

### Core unit tests

- parser accepts grouped count;
- parser rejects incomplete group clauses;
- every executor result has stable fields;
- aggregate result has empty node/edge arrays and `path: null`;
- unknown AST fails safely.

### HTTP integration tests

- grouped count returns `200` and normalized aggregate shape;
- plain count returns normalized shape;
- find/traverse/path retain expected semantics;
- parse error returns `422`;
- malformed internal result returns `500` through an injected seam.

### Web unit tests

- normalizer accepts new aggregate response;
- normalizer accepts legacy aggregate response without nodes;
- Query Panel renders GroupTable without throwing;
- malformed response becomes a visible error;
- local error boundary preserves application shell.

### Browser test

Submit the exact reported query and assert:

- no uncaught page exception;
- group table appears;
- navigation remains usable after the query.

---

## 12. Compatibility

The backend adds fields and normalizes existing fields. It does not remove existing data.

The Web normalizer accepts both old and new server responses. This supports local development where the browser may still have cached assets from a different process version.

No index, schema, or persistent storage migration is needed.

---

## 13. Risks and mitigations

### Risk: Consumers depend on omitted properties

Mitigation: adding empty arrays is additive JSON behavior and safer than omission.

### Risk: Shared type move causes package dependency issues

Mitigation: keep the initial transport type local and enforce structural parity if necessary.

### Risk: Runtime normalization hides server defects

Mitigation: normalize compatible legacy omissions but reject invalid primitives and log diagnostics in development.

### Risk: Error boundary masks programming errors

Mitigation: report/log the original error; use the boundary only as containment.

### Risk: `408` responses are treated as errors by the Web client

The current client throws for any non-2xx response, while the server sends a result body with `408` for truncated queries. Implementation must decide explicitly whether a truncated query is a usable result or an error. The recommended behavior is to return `200` with `truncated: true` for completed partial results, or teach `queryGQL()` to parse the normalized result body on `408`. This decision must be covered by tests and documented consistently.

---

## 14. Implementation sequence

1. Add shared/normalized result types.
2. Add result factory and update executors.
3. Add HTTP validation and OpenAPI schema.
4. Add Web response normalizer.
5. Update Query Panel safe rendering and result-kind switch.
6. Add local error boundary.
7. Add core, HTTP, Web, and browser tests.
8. Update changelog and release notes.
9. Run full release validation.

---

## 15. Decision

Use both server normalization and client resilience. Fixing only `result.nodes?.length` removes the immediate exception but leaves the contract mismatch and future crash vectors unresolved. Fixing only the backend leaves the UI vulnerable to cached/legacy servers and malformed responses.

The accepted design is a stable transport contract plus runtime client normalization plus local render containment.
