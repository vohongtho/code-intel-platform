# Tasks: Agentic Cross-Repository Change Workflows

## 1. Session contracts and store
- [ ] Add `agents/workflows/session-types.ts` with versioned phases, baselines, targets, plan/checkpoint/condition contracts.
- [ ] Add `session-store.ts` with bounded schema validation, atomic writes, revision compare-and-swap and retention.
- [ ] Choose the authoritative storage root for repo vs group sessions using existing repository/group ownership.
- [ ] Add reopen, corrupt/oversize, stale-revision and retention tests.

## 2. Planning service
- [ ] Add `session-service.ts` to compose existing search/context/impact/API/test/group services into required/candidate/optional/unknown plan steps.
- [ ] Integrate adaptive Explore when available, with explicit fallback to existing tools otherwise.
- [ ] Record baseline Generation/snapshot/group-sync/analyzer fingerprints without storing source blobs.
- [ ] Add plan determinism and partial-capability tests.

## 3. Expected semantic conditions
- [ ] Define typed expected node/relationship/contract/flow/test/structural/security conditions.
- [ ] Add pure condition evaluator returning `satisfied|partially-satisfied|unexpected-change|not-observed|unknown|blocked`.
- [ ] Ensure unknown/partial evidence never upgrades to satisfied.
- [ ] Add fixtures for intentional breaking API change vs unexpected break.

## 4. Checkpoint and verification
- [ ] Add `verification.ts` using index freshness, semantic diff, contract drift, test selection and review lenses.
- [ ] Transition source-changed stale sessions to `reindex-required`; do not verify from stale graph as though current.
- [ ] Detect branch/ref/group membership/analyzer incompatibility changes.
- [ ] Add plan->external edit->analyze->verify integration tests.

## 5. Review lenses and commit plan
- [ ] Add `review-lenses.ts` adapters for architecture, API, tests, security, change-risk and scope.
- [ ] Add `commit-plan.ts` grouping verified changes into suggested commits/messages.
- [ ] Prove no Git stage/commit/push mutation exists in the service.
- [ ] Add lens capability-boundary and commit-plan determinism tests.

## 6. Stable cross-repo system flows
- [ ] Add `multi-repo/system-flows/types.ts`, `identity.ts`, `stitcher.ts`, `service.ts`.
- [ ] Require stable local flow identity from `v1-0-12-change-risk-and-test-intelligence` for exact persisted system flows.
- [ ] Stitch only exact contract consumers as exact continuations; keep candidates separate.
- [ ] Add HTTP/event and later GraphQL/gRPC contract-boundary fixtures without name-only matching.
- [ ] Add cycle/hop/segment/candidate cap and partial-group coverage tests.

## 7. System-flow cache/impact
- [ ] Cache by group/member snapshot, contract consumer index, local flow version and stitcher version.
- [ ] Invalidate on any input fingerprint change.
- [ ] Add system-flow impact to group drift/PR/workflow verification additively.
- [ ] Add deterministic three-repo chain and cache invalidation tests.

## 8. Public surfaces
- [ ] Add one MCP `change_workflow` tool with `start|status|checkpoint|verify|complete` actions.
- [ ] Add `code-intel workflow start|status|checkpoint|verify|complete`.
- [ ] Decide whether authenticated HTTP session mutations fit current ownership model; if not, document deferral rather than adding unsafe endpoints.
- [ ] Add read-only `system_flows` query with bounded pagination/filtering if required by agent workflows.
- [ ] Extend workflow registry/assets/validator without deleting existing eight workflow IDs or overwriting user-modified assets.

## 9. Agent integration
- [ ] Update installed Claude/Cursor workflow assets to join/check/verify a session when capability exists.
- [ ] Require external edits followed by analyze/reindex and verification before an asset claims completion.
- [ ] Add generated asset snapshot/validation/evaluation fixtures.

## 10. Performance/security/release
- [ ] Add session/system-flow counters and scaling tests proving indexed stitching rather than all-by-all scans.
- [ ] Validate auth/repo scope for MCP session operations.
- [ ] Confirm session state contains no secrets/source blobs by default.
- [ ] Update docs and run workflow/multi-repo/core/Web/e2e/package/release gates.
