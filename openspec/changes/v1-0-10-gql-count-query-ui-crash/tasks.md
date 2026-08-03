# Tasks

## 1. Reproduce and lock the regression

- [ ] Add a failing Web regression test for the exact response produced by `COUNT function GROUP BY cluster` when `nodes` is absent.
- [ ] Add an authenticated HTTP integration test that posts `{"gql":"COUNT function GROUP BY cluster"}` to `/api/v1/query`.
- [ ] Record the current exception signature and confirm the failure is render-time rather than an API transport failure.
- [ ] Verify the same issue for plain `COUNT function` and any aggregate result with no node collection.

## 2. Define the shared GQL result contract

- [ ] Add `GQLResultKind` with `nodes`, `traversal`, `path`, and `aggregate` variants.
- [ ] Define one normalized successful `GQLResult` contract with required `nodes`, `edges`, `groups`, `path`, `executionTimeMs`, `truncated`, and `totalCount` fields.
- [ ] Move the transport contract into `code-intel/shared` when dependency boundaries allow it.
- [ ] Otherwise keep core and Web definitions structurally identical and add a compile-time compatibility assertion.
- [ ] Document the statement-to-result-kind mapping.

## 3. Normalize core executor results

- [ ] Add a `createGQLResult()` or equivalent factory.
- [ ] Update `executeFIND()` to return `kind: 'nodes'` and complete collection fields.
- [ ] Update `executeTRAVERSE()` to return `kind: 'traversal'` and complete collection fields.
- [ ] Update `executePATH()` to return `kind: 'path'` and complete collection fields.
- [ ] Update `executeCOUNT()` to return `kind: 'aggregate'`, empty `nodes`/`edges`, and `path: null`.
- [ ] Replace the silent default result in `executeGQL()` with an exhaustive or controlled failure path.
- [ ] Preserve the current aggregate counting and descending group ordering behavior.

## 4. Validate the HTTP response contract

- [ ] Add a pure `validateGQLResult()` or equivalent runtime validator.
- [ ] Validate result kind, collection types, group records, counts, timing, and truncation before serialization.
- [ ] Preserve `400` for missing/invalid `gql` request fields.
- [ ] Preserve `422` for parse errors.
- [ ] Decide and document whether truncated partial results remain `408` or become `200` with `truncated: true`.
- [ ] Ensure unexpected result shapes return a structured `500` without stack traces.
- [ ] Log request ID, statement type, result kind, duration, and safe error category.

## 5. Update OpenAPI documentation

- [ ] Define the normalized GQL successful response schema.
- [ ] Add the result-kind enum.
- [ ] Add examples for FIND, TRAVERSE, PATH, plain COUNT, and grouped COUNT.
- [ ] Document the chosen truncated-result status behavior.
- [ ] Keep existing structured error envelopes documented.

## 6. Add Web runtime normalization

- [ ] Add exported `normalizeGQLResult(value: unknown)` in the Web API layer.
- [ ] Accept the new normalized response shape.
- [ ] Accept legacy aggregate responses that contain `groups` but omit `nodes`, `edges`, `path`, and `kind`.
- [ ] Infer a legacy result kind deterministically.
- [ ] Normalize absent collections to empty arrays and absent path to `null`.
- [ ] Reject unusable primitive or malformed group values with a typed client error.
- [ ] Update `ApiClient.queryGQL()` to return only normalized results.
- [ ] Ensure query history is updated only after successful normalization.

## 7. Make Query Panel rendering safe

- [ ] Replace direct `result.nodes.length` access with normalized local collections.
- [ ] Render primary content by `result.kind`.
- [ ] Render `GroupTable` for aggregate results even when nodes are empty.
- [ ] Render explicit empty states for aggregate, node, traversal, and path results.
- [ ] Keep total count, execution time, and truncation indicators visible.
- [ ] Ensure loading is cleared in every success/failure path.
- [ ] Ensure malformed responses appear as panel errors rather than render exceptions.

## 8. Add local render containment

- [ ] Add a Query Panel result error boundary or equivalent local containment component.
- [ ] Keep the graph canvas, navigation, and other panels mounted after a result-render failure.
- [ ] Display a user-facing retry message.
- [ ] Reset the boundary deterministically for a new query attempt.
- [ ] Log the original render error in development without exposing sensitive data.

## 9. Core tests

- [ ] Extend `gql-parser.test.ts` for grouped COUNT and malformed GROUP BY forms.
- [ ] Extend `gql-executor.test.ts` to assert every result kind has all normalized fields.
- [ ] Assert grouped COUNT returns `kind: 'aggregate'`.
- [ ] Assert aggregate results contain empty `nodes` and `edges`, plus `path: null`.
- [ ] Assert missing cluster metadata groups under `(none)`.
- [ ] Assert group results remain sorted by descending count.
- [ ] Assert zero-match aggregate behavior matches the documented contract.
- [ ] Assert the unexpected AST path fails safely.

## 10. HTTP integration tests

- [ ] Test the exact reported grouped COUNT payload.
- [ ] Assert status, result kind, normalized collections, and scalar metadata.
- [ ] Test plain COUNT, FIND, TRAVERSE, and PATH result shapes.
- [ ] Test missing payload `400`.
- [ ] Test parse error `422`.
- [ ] Test truncated-result behavior.
- [ ] Add an injected malformed-result test proving a structured `500` response.
- [ ] Assert no unhandled rejection or process crash occurs.

## 11. Web tests

- [ ] Unit-test `normalizeGQLResult()` with new and legacy aggregate responses.
- [ ] Test missing collections, unknown kind, invalid scalars, malformed groups, and non-JSON error responses.
- [ ] Component-test Query Panel with grouped COUNT results.
- [ ] Assert GroupTable renders and NodeTable does not render for aggregate-only data.
- [ ] Test plain count, empty count, FIND, TRAVERSE, and PATH responses.
- [ ] Test API `422` and `500` responses.
- [ ] Test error-boundary containment.

## 12. Browser regression test

- [ ] Open the packaged Web UI in Playwright or equivalent.
- [ ] Submit `COUNT function GROUP BY cluster` from the Query Console.
- [ ] Assert the group table is visible.
- [ ] Assert no uncaught browser exception occurs.
- [ ] Navigate to another panel after the query to prove the application remains usable.

## 13. Documentation and release record

- [ ] Update README/core README GQL response examples if they imply `nodes` is always present.
- [ ] Update `CHANGELOG.md` under v1.0.10.
- [ ] Update `docs/releases/v1.0.10.md` with the crash fix and compatibility behavior.
- [ ] Document the stable result-kind contract for API consumers.

## 14. Release validation

- [ ] Run core typecheck and full core tests.
- [ ] Run Web typecheck, component tests, and production build.
- [ ] Run HTTP integration tests.
- [ ] Run browser regression coverage.
- [ ] Validate the packaged CLI/Web distribution.
- [ ] Run package/version checks and high/critical audit gate.
- [ ] Verify the exact reported payload against the final packaged server.

## 15. Completion criteria

- [ ] `COUNT function GROUP BY cluster` never crashes the Query Panel or Web UI.
- [ ] All successful GQL responses use the stable normalized contract.
- [ ] The Web client remains compatible with legacy aggregate responses that omit `nodes`.
- [ ] Invalid query and invalid response errors remain panel-scoped.
- [ ] No supported GQL statement can cause an unchecked absent-array dereference.
- [ ] All release gates pass on the same final commit.
