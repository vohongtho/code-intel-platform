# v1.0.10: Prevent GQL aggregate queries from crashing the Web UI

## Change ID

`v1-0-10-gql-count-query-ui-crash`

## Release

`1.0.10`

## Priority

`P0 — User-visible crash and API response-contract correctness`

## Owner area

`gql-query-api-and-web-ui`

## One-liner

Make every successful GQL response safe to render by defining a stable discriminated result contract, normalizing missing collection fields, and ensuring the Web UI handles aggregate-only results without dereferencing absent node arrays.

---

## 1. Summary

The GQL Query Console currently crashes when a user executes a valid aggregate query such as:

```http
POST http://localhost:4747/api/v1/query
Content-Type: application/json

{
  "gql": "COUNT function GROUP BY cluster"
}
```

The query is valid and the backend executes it successfully. The `COUNT` executor returns an aggregate result containing `groups`, `totalCount`, `executionTimeMs`, and `truncated`, but it does not include a `nodes` property.

The Web UI currently models `nodes` as a required array and evaluates:

```ts
result.nodes.length
```

for every successful query result. When the aggregate response omits `nodes`, React rendering throws a runtime exception similar to:

```text
Cannot read properties of undefined (reading 'length')
```

This turns a valid API response into a Web UI crash.

Version 1.0.10 must establish an explicit GQL result contract that supports node results, path/traversal results, and aggregate results without requiring consumers to guess which properties exist.

The fix must be defense in depth:

1. the backend returns a stable and documented successful response shape;
2. the frontend treats result collections as optional or normalized and never dereferences an absent field;
3. a component-level failure must not take down the entire Web UI;
4. regression tests cover every supported GQL statement type.

---

## 2. Reproduction

### 2.1 Preconditions

- Code Intel server is running at `http://localhost:4747`;
- the user is authenticated with at least the `viewer` role;
- an indexed repository is loaded;
- the graph contains function nodes.

### 2.2 Request

```bash
curl -X POST 'http://localhost:4747/api/v1/query' \
  -H 'Content-Type: application/json' \
  -H 'X-CSRF-Token: <token>' \
  --cookie '<session-cookie>' \
  --data '{"gql":"COUNT function GROUP BY cluster"}'
```

### 2.3 Current successful backend response

The current executor can produce a response equivalent to:

```json
{
  "groups": [
    { "key": "authentication", "count": 12 },
    { "key": "storage", "count": 8 },
    { "key": "(none)", "count": 3 }
  ],
  "executionTimeMs": 1,
  "truncated": false,
  "totalCount": 23,
  "format": "json"
}
```

The response is a valid aggregate result but has no `nodes` field.

### 2.4 Current frontend failure

The Query Panel calculates:

```ts
const hasNodes = result && result.nodes.length > 0;
```

Because `result.nodes` is `undefined`, the render path throws before the group table can be displayed.

### 2.5 Expected behavior

The Query Panel must render:

- the total result count;
- execution time;
- truncation status when applicable;
- a group/count table;
- no page-level or panel-level crash.

---

## 3. Confirmed root cause

### 3.1 Backend result type permits omitted collections

The core executor defines a result where collections are optional:

```ts
export interface GQLResult {
  nodes?: CodeNode[];
  edges?: CodeEdge[];
  groups?: CountGroup[];
  path?: CodeNode[] | null;
  executionTimeMs: number;
  truncated: boolean;
  totalCount: number;
}
```

`executeCOUNT()` returns only `groups` and scalar metadata.

This is internally consistent with the executor type.

### 3.2 Web client declares a stricter incompatible type

The Web API client currently declares:

```ts
export interface GQLResult {
  nodes: CodeNode[];
  edges?: CodeEdge[];
  groups?: CountGroup[];
  executionTimeMs: number;
  truncated: boolean;
  totalCount: number;
}
```

The required `nodes` property does not match the backend contract.

TypeScript does not validate JSON received at runtime, so the response is cast to the incompatible frontend type without detection.

### 3.3 Query Panel assumes node-oriented results

The Query Panel uses `result.nodes.length` without normalization or optional chaining.

The code does not first determine the statement/result kind and therefore treats aggregate-only responses as node responses.

### 3.4 API route forwards heterogeneous results unchanged

The HTTP route currently serializes the executor result directly:

```ts
res.status(statusCode).json({ ...result, format: format ?? 'json' });
```

Therefore successful responses have different property sets depending on the GQL statement.

### 3.5 Missing containment boundary

The Query Panel catches asynchronous API errors, but a React render exception occurs after the request succeeds. The existing `try/catch` around `await client.queryGQL()` cannot catch render-time exceptions.

Without a local error boundary, a malformed or unexpected successful result can destabilize the wider Web UI.

---

## 4. Problem statement

A successful API response must never crash a supported first-party client.

The current implementation violates this requirement because:

- backend and frontend define incompatible versions of `GQLResult`;
- successful response fields vary implicitly by statement type;
- raw JSON is trusted without runtime normalization;
- the UI assumes `nodes` exists for every query;
- aggregate queries are included as built-in examples but their response shape is unsafe for the same panel;
- render-time exceptions are not contained locally.

The issue is broader than one query string. Any current or future GQL result that omits a collection assumed by the UI could trigger the same class of failure.

---

## 5. Goals

This change must:

1. make `COUNT function GROUP BY cluster` render successfully;
2. make plain `COUNT function` render successfully;
3. align the core, HTTP, and Web UI GQL result contracts;
4. prevent absent arrays from causing render exceptions;
5. distinguish node, traversal, path, and aggregate results explicitly;
6. preserve current GQL syntax and query semantics;
7. return structured API errors for invalid queries without crashing the UI;
8. add regression tests at executor, HTTP, API-client normalization, and React component levels;
9. ensure unexpected result shapes are contained and displayed as a user-facing error;
10. preserve backward compatibility for consumers that already read `nodes`, `edges`, `groups`, or `path`.

---

## 6. Proposed result contract

### 6.1 Add an explicit result kind

Every successful GQL response must include a discriminant:

```ts
export type GQLResultKind =
  | 'nodes'
  | 'traversal'
  | 'path'
  | 'aggregate';
```

Proposed normalized contract:

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
  format?: 'json';
}
```

All collection fields are present in every successful JSON response:

- `nodes`: empty array when not applicable;
- `edges`: empty array when not applicable;
- `groups`: empty array when not applicable;
- `path`: `null` when not applicable.

This creates a stable transport shape while `kind` communicates which representation is primary.

### 6.2 Statement-to-result mapping

| GQL statement | `kind` | Primary data |
| --- | --- | --- |
| `FIND` | `nodes` | `nodes` |
| `TRAVERSE` | `traversal` | `nodes`, `edges` |
| `PATH` | `path` | `path`, `nodes`, `edges` |
| `COUNT` | `aggregate` | `groups` |

### 6.3 Example aggregate response

```json
{
  "kind": "aggregate",
  "nodes": [],
  "edges": [],
  "groups": [
    { "key": "authentication", "count": 12 },
    { "key": "storage", "count": 8 },
    { "key": "(none)", "count": 3 }
  ],
  "path": null,
  "executionTimeMs": 1,
  "truncated": false,
  "totalCount": 23,
  "format": "json"
}
```

### 6.4 Example plain count response

```json
{
  "kind": "aggregate",
  "nodes": [],
  "edges": [],
  "groups": [
    { "key": "total", "count": 23 }
  ],
  "path": null,
  "executionTimeMs": 1,
  "truncated": false,
  "totalCount": 23,
  "format": "json"
}
```

---

## 7. Backend changes

### 7.1 Normalize results in the executor

Preferred approach: make each executor return the complete normalized result contract directly.

Example helper:

```ts
function createGQLResult(
  kind: GQLResultKind,
  values: Partial<Omit<GQLResult, 'kind' | 'nodes' | 'edges' | 'groups' | 'path'>> & {
    nodes?: CodeNode[];
    edges?: CodeEdge[];
    groups?: CountGroup[];
    path?: CodeNode[] | null;
  },
): GQLResult {
  return {
    kind,
    nodes: values.nodes ?? [],
    edges: values.edges ?? [],
    groups: values.groups ?? [],
    path: values.path ?? null,
    executionTimeMs: values.executionTimeMs ?? 0,
    truncated: values.truncated ?? false,
    totalCount: values.totalCount ?? 0,
  };
}
```

This avoids relying only on HTTP-route normalization and keeps CLI, MCP, tests, and future consumers consistent.

### 7.2 HTTP response validation

Before sending a successful response, the route must validate or normalize the result.

It must not emit:

- missing scalar metadata;
- non-array collection fields;
- a missing or unknown `kind`;
- negative or non-finite counts/timings.

Unexpected internal result shapes must produce a structured `500` response and a server log entry rather than partially serializing invalid data.

### 7.3 Preserve error semantics

The endpoint must continue returning:

- `400` for a missing or non-string `gql` field;
- `422` for GQL parse errors;
- `408` when execution reaches the existing truncation/timeout policy;
- `500` for unexpected internal failures.

All errors must retain the established envelope:

```json
{
  "error": {
    "code": "...",
    "message": "...",
    "hint": "...",
    "requestId": "...",
    "timestamp": "..."
  }
}
```

### 7.4 Do not return stack traces

Internal exception stack traces must remain server-side. The API response may include a safe message and request ID only.

---

## 8. Web API client changes

### 8.1 Share or mirror the exact transport type

The Web UI must no longer declare `nodes` as required while the server treats it as optional.

The preferred implementation is to place the transport type in a shared package imported by both core and Web UI.

If sharing is not feasible in this patch, the two definitions must be structurally identical and covered by contract tests.

### 8.2 Runtime normalization

Because network JSON is untrusted at runtime, `queryGQL()` must normalize the response before returning it to React.

Example:

```ts
function normalizeGQLResult(value: unknown): GQLResult {
  const candidate = value as Partial<GQLResult>;
  return {
    kind: isKnownKind(candidate.kind) ? candidate.kind : inferLegacyKind(candidate),
    nodes: Array.isArray(candidate.nodes) ? candidate.nodes : [],
    edges: Array.isArray(candidate.edges) ? candidate.edges : [],
    groups: Array.isArray(candidate.groups) ? candidate.groups : [],
    path: Array.isArray(candidate.path) ? candidate.path : null,
    executionTimeMs: finiteNumber(candidate.executionTimeMs, 0),
    truncated: candidate.truncated === true,
    totalCount: finiteNumber(candidate.totalCount, 0),
    format: 'json',
  };
}
```

Runtime normalization provides backward compatibility with pre-fix servers that omit empty arrays.

### 8.3 Reject unusable responses

If the response cannot be normalized safely, the client must throw a typed error such as:

```text
The query server returned an invalid result shape.
```

The UI must display this error inside the Query Panel instead of crashing.

---

## 9. Query Panel changes

### 9.1 Never dereference an unverified collection

The component must not use:

```ts
result.nodes.length
```

unless `nodes` has already been normalized.

Safe behavior:

```ts
const nodes = result?.nodes ?? [];
const groups = result?.groups ?? [];
const edges = result?.edges ?? [];

const hasNodes = nodes.length > 0;
const hasGroups = groups.length > 0;
```

### 9.2 Render by result kind

The primary render path should use `result.kind`:

```text
nodes       → NodeTable
traversal   → NodeTable plus edge count
path        → path-oriented result presentation
aggregate   → GroupTable
```

Empty valid aggregate results must display an aggregate-specific empty state rather than a generic node-oriented message.

Examples:

```text
No matching functions were found.
```

or:

```text
Count: 0
```

### 9.3 Preserve prior result during a failed request

A failed request should not corrupt component state. The panel may either:

- preserve the previous successful result and show a new error; or
- clear the previous result intentionally.

The behavior must be deterministic and tested.

### 9.4 Component error boundary

Wrap the Query Panel result renderer in a local error boundary.

An unexpected render error must result in a contained message such as:

```text
The query result could not be displayed.
Run the query again or inspect the server response using the request ID.
```

The rest of the Web UI, graph, navigation, and other panels must remain usable.

The boundary is a last-resort containment mechanism, not a substitute for contract normalization.

---

## 10. API compatibility

### 10.1 Additive fields

Adding `kind`, empty arrays, and `path: null` is backward compatible for JSON consumers that ignore unknown fields.

Existing consumers reading:

- `nodes`;
- `edges`;
- `groups`;
- `path`;
- `executionTimeMs`;
- `truncated`;
- `totalCount`;

remain supported.

### 10.2 Legacy server compatibility

The new Web UI client must tolerate a legacy successful aggregate response that contains `groups` but omits `nodes`, `edges`, `path`, and `kind`.

The client should infer:

```text
groups present → aggregate
path present   → path
edges present  → traversal
otherwise      → nodes
```

This prevents a newly built UI from crashing while connected to a slightly older local server process.

### 10.3 No syntax changes

This proposal does not change valid GQL syntax. The following remains valid:

```gql
COUNT function GROUP BY cluster
```

---

## 11. Validation rules

A successful GQL response is valid when:

1. `kind` is a supported result kind;
2. `nodes`, `edges`, and `groups` are arrays;
3. `path` is an array or `null`;
4. `executionTimeMs` is a finite non-negative number;
5. `totalCount` is a finite non-negative integer;
6. `truncated` is boolean;
7. every group has a string `key` and finite non-negative integer `count`;
8. an aggregate response may contain zero nodes and zero edges;
9. an empty aggregate response is still successful;
10. timeout/truncated responses retain the same normalized body shape.

---

## 12. Required test coverage

### 12.1 Parser tests

Retain and verify parsing for:

```gql
COUNT function
COUNT function GROUP BY cluster
COUNT * WHERE exported = true GROUP BY language
```

Include malformed forms:

```gql
COUNT
COUNT function GROUP cluster
COUNT function GROUP BY
```

Malformed queries must return parse errors and must not reach execution.

### 12.2 Executor tests

For every statement type, assert all normalized fields are present:

```text
kind
nodes
edges
groups
path
executionTimeMs
truncated
totalCount
```

Specific aggregate assertions:

- `COUNT function` returns `kind: aggregate`;
- `nodes` and `edges` are empty arrays;
- `path` is `null`;
- groups contain the `total` bucket;
- grouped count includes `(none)` for missing cluster metadata;
- groups are sorted descending by count;
- zero matches return an empty or explicit zero-count aggregate according to the final chosen contract;
- timeout/truncation still returns a normalized aggregate shape.

### 12.3 HTTP integration tests

Add an authenticated test for:

```http
POST /api/v1/query
{"gql":"COUNT function GROUP BY cluster"}
```

Assert:

- status `200`;
- response `kind` is `aggregate`;
- response `nodes`, `edges`, and `groups` are arrays;
- response `path` is `null`;
- no server process exception or unhandled rejection occurs.

Also cover:

- plain `COUNT`;
- `FIND`;
- `TRAVERSE`;
- `PATH`;
- parse error `422`;
- missing payload `400`;
- execution truncation `408`;
- invalid internal result normalization `500` through an injected test seam.

### 12.4 Web API-client tests

Test `normalizeGQLResult()` with:

1. the new normalized aggregate response;
2. a legacy aggregate response with only `groups`;
3. a legacy node response with only `nodes`;
4. missing collection fields;
5. invalid scalar values;
6. malformed groups;
7. unknown `kind`;
8. non-JSON/error responses.

### 12.5 Query Panel component tests

Render the panel with mocked responses for:

- grouped aggregate result;
- plain count result;
- empty aggregate result;
- node result;
- traversal result;
- path result;
- legacy aggregate result without `nodes`;
- malformed successful response;
- API `422` response;
- API `500` response.

Assert:

- no render throws;
- GroupTable appears for aggregate results;
- NodeTable does not appear for aggregate-only results;
- errors appear inside the panel;
- the rest of the application remains mounted;
- loading state always clears.

### 12.6 Browser regression test

Add a Playwright or equivalent browser test that:

1. opens the Web UI;
2. opens the GQL Query Console;
3. submits `COUNT function GROUP BY cluster`;
4. verifies the group table renders;
5. verifies no uncaught browser exception is emitted;
6. navigates to another panel afterward to prove the application remains usable.

---

## 13. Observability

The server should log query failures with:

- request ID;
- statement type when parsing succeeded;
- result kind when execution succeeded;
- execution duration;
- truncation status;
- safe error category.

Do not log:

- authentication cookies;
- CSRF tokens;
- arbitrary sensitive source content;
- stack traces in the client response.

The Web UI may log an unexpected normalization failure to the browser console in development mode, but the user-facing UI must remain stable.

---

## 14. Security and safety

This change must preserve:

- viewer-role authorization;
- CSRF protection;
- request size limits;
- rate limiting;
- GQL parser validation;
- execution timeout policy;
- structured error envelopes;
- no evaluation of arbitrary JavaScript;
- no exposure of server stack traces.

Runtime response validation must not introduce dynamic code execution or unsafe property traversal.

---

## 15. Performance considerations

Normalizing four small collection fields adds negligible overhead.

The fix must not:

- copy the graph;
- materialize additional node arrays for aggregate queries;
- run a query twice;
- add database access to the render path;
- increase the existing GQL execution timeout.

Empty arrays should be allocated once per response or through a lightweight result factory.

---

## 16. In scope

- normalize the core GQL result contract;
- add an explicit result discriminant;
- align core and Web UI types;
- normalize network responses at runtime;
- make Query Panel rendering null-safe;
- render aggregate results intentionally;
- contain unexpected Query Panel render failures;
- add parser, executor, HTTP, API-client, component, and browser regression tests;
- update OpenAPI documentation for `/api/v1/query`;
- update GQL examples/documentation if response examples currently imply `nodes` is always present;
- update changelog and release notes for the crash fix.

---

## 17. Non-goals

This change will not:

- redesign the GQL language;
- add SQL or Cypher support;
- change clustering algorithms;
- change how cluster metadata is assigned;
- add new aggregation functions beyond existing `COUNT`;
- add chart visualization for grouped results;
- change authentication or authorization;
- remove the current `format` field;
- introduce server-side streaming;
- change graph indexing or Generation V2 behavior;
- change the semantics of `(none)` for missing group properties;
- redesign the entire Web UI error-boundary hierarchy.

---

## 18. Migration and rollout

No persistent-data migration is required.

Rollout sequence:

1. add shared/normalized result types;
2. update executor result factories;
3. normalize and validate HTTP responses;
4. update Web API client runtime normalization;
5. update Query Panel rendering;
6. add local error containment;
7. add regression tests;
8. update OpenAPI and release notes;
9. run full Web and core test suites;
10. validate the packaged CLI/Web distribution against a real indexed repository.

Rollback is code-only. Returning to the previous implementation requires no index migration, but would reintroduce the crash and is therefore not recommended.

---

## 19. Acceptance criteria

The change is complete when all of the following are true:

1. Calling `/api/v1/query` with `{"gql":"COUNT function GROUP BY cluster"}` returns a normalized successful response.
2. The Web UI displays the group table without a React render exception.
3. `result.nodes` is never dereferenced unless it is a verified array.
4. Every successful GQL statement returns the documented common fields.
5. The response contains an explicit `kind` discriminant.
6. The new Web client can safely consume the previous aggregate response shape that omitted `nodes`.
7. Invalid GQL returns a visible panel error and does not crash the application.
8. Malformed successful JSON is rejected or normalized safely.
9. A Query Panel rendering failure is contained locally.
10. Core executor tests cover all GQL result kinds.
11. HTTP integration tests cover grouped count and plain count.
12. Web component tests prove aggregate-only responses do not crash.
13. A browser regression test completes the grouped-count flow with zero uncaught exceptions.
14. OpenAPI accurately documents the successful result variants and normalized fields.
15. Core typecheck, Web typecheck, full tests, production build, package validation, and security audit pass on the same commit.

---

## 20. Final decision

Code Intel 1.0.10 will replace the implicit heterogeneous response contract:

```text
COUNT query
  → backend returns groups but no nodes
  → Web UI assumes nodes exists
  → render exception
  → Web UI crashes
```

with an explicit, normalized, and resilient contract:

```text
GQL query
  → parser produces statement AST
  → executor returns a result kind plus normalized collections
  → HTTP validates and serializes the stable contract
  → Web client normalizes legacy/new responses
  → Query Panel renders by result kind
  → unexpected failures remain contained inside the panel
```

A valid aggregate query must always produce a valid aggregate view, never an application crash.
