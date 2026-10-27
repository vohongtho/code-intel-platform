# Tasks: Agentic Cross-Repository Change Workflows

## 1. Session contracts and store
- [x] Add `agents/workflows/session-types.ts` with versioned phases, baselines, targets, plan/checkpoint/condition contracts.
- [x] Add `session-store.ts` with bounded schema validation, atomic writes, revision compare-and-swap and retention.
- [x] Choose the authoritative storage root for repo vs group sessions using existing repository/group ownership.
- [x] Add reopen, corrupt/oversize, stale-revision and retention tests.
- [x] Prove single-repository persistence/state transitions before enabling group session writes.

## 2. Planning service
- [x] Add `session-service.ts` to compose existing search/context/impact/API/test/group services into required/candidate/optional/unknown plan steps.
- [x] Integrate adaptive Explore when available, with explicit fallback to existing tools otherwise.
- [x] Record baseline Generation/snapshot/group-sync/analyzer fingerprints without storing source blobs.
- [x] Add plan determinism and partial-capability tests.

## 3. Expected semantic conditions
- [x] Define typed expected node/relationship/contract/flow/test/structural/security conditions.
- [x] Add pure condition evaluator returning `satisfied|partially-satisfied|unexpected-change|not-observed|unknown|blocked`.
- [x] Ensure unknown/partial evidence never upgrades to satisfied.
- [x] Add fixtures for intentional breaking API change vs unexpected break.

## 4. Checkpoint and verification
- [x] Add `verification.ts` using index freshness, semantic diff, contract drift, test selection and review lenses.
- [x] Transition source-changed stale sessions to `reindex-required`; do not verify from stale graph as though current.
- [x] Detect branch/ref/group membership/analyzer incompatibility changes.
- [x] Add plan->external edit->analyze->verify integration tests.

## 5. Review lenses and commit plan
- [x] Add `review-lenses.ts` adapters for architecture, API, tests, security, change-risk and scope.
- [x] Add `commit-plan.ts` grouping verified changes into suggested commits/messages.
- [x] Prove no Git stage/commit/push mutation exists in the service.
- [x] Add lens capability-boundary and commit-plan determinism tests.

## 6. Stable cross-repo system flows
- [x] Begin only after stable local-flow identity is migrated and validated across independent analyses.
- [x] Add `multi-repo/system-flows/types.ts`, `identity.ts`, `stitcher.ts`, `service.ts`.
- [x] Require stable local flow identity from `v1-0-12-change-risk-and-test-intelligence` for exact persisted system flows.
- [x] Stitch only exact contract consumers as exact continuations; keep candidates separate.
- [x] Add HTTP/event and later GraphQL/gRPC contract-boundary fixtures without name-only matching.
- [x] Add cycle/hop/segment/candidate cap and partial-group coverage tests.

## 7. System-flow cache/impact
- [x] Cache by group/member snapshot, contract consumer index, local flow version and stitcher version.
- [x] Invalidate on any input fingerprint change.
- [x] Add system-flow impact to group drift/PR/workflow verification additively.
- [x] Add deterministic three-repo chain and cache invalidation tests.

## 8. Public surfaces
- [x] Add one MCP `change_workflow` tool with `start|status|checkpoint|verify|complete` actions.
- [x] Add `code-intel workflow start|status|checkpoint|verify|complete`.
- [x] Decide whether authenticated HTTP session mutations fit current ownership model; if not, document deferral rather than adding unsafe endpoints.
- [x] Add read-only `system_flows` query with bounded pagination/filtering if required by agent workflows.
- [x] Extend workflow registry/assets/validator without deleting existing eight workflow IDs or overwriting user-modified assets.

## 9. Agent integration
- [x] Update installed Claude/Cursor workflow assets to join/check/verify a session when capability exists.
- [x] Require external edits followed by analyze/reindex and verification before an asset claims completion.
- [x] Add generated asset snapshot/validation/evaluation fixtures.

## 10. Performance/security/release
- [x] Add session/system-flow counters and scaling tests proving indexed stitching rather than all-by-all scans.
- [x] Validate auth/repo scope for MCP session operations.
- [x] Confirm session state contains no secrets/source blobs by default.
- [x] Update docs and run workflow/multi-repo/core/Web/e2e/package/release gates.
