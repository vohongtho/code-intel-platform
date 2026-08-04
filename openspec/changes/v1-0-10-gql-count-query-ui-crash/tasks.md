# Tasks

## 1. Reproduce and lock the regression

- [x] Add a failing Web regression test for the exact response produced by `COUNT function GROUP BY cluster` when `nodes` is absent.
- [x] Add an authenticated HTTP integration test that posts `{"gql":"COUNT function GROUP BY cluster"}` to `/api/v1/query`.
- [x] Record the current exception signature and confirm the failure is render-time rather than an API transport failure.
- [x] Verify the same issue for plain `COUNT function` and any aggregate result with no node collection.

## 2. Define the shared GQL result contract

- [x] Add `GQLResultKind` with `nodes`, `traversal`, `path`, and `aggregate` variants.
- [x] Define one normalized successful `GQLResult` contract with required `nodes`, `edges`, `groups`, `path`, `executionTimeMs`, `truncated`, and `totalCount` fields.
- [x] Move the transport contract into `code-intel/shared` when dependency boundaries allow it.
- [x] Otherwise keep core and Web definitions structurally identical and add a compile-time compatibility assertion. Superseded because the transport contract moved into `code-intel/shared`.
- [x] Document the statement-to-result-kind mapping.

## 3. Normalize core executor results

- [x] Add a `createGQLResult()` or equivalent factory.
- [x] Update `executeFIND()` to return `kind: 'nodes'` and complete collection fields.
- [x] Update `executeTRAVERSE()` to return `kind: 'traversal'` and complete collection fields.
- [x] Update `executePATH()` to return `kind: 'path'` and complete collection fields.
- [x] Update `executeCOUNT()` to return `kind: 'aggregate'`, empty `nodes`/`edges`, and `path: null`.
- [x] Replace the silent default result in `executeGQL()` with an exhaustive or controlled failure path.
- [x] Preserve the current aggregate counting and descending group ordering behavior.

## 4. Validate the HTTP response contract

- [x] Add a pure `validateGQLResult()` or equivalent runtime validator.
- [x] Validate result kind, collection types, group records, counts, timing, and truncation before serialization.
- [x] Preserve `400` for missing/invalid `gql` request fields.
- [x] Preserve `422` for parse errors.
- [x] Decide and document whether truncated partial results remain `408` or become `200` with `truncated: true`.
- [x] Ensure unexpected result shapes return a structured `500` without stack traces.
- [x] Log request ID, statement type, result kind, duration, and safe error category.

## 5. Update OpenAPI documentation

- [x] Define the normalized GQL successful response schema.
- [x] Add the result-kind enum.
- [x] Add examples for FIND, TRAVERSE, PATH, plain COUNT, and grouped COUNT.
- [x] Document the chosen truncated-result status behavior.
- [x] Keep existing structured error envelopes documented.

## 6. Add Web runtime normalization

- [x] Add exported `normalizeGQLResult(value: unknown)` in the Web API layer.
- [x] Accept the new normalized response shape.
- [x] Accept legacy aggregate responses that contain `groups` but omit `nodes`, `edges`, `path`, and `kind`.
- [x] Infer a legacy result kind deterministically.
- [x] Normalize absent collections to empty arrays and absent path to `null`.
- [x] Reject unusable primitive or malformed group values with a typed client error.
- [x] Update `ApiClient.queryGQL()` to return only normalized results.
- [x] Ensure query history is updated only after successful normalization.

## 7. Make Query Panel rendering safe

- [x] Replace direct `result.nodes.length` access with normalized local collections.
- [x] Render primary content by `result.kind`.
- [x] Render `GroupTable` for aggregate results even when nodes are empty.
- [x] Render explicit empty states for aggregate, node, traversal, and path results.
- [x] Keep total count, execution time, and truncation indicators visible.
- [x] Ensure loading is cleared in every success/failure path.
- [x] Ensure malformed responses appear as panel errors rather than render exceptions.

## 8. Add local render containment

- [x] Add a Query Panel result error boundary or equivalent local containment component.
- [x] Keep the graph canvas, navigation, and other panels mounted after a result-render failure.
- [x] Display a user-facing retry message.
- [x] Reset the boundary deterministically for a new query attempt.
- [x] Log the original render error in development without exposing sensitive data.

## 9. Core tests

- [x] Extend `gql-parser.test.ts` for grouped COUNT and malformed GROUP BY forms.
- [x] Extend `gql-executor.test.ts` to assert every result kind has all normalized fields.
- [x] Assert grouped COUNT returns `kind: 'aggregate'`.
- [x] Assert aggregate results contain empty `nodes` and `edges`, plus `path: null`.
- [x] Assert missing cluster metadata groups under `(none)`.
- [x] Assert group results remain sorted by descending count.
- [x] Assert zero-match aggregate behavior matches the documented contract.
- [x] Assert the unexpected AST path fails safely.

## 10. HTTP integration tests

- [x] Test the exact reported grouped COUNT payload.
- [x] Assert status, result kind, normalized collections, and scalar metadata.
- [x] Test plain COUNT, FIND, TRAVERSE, and PATH result shapes.
- [x] Test missing payload `400`.
- [x] Test parse error `422`.
- [x] Test truncated-result behavior.
- [x] Add an injected malformed-result test proving a structured `500` response.
- [x] Assert no unhandled rejection or process crash occurs.

## 11. Web tests

- [x] Unit-test `normalizeGQLResult()` with new and legacy aggregate responses.
- [x] Test missing collections, unknown kind, invalid scalars, malformed groups, and non-JSON error responses.
- [x] Component-test Query Panel with grouped COUNT results.
- [x] Assert GroupTable renders and NodeTable does not render for aggregate-only data.
- [x] Test plain count, empty count, FIND, TRAVERSE, and PATH responses.
- [x] Test API `422` and `500` responses.
- [x] Test error-boundary containment.

## 12. Browser-equivalent regression coverage

- [x] Cover the packaged Web UI entry routes with server-level SPA smoke tests.
- [x] Exercise `COUNT function GROUP BY cluster` through Query Panel component regression coverage.
- [x] Assert the group table is visible.
- [x] Assert no uncaught render exception occurs in Query Panel regression coverage.
- [x] Prove the wider application remains usable after contained result-render failures.

## 13. Documentation and release record

- [x] Update README/core README GQL response examples if they imply `nodes` is always present.
- [x] Update `CHANGELOG.md` under v1.0.10.
- [x] Update `docs/releases/v1.0.10.md` with the crash fix and compatibility behavior.
- [x] Document the stable result-kind contract for API consumers.

## 14. Release validation

- [x] Run core typecheck and full core tests.
- [x] Run Web typecheck, component tests, and production build.
- [x] Run HTTP integration tests.
- [x] Run browser-equivalent regression coverage.
- [x] Validate the packaged CLI/Web distribution.
- [x] Run package/version checks and high/critical audit gate.
- [x] Verify the exact reported payload against the final packaged server.

## 15. Completion criteria

- [x] `COUNT function GROUP BY cluster` never crashes the Query Panel or Web UI.
- [x] All successful GQL responses use the stable normalized contract.
- [x] The Web client remains compatible with legacy aggregate responses that omit `nodes`.
- [x] Invalid query and invalid response errors remain panel-scoped.
- [x] No supported GQL statement can cause an unchecked absent-array dereference.
- [x] All release gates pass on the same final commit.
