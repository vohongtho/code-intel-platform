# v1.0.10: Recover gracefully when a registered repository path no longer exists

## Change ID

`v1-0-10-missing-repo-connect-recovery`

## Release

`1.0.10`

## Priority

`P1 — Recoverable connection UX and registry hygiene`

## Owner area

`connect-page-and-repository-registry`

## One-liner

When Connect encounters a registered repository whose filesystem path no longer exists, show a focused confirmation dialog offering to remove the stale registry entry instead of showing only a generic connection error.

---

## 1. Summary

The global repository registry can outlive the repository directory it references. This happens when a directory is moved, renamed, deleted, a removable drive is disconnected, or a registry file is copied to another machine.

The Connect page currently lists registry entries and attempts to fetch their graph. If the path or index is unavailable, the flow navigates to Loading and then returns to Connect with a generic error message. The user is not told that the registry entry itself is stale and is not offered a safe cleanup action.

Version 1.0.10 will make repository availability explicit, return machine-readable repository-health errors, and present a modal:

```text
Repository not found

The registered path no longer exists:
/path/to/repository

Remove this repository from Code Intel?

[Cancel] [Remove repository]
```

Removal in this flow means removing the registry entry only. It MUST NOT delete source code, `.code-intel` data, or any filesystem directory.

---

## 2. Current behavior

The repository registry persists entries in:

```text
~/.code-intel/repos.json
```

Each entry includes ID, name, path, index time, and statistics. `loadRegistry()` normalizes records but does not classify whether each path currently exists or remains readable.

The Connect page:

1. calls `GET /api/v1/repos`;
2. displays every returned registry entry as connectable;
3. navigates to `/loading` immediately when an entry is selected;
4. calls graph endpoints;
5. catches any failure;
6. returns to Connect and renders a generic inline error.

The user cannot distinguish:

- missing repository directory;
- unreadable path;
- missing index;
- corrupted index;
- server/network failure;
- permission denial.

---

## 3. Required behavior

### 3.1 Repository health classification

`GET /api/v1/repos` MUST include a stable health classification for each registry entry:

```ts
interface RepoAvailability {
  status: 'ready' | 'missing' | 'unreadable' | 'unindexed' | 'invalid-index';
  reason?: string;
  canConnect: boolean;
  canRemove: boolean;
}
```

Definitions:

- `ready`: path exists, is a directory, and a usable published index is available;
- `missing`: registered path does not exist;
- `unreadable`: path exists but cannot be read due to permissions or I/O errors;
- `unindexed`: repository exists but no usable index is published;
- `invalid-index`: index artifacts exist but fail trust/validation checks.

The health probe MUST be lightweight and MUST NOT load the full graph for every list request.

### 3.2 Missing repository presentation

A missing repository remains visible in the list for recovery and cleanup, but its card MUST:

- show a warning status rather than a healthy dot;
- show `Missing` text;
- retain repository name and registered path;
- not present normal node/edge stats as current truth without qualification;
- be keyboard accessible;
- explain that the registry entry exists but the filesystem path does not.

### 3.3 Confirmation popup

Selecting a repository with `status: missing` MUST open a confirmation modal before navigation to Loading.

The modal MUST show:

- repository name;
- registered path;
- clear statement that the path does not exist;
- `Cancel` action;
- `Remove repository` destructive action;
- explanation that removal affects only the Code Intel registry;
- note about group membership when relevant.

The modal MUST trap focus, support Escape to cancel, restore focus to the triggering card, and use an accessible dialog label/description.

### 3.4 Race-safe fallback

A repository may disappear after the list loads. Therefore graph endpoints MUST return a structured error when the path is missing:

```json
{
  "error": {
    "code": "CI-REPO-PATH-MISSING",
    "message": "Repository path no longer exists",
    "details": {
      "repoId": "...",
      "repoName": "api-service",
      "path": "/work/api-service",
      "removable": true
    }
  }
}
```

When Connect receives this error during connection, it MUST return to Connect and open the same recovery modal instead of showing only the generic error banner.

### 3.5 Registry-only removal API

Add or standardize:

```http
DELETE /api/v1/repos/:repoId
```

Default semantics:

```text
Remove the entry from ~/.code-intel/repos.json only.
Do not delete the repository directory.
Do not delete .code-intel artifacts from the repository path.
Do not run shell commands.
```

The response SHOULD be:

```json
{
  "removed": true,
  "repo": {
    "id": "...",
    "name": "api-service",
    "path": "/work/api-service"
  },
  "affectedGroups": []
}
```

### 3.6 Group dependency handling

If the repository belongs to one or more groups, the server MUST not silently leave invalid group references.

For the Connect recovery modal, use one of these explicit behaviors:

1. preferred: remove the repo from the registry and atomically remove its memberships from all groups after showing the affected groups; or
2. conservative: return `409 REPO_IN_GROUPS` with affected group names and require an explicit cascade confirmation.

The selected policy MUST be shared with the Repo/Group Manage page. The proposal prefers explicit cascade confirmation for non-missing healthy repos and allows a clearly described cascade for stale missing entries.

### 3.7 Permissions

Repository removal is a destructive registry mutation and MUST require an authorized role.

For 1.0.10:

- admin: may remove registry entries;
- analyst/viewer/repo-owner: may view health but cannot remove unless a later policy explicitly grants ownership-based deletion.

The modal's destructive button MUST be hidden or disabled for unauthorized users and explain that an administrator is required.

### 3.8 Successful removal UX

After removal:

- close the modal;
- remove the card from the current list without full-page reload;
- show a non-blocking success notification;
- clear stale error state;
- remain on Connect;
- update group counts if memberships were changed;
- make repeated removal idempotent and safe.

### 3.9 Failed removal UX

If removal fails:

- keep the modal open;
- show the structured error inside the modal;
- retain the repository card;
- allow retry/cancel;
- do not navigate to Loading;
- do not claim files were changed.

---

## 4. Proposed architecture

### Backend

Add a repository availability service:

```text
code-intel/core/src/storage/repo-availability.ts
```

Suggested exports:

```ts
inspectRepoAvailability(entry: RepoEntry): RepoAvailability
inspectRegistry(entries: RepoEntry[]): RepoListItem[]
```

Add a centralized mutation service:

```text
code-intel/core/src/storage/repo-registry-service.ts
```

It owns:

- lookup by immutable repo ID;
- dependency discovery across groups;
- atomic registry update;
- optional atomic group-membership cascade;
- audit event details;
- idempotent missing-entry behavior.

### HTTP

Update:

```text
GET /api/v1/repos
GET /api/v1/graph/:repo
GET /api/v1/graph/:repo/nodes
DELETE /api/v1/repos/:repoId
```

All graph loaders should map a missing path to the same typed error code.

### Web

Update:

```text
code-intel/web/src/api/client.ts
code-intel/web/src/pages/ConnectPage.tsx
```

Add reusable components:

```text
code-intel/web/src/components/repos/MissingRepoDialog.tsx
code-intel/web/src/components/shared/Toast.tsx (or existing notification system)
```

---

## 5. In scope

- repository health fields in list API;
- missing/unreadable/unindexed status presentation;
- missing-repo confirmation modal;
- structured missing-path API error;
- registry-only delete endpoint;
- permission enforcement;
- group dependency disclosure/cascade policy;
- Connect-page optimistic list update and notification;
- backend, Web, accessibility, and browser tests.

---

## 6. Non-goals

This change will not:

- delete repository source directories;
- delete repository `.code-intel` artifacts;
- automatically relink moved repositories;
- search the entire disk for a moved path;
- remove healthy repositories without confirmation;
- hide stale entries without informing the user;
- treat a server/network error as a missing repository;
- replace the dedicated Repo/Group Manage page proposed separately.

---

## 7. Compatibility

- Existing registry JSON entries remain valid.
- The list API gains fields; existing clients may ignore them.
- Delete operations use immutable repo ID, not ambiguous name/path.
- Group files continue using repo IDs where available.
- The current Connect tabs remain, with richer status and recovery behavior.

---

## 8. Failure and safety semantics

- Path disappears between list and click: typed error opens modal.
- Registry entry already removed: return idempotent success or 404 that Web treats as already resolved.
- Atomic registry write fails: preserve original file and report failure.
- Group update fails during cascade: transaction/rollback preserves consistent registry and groups.
- Active served repo removal: block or require a separate explicit policy; Connect recovery for a missing active path may remove only after server confirms no in-memory dependency is invalidated unsafely.
- Unauthorized request: 403, no mutation.

---

## 9. Acceptance criteria

1. A registry entry with a nonexistent path is returned as `status: missing`.
2. Clicking a missing entry opens a modal instead of navigating to Loading.
3. A path disappearing after list load produces the same modal through typed API error handling.
4. The modal clearly states registry-only deletion and displays the path.
5. Cancel performs no mutation.
6. Admin removal deletes only the registry record and explicitly handles group memberships.
7. Source and `.code-intel` directories are never deleted by this endpoint.
8. Unauthorized users cannot remove the entry.
9. Successful removal updates the Connect list and shows confirmation.
10. Backend, component, accessibility, browser, and release-readiness tests pass.

---

## 10. Final decision

A stale repository entry is a recoverable registry condition, not a generic connection failure. Version 1.0.10 will surface that condition directly and provide a safe, explicit registry cleanup action.
