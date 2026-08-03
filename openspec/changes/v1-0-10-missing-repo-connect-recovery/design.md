# Design: Missing repository recovery on Connect

## 1. Context

The repository registry is persistent metadata, while repository paths are external mutable filesystem state. A stale registry entry must be represented explicitly rather than discovered only after graph loading fails.

## 2. Invariants

1. Registry cleanup never deletes repository files or index artifacts.
2. Missing-path detection is distinct from network, auth, permission, and index errors.
3. Destructive actions use immutable repo IDs.
4. Group references cannot be silently orphaned.
5. A path disappearing after list load produces the same recovery UX.
6. Unauthorized clients cannot remove registry entries.
7. Registry/group writes are atomic or rolled back.

## 3. Availability inspection

Create a lightweight synchronous/async inspector that does not open the graph database.

```ts
export type RepoAvailabilityStatus =
  | 'ready'
  | 'missing'
  | 'unreadable'
  | 'unindexed'
  | 'invalid-index';

export interface RepoAvailability {
  status: RepoAvailabilityStatus;
  canConnect: boolean;
  canRemove: boolean;
  reason?: string;
}
```

Inspection order:

1. `lstat` path;
2. confirm directory;
3. check read/search access;
4. resolve current index snapshot;
5. verify minimum trusted artifacts/manifest without loading all nodes.

Map expected errors to stable status. Do not leak OS stack traces to Web clients.

## 4. Repo list contract

Extend each list item:

```ts
interface RepoListItem {
  id: string;
  name: string;
  path: string;
  nodes: number;
  edges: number;
  indexedAt: string | null;
  active?: boolean;
  availability: RepoAvailability;
  groupMemberships: { name: string; groupPath: string }[];
}
```

Stats remain historical registry values and the UI labels them as last indexed when status is not ready.

## 5. Typed error mapping

Create a typed repository access error:

```ts
class RepoPathMissingError extends AppError {
  repoId: string;
  repoName: string;
  path: string;
}
```

All repo graph entry points resolve the registry entry first and inspect path state before DB open. The HTTP layer maps it to `CI-REPO-PATH-MISSING` with structured details.

Connect uses a helper:

```ts
isMissingRepoError(error): error is MissingRepoApiError
```

It never decides “missing” from human-readable message text.

## 6. Delete service

Create a central mutation service rather than invoking `removeRepo()` directly from route/UI concerns.

```ts
removeRepoRegistration({
  repoId,
  cascadeGroupMemberships,
  actor,
}): RepoRemovalResult
```

Steps under a registry mutation lock:

1. load registry and group documents;
2. find repo by ID;
3. calculate affected groups;
4. if affected and cascade not confirmed, return conflict result;
5. construct updated registry/groups in memory;
6. write temp files;
7. fsync/rename atomically;
8. emit audit entry;
9. return removed record and affected groups.

No path from the registry is passed to `rm`, `unlink`, shell, or recursive deletion.

## 7. Connect state machine

Add explicit modal state:

```ts
interface MissingRepoPromptState {
  repo: RepoListItem;
  source: 'list' | 'connect-error';
  affectedGroups: string[];
  removing: boolean;
  error: string | null;
}
```

Flow for known missing card:

```text
click card -> set prompt state -> open dialog
```

Flow for race condition:

```text
navigate loading -> graph API typed missing error
-> reset graph-load state
-> navigate connect
-> refresh repos
-> set prompt state by repo ID
```

Do not show the generic error banner for the typed missing condition.

## 8. Dialog behavior

Use a reusable modal primitive or implement:

- `role="dialog"`;
- `aria-modal="true"`;
- labelled title and description;
- focus trap;
- initial focus on Cancel unless product accessibility standard says otherwise;
- Escape closes while not submitting;
- destructive action has explicit label;
- background interaction disabled;
- focus restored to repo card after close.

When affected groups exist, show them and require an explicit cascade checkbox or a second confirm step.

## 9. Permissions

The list returns `canRemove` based on request user role rather than only static status. The route enforces admin authorization independently. The UI never relies on hidden buttons as security.

## 10. API client

Add:

```ts
ApiClient.removeRepo(repoId, { cascadeGroupMemberships }): Promise<RepoRemovalResult>
```

API errors preserve `code`, `message`, `details`, and HTTP status through a typed `ApiError` rather than flattening everything to `Error(message)`.

## 11. Tests

### Core

- missing path classification;
- unreadable/unindexed distinction;
- no full graph load during list;
- deletion never calls filesystem removal for repo path;
- group conflict and cascade transaction;
- atomic-write rollback.

### HTTP

- list availability fields;
- graph endpoint typed missing error;
- admin delete;
- non-admin 403;
- group conflict 409;
- confirmed cascade success;
- idempotent already-removed behavior.

### Web

- missing card status;
- click opens dialog without Loading navigation;
- cancel no API call;
- remove success updates list;
- error stays in modal;
- typed race error reopens Connect with modal;
- accessibility focus/keyboard behavior.

### Browser

Register a temp repo, delete its directory, open Connect, remove stale entry, assert it disappears and no unrelated file is touched.

## 12. Alternatives rejected

### Automatically remove missing entries during list

Rejected because drives may be temporarily disconnected and removal is destructive metadata mutation.

### Keep generic error plus delete icon

Rejected because it does not distinguish the root cause or explain deletion scope.

### Delete source directory too

Rejected as unsafe and outside registry management.

### Identify repo by name

Rejected because names can change and IDs are the stable registry identity.

## 13. Dependency with management page

The removal API and service are shared with `v1-0-10-repo-group-management-page`. Connect provides contextual recovery; the management page provides deliberate administration. Neither duplicates mutation logic.
