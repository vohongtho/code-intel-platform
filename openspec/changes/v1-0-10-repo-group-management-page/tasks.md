# Tasks: Repositories & Groups Management

## 1. Shared management services

- [ ] Create a global registry mutation coordinator with exclusive locking, stale-owner handling, temp-file writes, atomic rename, rollback/journal recovery, and audit output.
- [ ] Create a managed repository catalog service that combines registry entry, availability, active state, statistics, group memberships, permissions, and version.
- [ ] Create a group management service for list/get/create/rename/delete/add-member/remove-member/sync invalidation.
- [ ] Share repository availability and removal logic with `v1-0-10-missing-repo-connect-recovery`.

## 2. Persistence validation and migration

- [ ] Add canonical group-name validation shared by CLI and HTTP.
- [ ] Add safe relative `groupPath` validation and uniqueness checks.
- [ ] Migrate group files to include `updatedAt` and version information without losing members.
- [ ] Ensure group members use stable repo IDs and repair legacy name-only members when possible.
- [ ] Add tests for invalid names, path traversal, duplicates, case conflicts, migration, and malformed files.

## 3. Repository management API

- [ ] Extend `GET /api/v1/repos` with availability, groups, permissions, active state, file count, and version.
- [ ] Implement/standardize `DELETE /api/v1/repos/:repoId` through the shared mutation service.
- [ ] Block active-repository removal with typed `409 ACTIVE_REPOSITORY`.
- [ ] Return typed dependency conflict when cascade is not confirmed.
- [ ] Atomically remove group memberships and invalidate sync results when cascade is confirmed.
- [ ] Prove through tests that no repository path or `.code-intel` artifact is deleted.

## 4. Group management API

- [ ] Standardize list/create/get/rename/delete/member-add/member-remove/sync routes.
- [ ] Create groups atomically with optional initial members by repo ID.
- [ ] Add optimistic-version conflict handling.
- [ ] Invalidate derived sync artifacts on member or repository dependency changes.
- [ ] Return field-level validation errors and typed 404/409 responses.
- [ ] Add RBAC tests for all read and mutation routes.

## 5. Web routes and navigation

- [ ] Add `/manage`, `/manage/repositories`, `/manage/groups`, and `/manage/groups/:groupName` routes.
- [ ] Add an authenticated Manage navigation entry near Settings.
- [ ] Ensure the management page works when no graph is connected.
- [ ] Add route tests for redirects, deep links, permission states, and browser refresh.

## 6. Repository tab

- [ ] Implement repository search, status filter, sorting, responsive table/cards, loading, empty, retry, and partial-error states.
- [ ] Show name, path, status, active badge, last indexed time, node/edge/file counts, and group memberships.
- [ ] Implement shared accessible repo-removal confirmation.
- [ ] Disable active-repo removal and show typed conflict if state changes during the request.
- [ ] Refresh data and show success/error notification after mutation.

## 7. Group tab and editor

- [ ] Implement group list with member count, health, created/updated time, last sync, search, and sort.
- [ ] Implement Create group dialog with optional initial repo selection and validated group paths.
- [ ] Implement group detail/editor with member status and actions.
- [ ] Implement Add repository and Remove membership dialogs.
- [ ] Implement Rename group and Delete group confirmations.
- [ ] Optionally expose existing sync action with single-flight state and result refresh.

## 8. Permissions and accessibility

- [ ] Make non-admin views read-only and enforce all mutations on the server.
- [ ] Add accessible tab/route states, action menus, field errors, dialogs, focus traps, Escape behavior, focus restoration, and live announcements.
- [ ] Ensure status is communicated by text/icon as well as color.

## 9. Concurrency and audit

- [ ] Add tests for two tabs/processes mutating the same group or registry.
- [ ] Return and handle stale entity versions without lost updates.
- [ ] Emit sanitized audit events for repo and group mutations.
- [ ] Add operational metrics for mutation success/conflict/failure and lock contention.

## 10. Browser and release validation

- [ ] Add browser flow: open Manage without graph connection; create group; add repos; remove member; rename; delete.
- [ ] Add browser flow for active-repo removal block and explicit cascade removal.
- [ ] Assert source and repo-local index directories remain intact after all management actions.
- [ ] Update README, Web navigation docs, changelog, and 1.0.10 release notes.
- [ ] Run core, HTTP, Web, accessibility, browser, concurrency, typecheck, build, package, and security gates on one final commit.
