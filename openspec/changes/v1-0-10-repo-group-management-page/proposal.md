# v1.0.10: Add a Repositories & Groups Management page

## Change ID

`v1-0-10-repo-group-management-page`

## Release

`1.0.10`

## Priority

`P1 — Administration UX and registry governance`

## Owner area

`web-administration-and-multi-repo-registry`

## One-liner

Add a dedicated management page with Repository and Group tabs for safe repo-registry deletion, group creation, group rename/delete, and adding/removing registered repositories from groups.

---

## 1. Summary

Code Intel already exposes repository and group concepts through the Connect page, CLI commands, registry files, and several HTTP endpoints. However, the Web UI has no dedicated place to manage those objects.

The Connect page is optimized for choosing what to explore. It should not become a full administration screen with destructive controls, multi-step group editing, dependency inspection, and membership management.

Version 1.0.10 will add a dedicated page:

```text
Repositories & Groups

[Repositories] [Groups]
```

The page will support:

### Repository tab

- list registered repositories;
- display health, path, index statistics, last indexed time, active status, and group memberships;
- remove a repository from the Code Intel registry after confirmation;
- disclose or cascade group dependencies explicitly;
- never delete source code or repository-local index data.

### Group tab

- list groups and member counts;
- create a group;
- view/edit one group;
- rename a group;
- delete a group after confirmation;
- add a registered repository to a group with a unique `groupPath`;
- remove a repository membership from a group;
- display missing/stale member state;
- optionally trigger group sync using the existing capability.

---

## 2. Current architecture

### Repository registry

Repositories are persisted in:

```text
~/.code-intel/repos.json
```

The current registry already supports:

- stable repository ID;
- name/path lookup;
- upsert;
- rename;
- relink;
- removal by ID or path.

Direct `removeRepo()` currently updates the registry only and has no Web API orchestration for group dependencies or atomic multi-file mutation.

### Group registry

Groups are persisted under:

```text
~/.code-intel/groups/<group-name>.json
```

The backend already provides primitives for:

- list/load/save/delete group;
- add/remove member;
- group sync result persistence.

The Web API client already contains several group methods, but there is no coherent management UI and repository deletion is not integrated with group references.

### Connect page

Connect currently has Repository and Group tabs, but they are selection surfaces for opening a graph. Mixing full administration into Connect would increase complexity and make accidental destructive actions more likely.

---

## 3. Navigation and route

Add a top-level authenticated route:

```text
/manage/repositories
/manage/groups
```

`/manage` redirects to `/manage/repositories`.

Page title:

```text
Repositories & Groups
```

Navigation entry:

```text
Manage
```

The entry SHOULD appear in the authenticated header/user menu near Settings. It is visible to users with read permission; mutation controls are permission-aware.

The page MUST remain accessible without first connecting to a graph.

---

## 4. Authorization model

For version 1.0.10:

| Action | Admin | Analyst | Repo owner | Viewer |
| --- | --- | --- | --- | --- |
| View repos/groups | Yes | Yes | Yes, subject to scope | Yes, subject to scope |
| Create/rename/delete group | Yes | No | No | No |
| Add/remove group member | Yes | No | No | No |
| Remove repo registration | Yes | No | No | No |
| Trigger group sync | Yes | Optional existing analyst permission | No | No |

Server-side authorization is authoritative. Hiding buttons is not sufficient.

A future proposal may support ownership-scoped mutation, but it is outside this release.

---

## 5. Repository tab requirements

### 5.1 Repository table/cards

Display:

- repository name;
- immutable repo ID, available through details/copy action;
- filesystem path;
- availability status;
- active server badge;
- last indexed timestamp;
- historical node/edge/file counts;
- current group memberships;
- actions menu.

Support:

- search by name/path;
- filter by status;
- sort by name, status, last indexed, and node count;
- responsive card/table layout;
- loading, empty, retry, and partial-error states.

### 5.2 Delete repository

The action label MUST be:

```text
Remove from Code Intel
```

not “Delete files”.

Confirmation MUST state:

```text
This removes the repository registration only.
The source directory and repository .code-intel data are not deleted.
```

The action uses immutable repo ID.

### 5.3 Active repository

Removing the repository currently served by the process can invalidate navigation and in-memory assumptions.

The backend MUST either:

- block removal of the active repo with a typed `409 ACTIVE_REPOSITORY` response; or
- support it only through an explicit server transition not included here.

This proposal chooses to block active-repo removal in 1.0.10.

### 5.4 Group dependencies

When a repo belongs to groups, the confirmation shows affected groups.

Default behavior:

- deletion request without cascade returns conflict;
- administrator may explicitly choose `Remove from registry and all groups`;
- registry and group updates occur atomically;
- group sync artifacts are marked stale or removed after membership change.

### 5.5 Missing repo integration

The tab uses the same availability model and deletion service introduced by `v1-0-10-missing-repo-connect-recovery`.

A missing repo is visually highlighted and can be cleaned from this page. The Connect modal and Management page MUST not implement separate deletion rules.

---

## 6. Group tab requirements

### 6.1 Group list

Display:

- name;
- member count;
- created time;
- last sync time;
- health summary (ready/missing member counts);
- actions: open/edit, sync, rename, delete based on permission.

Support search, sort, loading, empty, and retry states.

### 6.2 Create group

An admin can open `Create group` dialog.

Fields:

```text
Group name
Initial repositories (optional)
```

Group name rules:

- trimmed non-empty string;
- unique;
- filename-safe canonical representation;
- reject path separators, `..`, control characters, and reserved names;
- preserve a user-visible display name only if backend filename mapping is safe and deterministic.

Initial repository selection uses registered repo IDs. For each selected repo, default `groupPath` may be derived from repository name but must be editable and unique within the group.

Creation is atomic: either group plus all initial members are saved, or no group is created.

### 6.3 Group detail/editor

Selecting a group opens an inline detail panel or nested route:

```text
/manage/groups/:groupName
```

Show:

- group metadata;
- members table;
- repo name/path/status;
- member `groupPath`;
- add repository action;
- remove membership action;
- rename/delete/sync actions.

### 6.4 Add repository to group

The add-member dialog lists repositories not already represented by the same repo ID/groupPath combination.

Fields:

```text
Repository
Group path
```

Validation:

- repository exists in registry;
- repository ID is authoritative;
- `groupPath` is non-empty and unique within the group;
- unknown/missing repo may be shown but disabled by default;
- adding the same repo twice requires distinct documented group paths or is rejected; 1.0.10 SHOULD reject duplicates by repo ID unless multi-mount behavior is already a supported domain requirement.

### 6.5 Remove repository from group

Removing membership:

- does not remove the repo registry entry;
- does not delete files;
- asks for confirmation with repo and group names;
- updates member count immediately after success;
- invalidates stale sync results;
- is idempotent or returns a stable not-found result.

### 6.6 Rename group

Rename MUST update the group file safely and preserve members. Related sync artifact names and references must move atomically. Name conflict returns typed 409.

### 6.7 Delete group

Deleting a group:

- deletes only group configuration and its derived sync artifact;
- does not delete any repository registration or source files;
- requires confirmation showing member count;
- is admin-only;
- returns to the group list with a success notification.

### 6.8 Group sync

If the existing sync endpoint is exposed here:

- show running state;
- prevent duplicate simultaneous sync requests;
- show completion/failure;
- refresh last-sync and contract/link summary;
- membership changes invalidate prior sync status.

Sync is secondary to the required CRUD/membership scope and may be hidden if not stable enough for this release.

---

## 7. Proposed API contract

### Repositories

```http
GET    /api/v1/repos
DELETE /api/v1/repos/:repoId
```

Delete request:

```json
{
  "cascadeGroupMemberships": true
}
```

### Groups

Standardize existing routes:

```http
GET    /api/v1/groups
POST   /api/v1/groups
GET    /api/v1/groups/:name
PATCH  /api/v1/groups/:name
DELETE /api/v1/groups/:name
POST   /api/v1/groups/:name/members
DELETE /api/v1/groups/:name/members
POST   /api/v1/groups/:name/sync
```

Create request:

```json
{
  "name": "backend-platform",
  "members": [
    {
      "repoId": "uuid",
      "groupPath": "services/api"
    }
  ]
}
```

Add-member request:

```json
{
  "repoId": "uuid",
  "groupPath": "services/api"
}
```

Remove-member request SHOULD use a stable membership ID in the future. For 1.0.10 it may use `groupPath` if the existing schema guarantees uniqueness, but the response must include repo ID and group path.

---

## 8. Atomic persistence and concurrency

Current JSON writes must be strengthened for UI-driven concurrent mutation.

Introduce a shared registry mutation coordinator that:

- serializes repo/group mutations under `~/.code-intel`;
- loads current state inside the lock;
- validates expected versions or modification timestamps;
- writes temporary files;
- fsyncs and atomically renames;
- rolls back multi-document changes on failure;
- prevents lost updates from two browser tabs/processes;
- emits audit events.

Responses SHOULD include an entity version/updatedAt value for optimistic UI refresh.

---

## 9. Web architecture

Add:

```text
code-intel/web/src/pages/ManagementPage.tsx
code-intel/web/src/components/manage/RepositoryManagementTab.tsx
code-intel/web/src/components/manage/GroupManagementTab.tsx
code-intel/web/src/components/manage/GroupEditor.tsx
code-intel/web/src/components/manage/RepoRemovalDialog.tsx
code-intel/web/src/components/manage/CreateGroupDialog.tsx
code-intel/web/src/components/manage/GroupMemberDialog.tsx
```

Use a query/mutation state layer appropriate to the current app architecture. At minimum centralize:

- loading/error/retry;
- optimistic updates only where rollback is reliable;
- toast notifications;
- typed API errors;
- dialog state;
- permission checks.

The page must not depend on the currently loaded graph state.

---

## 10. Empty and degraded states

### No repositories

Show:

```text
No registered repositories.
Run code-intel analyze <path> to add one.
```

### No groups

Show Create group action for admin and explanatory text for other roles.

### Missing repo member

Show warning in group membership. Admin may remove membership or clean repo registration. Do not crash group detail.

### Server/API failure

Keep the page shell and provide retry. Do not clear previously loaded data unless the response is authoritative.

---

## 11. In scope

- new management routes/page/navigation;
- repo list/status/filter/sort;
- safe repo-registry removal;
- group list/create/detail/rename/delete;
- add/remove repo membership;
- dependency and active-repo protection;
- atomic persistence coordination;
- admin RBAC and read-only states;
- typed Web API client methods;
- accessibility, component, HTTP, browser, and concurrency tests;
- documentation/release notes.

---

## 12. Non-goals

This change will not:

- delete repository source code;
- delete repository-local indexes;
- add a file-browser picker for arbitrary new repo registration;
- run `code-intel analyze` from the browser;
- edit group contract-match results manually;
- add ownership-scoped mutation beyond admin;
- create nested groups;
- permit one group to contain another group;
- silently cascade deletion without explicit confirmation;
- replace Connect as the graph-selection page.

---

## 13. Compatibility

- Existing repos and group JSON files remain readable.
- Existing group API routes are standardized rather than unnecessarily replaced.
- Stable repo IDs are used for mutations.
- Existing CLI group commands continue operating against the same services.
- Connect remains focused on selecting a repo/group.

---

## 14. Failure semantics

- Duplicate group name: 409, preserve dialog input.
- Stale optimistic version: 409, refresh current server state and ask user to retry.
- Active repo removal: 409 typed error.
- Repo in groups without cascade: 409 listing dependencies.
- Multi-file write failure: rollback, no partial membership orphaning.
- Missing group/member: idempotent success where safe or stable 404.
- Unauthorized mutation: 403, no local optimistic removal.
- Invalid group path/name: 422 with field-level errors.

---

## 15. Accessibility

- Tabs use proper tab semantics or route navigation with clear active state.
- Tables/cards remain keyboard navigable.
- Action menus and dialogs have labels and focus management.
- Destructive confirmations identify the object and scope.
- Status is not communicated by color alone.
- Inline validation is associated with fields.
- Loading/success/error announcements use appropriate live regions.

---

## 16. Acceptance criteria

1. Authenticated users can open `/manage/repositories` and `/manage/groups` without connecting to a graph.
2. Repository tab shows status, path, stats, active state, and group memberships.
3. Admin can remove a non-active repo registration after explicit confirmation.
4. Removal never deletes source or repository-local index files.
5. Repo-in-group dependencies require explicit cascade and update atomically.
6. Admin can create a group with validated unique name.
7. Admin can add and remove registered repos in a group using repo IDs and unique group paths.
8. Admin can rename and delete a group without affecting repositories.
9. Non-admin roles are read-only and direct mutation calls are rejected.
10. Missing repo/group members render as recoverable warnings.
11. Connect behavior remains focused on selection.
12. Unit, HTTP, Web, accessibility, browser, concurrency, package, and security tests pass on one final commit.

---

## 17. Final decision

Version 1.0.10 will add a dedicated administration surface for repository registrations and groups, backed by shared safe mutation services instead of embedding destructive management actions into the Connect page.
