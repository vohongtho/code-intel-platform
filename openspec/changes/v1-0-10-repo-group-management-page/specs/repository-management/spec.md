# Capability: Repository management

## ADDED Requirements

### Requirement: Management page is available without graph connection

The system SHALL provide an authenticated repository-management route independent of the current graph connection.

#### Scenario: User opens repository management

GIVEN an authenticated user is not connected to any repository
WHEN the user opens `/manage/repositories`
THEN the repository catalog is displayed
AND the page does not redirect to Connect or require graph loading.

### Requirement: Repository catalog includes operational status

The management page SHALL show repository identity, path, availability, active state, index time/statistics, and group dependencies.

#### Scenario: Missing repository

GIVEN a registered path no longer exists
WHEN the catalog loads
THEN the repository remains visible with a Missing status
AND historical statistics are clearly identified as last-indexed values
AND the administrator may open the safe registry-removal action.

### Requirement: Repository removal is registry-only

Removing a repository SHALL remove Code Intel registration metadata only.

#### Scenario: Admin removes standalone repo

GIVEN a non-active repository belongs to no group
WHEN an administrator confirms `Remove from Code Intel`
THEN its global registry entry is removed
AND its source directory remains unchanged
AND its repository `.code-intel` directory remains unchanged.

#### Scenario: Active repo

GIVEN the repository is the active repo served by the process
WHEN removal is requested
THEN the server returns `409 ACTIVE_REPOSITORY`
AND no registry or group state changes.

### Requirement: Group dependencies require explicit cascade

#### Scenario: Repo belongs to groups without cascade

GIVEN a repository belongs to one or more groups
WHEN an administrator requests removal without cascade confirmation
THEN the server returns a typed conflict listing affected groups
AND no state changes.

#### Scenario: Explicit cascade

GIVEN the administrator reviews the affected groups and confirms cascade
WHEN removal succeeds
THEN the repository entry and all memberships referencing its repo ID are removed atomically
AND affected group sync artifacts are invalidated
AND repository files remain intact.

### Requirement: Repository mutation is admin-only

#### Scenario: Non-admin direct request

GIVEN the current user is not an administrator
WHEN the user calls the repository delete endpoint
THEN the server returns 403
AND no mutation occurs.
