# Capability: Group management

## ADDED Requirements

### Requirement: Administrators can create groups

The management page SHALL allow an administrator to create a validated group with optional initial registered repositories.

#### Scenario: Create empty group

GIVEN an administrator opens the Group tab
WHEN a unique valid group name is submitted
THEN the group is persisted atomically
AND appears in the list with zero members.

#### Scenario: Create group with initial members

GIVEN registered repositories are selected with unique valid group paths
WHEN group creation succeeds
THEN the group and all initial memberships are persisted together
AND partial creation is not visible if any validation or write fails.

#### Scenario: Invalid or duplicate name

GIVEN a name contains path traversal, separators, reserved characters, or conflicts with an existing group
WHEN creation is submitted
THEN the server returns field-level validation or typed conflict
AND no group file is created.

### Requirement: Administrators can manage memberships

#### Scenario: Add registered repo

GIVEN a group exists
AND a registered repository is not already a member
WHEN an administrator adds it using repo ID and a unique group path
THEN the member is added
AND the displayed member count/status updates
AND prior group sync results are marked stale.

#### Scenario: Remove membership

GIVEN a repository belongs to a group
WHEN an administrator confirms membership removal
THEN only the membership is removed
AND the repository registry entry and source files remain unchanged
AND prior group sync results are invalidated.

#### Scenario: Missing repo member

GIVEN a group contains a member whose registered path is missing
WHEN group detail loads
THEN the member is shown with a warning state
AND the editor remains usable
AND the administrator may remove the membership safely.

### Requirement: Administrators can rename and delete groups

#### Scenario: Rename group

GIVEN a group exists and the target name is valid and unique
WHEN an administrator renames it
THEN members are preserved
AND group configuration and derived sync artifact references move atomically
AND stale concurrent requests receive a conflict.

#### Scenario: Delete group

GIVEN an administrator confirms deletion of a group
WHEN deletion succeeds
THEN the group configuration and derived sync artifact are removed
AND no repository registration or source directory is removed.

### Requirement: Non-admin users have read-only management access

#### Scenario: Viewer opens group management

GIVEN a viewer is authenticated
WHEN the Group tab is opened
THEN group and membership information is visible subject to access scope
AND create, rename, delete, add-member, and remove-member controls are unavailable
AND direct mutation requests return 403.

### Requirement: Concurrent mutations do not lose updates

#### Scenario: Stale group version

GIVEN two clients loaded the same group version
AND client A successfully changes membership
WHEN client B submits a mutation using the stale version
THEN the server returns `409 ENTITY_CHANGED`
AND client B is prompted to refresh
AND client A's update is preserved.
