# Capability: Missing repository recovery

## ADDED Requirements

### Requirement: Repository availability is explicit

The repo-list API SHALL classify each registered repository without loading its full graph.

#### Scenario: Registered path is missing

GIVEN a repository entry exists in the global registry
AND its registered filesystem path no longer exists
WHEN the client lists repositories
THEN the entry is returned with `availability.status` equal to `missing`
AND `canConnect` is false
AND the repository remains visible for recovery.

### Requirement: Missing repository opens a confirmation dialog

The Connect page SHALL present a focused cleanup dialog rather than attempting normal graph loading for a known missing repository.

#### Scenario: User selects missing repo

GIVEN a repo card is marked missing
WHEN the user activates it
THEN Connect does not navigate to Loading
AND a dialog shows the repo name and registered path
AND explains that removal affects only the Code Intel registry.

#### Scenario: Path disappears after list load

GIVEN a repo was initially listed as ready
WHEN its path disappears before graph loading
AND the graph API returns `CI-REPO-PATH-MISSING`
THEN Connect returns from Loading
AND opens the same missing-repo dialog
AND does not show only a generic error.

### Requirement: Registry removal is safe and authorized

The system SHALL remove stale repository metadata only through an authorized registry mutation.

#### Scenario: Administrator confirms removal

GIVEN an administrator confirms removal
WHEN `DELETE /api/v1/repos/:repoId` succeeds
THEN the registry entry is removed
AND affected group memberships are handled explicitly
AND no repository source file or `.code-intel` artifact is deleted.

#### Scenario: Unauthorized user

GIVEN a non-admin user views a missing repo
WHEN the recovery dialog is displayed
THEN the destructive action is unavailable or disabled
AND a direct delete request returns 403
AND no registry mutation occurs.

### Requirement: Group dependencies are not orphaned

Repository removal SHALL not silently leave invalid group membership references.

#### Scenario: Repo belongs to groups

GIVEN the repository belongs to one or more groups
WHEN removal is requested without explicit cascade approval
THEN the server returns a structured conflict listing those groups
AND neither registry nor group files are modified.

#### Scenario: Cascade is confirmed

GIVEN the affected groups are disclosed
AND an administrator explicitly confirms cascade removal
WHEN the mutation succeeds
THEN the registry entry and its group memberships are updated atomically.

### Requirement: Removal failure remains recoverable

#### Scenario: Registry write fails

GIVEN the confirmation dialog is open
WHEN registry mutation fails
THEN the dialog remains open with a retryable error
AND the repo card remains visible
AND the UI does not claim successful removal.
