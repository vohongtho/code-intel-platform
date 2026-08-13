# Tasks: Missing repository recovery

## 1. Repository health model

- [ ] Create `code-intel/core/src/storage/repo-availability.ts` with ready, missing, unreadable, unindexed, and invalid-index classifications.
- [ ] Ensure availability checks are lightweight and do not load the full graph.
- [ ] Extend repo list response types with immutable repo ID, availability, permission-derived `canRemove`, and group memberships.
- [ ] Add unit tests for every status and OS error mapping.

## 2. Typed graph-access errors

- [ ] Add a stable `CI-REPO-PATH-MISSING` error code and structured details.
- [ ] Update graph and paginated-node endpoints to validate registered path state before DB access.
- [ ] Preserve distinction between missing path, unauthorized access, unavailable server, and invalid index.
- [ ] Add HTTP tests for path deletion after repo-list load.

## 3. Registry mutation service

- [ ] Create a central remove-registration service using repo ID.
- [ ] Guarantee registry-only semantics with no delete/unlink operation against the repository path or `.code-intel` directory.
- [ ] Discover affected groups before mutation.
- [ ] Implement conflict or explicit cascade behavior for group memberships.
- [ ] Make registry and group updates atomic/rollback-safe and auditable.
- [ ] Add unit tests proving source/index directories remain untouched.

## 4. HTTP deletion endpoint

- [ ] Add `DELETE /api/v1/repos/:repoId` with admin authorization.
- [ ] Accept an explicit cascade option only through validated request data.
- [ ] Return removed repo metadata and affected group names.
- [ ] Handle already-removed entries idempotently or with a stable typed result.
- [ ] Add RBAC, conflict, cascade, atomic failure, and audit tests.

## 5. Typed Web API errors

- [ ] Preserve HTTP status, error code, message, hint, and details in `ApiClient` errors.
- [ ] Add `removeRepo()` and extended repo-list types.
- [ ] Add tests for typed missing-path and group-conflict responses.

## 6. Connect page UI

- [ ] Render missing/unreadable/unindexed status distinctly on repo cards.
- [ ] Prevent normal Loading navigation when a listed repo is already marked missing.
- [ ] Add `MissingRepoDialog` with path, registry-only warning, Cancel, Remove, group dependency disclosure, and retry error state.
- [ ] Handle the race where the path disappears during connection by reopening Connect with the same modal.
- [ ] Update the list and show a success notification after removal.
- [ ] Hide/disable removal for unauthorized roles while preserving server-side enforcement.

## 7. Accessibility and browser regression

- [ ] Add focus trap, Escape handling, dialog labels, destructive-action semantics, and focus restoration tests.
- [ ] Add browser test: register repo, remove directory, open Connect, confirm cleanup, assert registry card disappears.
- [ ] Assert no source/index path is deleted by the cleanup endpoint.

## 8. Documentation and release validation

- [ ] Document stale repo status and registry-only removal behavior.
- [ ] Update changelog and 1.0.10 release notes.
- [ ] Add release-readiness smoke coverage for list status, modal recovery, delete endpoint, and group dependency behavior.
- [ ] Run core, HTTP, Web, browser, typecheck, build, package, and security gates on one final commit.
