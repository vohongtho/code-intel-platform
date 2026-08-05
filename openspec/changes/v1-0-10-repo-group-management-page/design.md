# Design: Repositories & Groups Management

## 1. Context

Repository and group persistence already exists, but the current Web UI only provides a Connect selection surface. Management requires a separate route, stronger mutation APIs, shared dependency logic, and transactional JSON-file updates.

## 2. Invariants

1. Web management is independent of the currently connected graph.
2. Repository deletion means registry deletion only.
3. Source directories and repository `.code-intel` directories are never deleted.
4. Active served repo cannot be removed in 1.0.10.
5. Group membership references stable repo IDs.
6. Repo/group cross-document changes are atomic.
7. Server RBAC is authoritative.
8. Connect recovery and Management use the same availability/removal services.

## 3. Routes and navigation

Add React routes:

```text
/manage                    -> redirect /manage/repositories
/manage/repositories       -> repository tab
/manage/groups             -> group list
/manage/groups/:groupName  -> group editor
```

Add `ManagementPage` below the authenticated app shell. Header navigation shows `Manage` to authorized authenticated users. The route loader does not require `state.connected`.

## 4. Backend services

### 4.1 Repository catalog service

Compose registry entries, availability, active state, and group memberships:

```ts
listManagedRepos(context): ManagedRepo[]
```

This uses `repo-availability.ts` from the missing-repo proposal and never loads a full graph.

### 4.2 Registry mutation coordinator

Create a lock/coordinator under global `~/.code-intel` state. Suggested lock:

```text
~/.code-intel/registry.lock
```

The lock owner record contains PID, hostname, token, startedAt, and operation. Use exclusive creation and conservative stale recovery similar to analyze locking.

Mutation algorithm:

1. acquire lock;
2. reload repo and group files;
3. validate entity/version and dependencies;
4. calculate complete next state;
5. write temp files with restrictive permissions;
6. fsync and atomically rename;
7. remove obsolete files only after replacements are durable;
8. release lock;
9. emit sanitized audit result.

For multi-file rollback, retain original bytes until all temp writes validate. If the platform cannot guarantee cross-file rename atomicity, implement a small transaction journal and startup recovery.

### 4.3 Repository removal

```ts
removeRepoRegistration({ repoId, cascadeGroupMemberships, actor })
```

Validation:

- repo exists or return idempotent result;
- repo is not active;
- actor is admin;
- dependencies are disclosed;
- cascade must be explicit when dependencies exist.

Cascade removes members by `repoId`, invalidates group sync artifacts, and preserves group files.

### 4.4 Group service

Create a service layer over `group-registry.ts`:

```ts
createGroup(input, actor)
renameGroup(name, newName, expectedVersion, actor)
deleteGroup(name, expectedVersion, actor)
addGroupMember(name, { repoId, groupPath }, expectedVersion, actor)
removeGroupMember(name, { repoId?, groupPath }, expectedVersion, actor)
listManagedGroups()
getManagedGroup(name)
```

All operations validate names, paths, registry identity, uniqueness, and permissions.

## 5. Entity versioning

Add `updatedAt` and optional integer `version` to group files. For repository registry, derive a registry version from file metadata/hash or add a top-level versioned envelope in a backward-compatible migration.

Mutation requests send `expectedVersion` where practical. A stale request returns:

```text
409 ENTITY_CHANGED
```

with current entity summary so the UI can refresh.

## 6. API response models

### Managed repository

```ts
interface ManagedRepo {
  id: string;
  name: string;
  path: string;
  indexedAt: string | null;
  stats: { nodes: number; edges: number; files: number };
  active: boolean;
  availability: RepoAvailability;
  groups: { name: string; groupPath: string }[];
  permissions: { remove: boolean };
  version: string;
}
```

### Managed group

```ts
interface ManagedGroup {
  name: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  lastSync: string | null;
  members: ManagedGroupMember[];
  health: { ready: number; missing: number; unreadable: number };
  permissions: {
    edit: boolean;
    delete: boolean;
    sync: boolean;
  };
}
```

### Member

```ts
interface ManagedGroupMember {
  repoId: string;
  registryName: string;
  groupPath: string;
  repoPath?: string;
  availability: RepoAvailability;
}
```

## 7. Group name and path validation

### Group name

Use a canonical validation function shared by CLI and HTTP:

- trim whitespace;
- length 1–80;
- reject `/`, `\\`, NUL/control characters, `.` and `..`;
- reject names producing hidden/reserved filenames;
- compare uniqueness using the platform's documented case sensitivity;
- construct file paths only after validation.

### Group path

- normalize to `/` separators;
- relative only;
- no leading `/`;
- no `.` or `..` segments;
- length bounded;
- unique within group;
- not interpreted as a local filesystem path by the management API.

## 8. Web state architecture

Create page-level hooks/services:

```text
useManagedRepos()
useManagedGroups()
useManagedGroup(name)
useManagementMutation()
```

They may use existing React state patterns; adding a new data library is not required.

Each maintains:

- server snapshot;
- loading/error;
- refresh;
- mutation-in-progress ID;
- typed validation/conflict details.

Optimistic updates are allowed only for simple membership removal after a successful server response. Destructive objects remain visible with loading state until confirmed.

## 9. Repository tab UI

Desktop table; responsive cards on narrow width.

Columns:

```text
Repository | Status | Path | Last indexed | Size | Groups | Actions
```

Actions:

- view/connect;
- copy path/ID;
- remove from Code Intel.

Active repo removal action is disabled with tooltip. Missing repos use warning styling and link to the shared cleanup dialog.

## 10. Group tab UI

Group list at left/top and detail/editor at right/below.

Actions:

- Create group;
- Open/Edit;
- Rename;
- Delete;
- Sync (when enabled).

Group editor members table:

```text
Repository | Group path | Repo status | Actions
```

Add dialog obtains fresh repo list and excludes already-added repo IDs. Group path default is generated but editable.

## 11. Dialogs

All dialogs use a shared accessible modal primitive:

- CreateGroupDialog;
- RenameGroupDialog;
- DeleteGroupDialog;
- AddGroupMemberDialog;
- RemoveGroupMemberDialog;
- RepoRemovalDialog.

Destructive dialogs default focus to Cancel and include exact scope text.

## 12. Group sync invalidation

Any member add/remove or repo cascade removes/marks stale the group's `.sync.json` artifact. The next UI read reports `lastSync: null` or `syncStatus: stale`. Do not display old contracts as current after membership changes.

## 13. Audit events

Record:

- actor user ID;
- action type;
- target IDs/names;
- affected group names;
- outcome;
- request ID;
- timestamp.

Do not log source contents or secrets.

## 14. Tests

### Core

- validation for group names/paths;
- repository dependency discovery;
- active repo block;
- cascade atomicity;
- stale version conflicts;
- lock contention/recovery;
- sync invalidation;
- no source deletion.

### HTTP

- read access by roles;
- admin mutations;
- non-admin 403;
- create/rename/delete group;
- add/remove members;
- duplicate conflict and validation response;
- active repo and dependency conflicts;
- cascade response.

### Web component

- routing/tabs;
- read-only role states;
- filters/sorts;
- dialogs and field validation;
- successful/error/conflict mutation states;
- missing member warning;
- refresh after stale version.

### Browser

- create group, add two repos, remove one, rename, delete;
- repo removal blocked while active;
- cascade removal from groups;
- source directories remain intact;
- Manage opens without connecting to graph.

## 15. Alternatives rejected

### Put delete buttons on Connect only

Rejected because Connect is a selection workflow and cannot cleanly host full group administration.

### Edit JSON files directly in the browser

Rejected because validation, RBAC, atomicity, and audit would be bypassed.

### Use repo names as identity

Rejected because names are mutable and group records already migrate toward repo IDs.

### Automatically cascade every deletion

Rejected because dependencies must be visible and intentional.

## 16. Rollout

The page is additive. Existing CLI/API flows continue. Group files are migrated lazily to version fields. The mutation coordinator is also used by CLI and Connect cleanup to prevent cross-surface lost updates.
