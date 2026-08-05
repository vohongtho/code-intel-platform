# persistent-repo-identity Specification

## Purpose
TBD - created by syncing archived change persistent-repo-identity-and-unique-names. Update Purpose after archive.
## Requirements
### Requirement: Indexed repositories SHALL have stable internal identities
The system SHALL persist a stable unique repository ID for each indexed repository. That ID SHALL remain unchanged across re-analysis, rename, and relink operations for the same repository.

#### Scenario: Re-analysis preserves repository ID
- **WHEN** a user re-runs `code-intel analyze` for an already indexed repository
- **THEN** the repository keeps the same persisted ID
- **AND** the existing repository entry is updated instead of creating a second identity

#### Scenario: Rename preserves repository ID
- **WHEN** a user renames an indexed repository
- **THEN** the repository keeps the same persisted ID
- **AND** internal references continue targeting that repository ID

#### Scenario: Relink preserves repository ID
- **WHEN** a user updates an indexed repository to a new filesystem path using the supported relink flow
- **THEN** the repository keeps the same persisted ID
- **AND** future repo loads use the new path

### Requirement: Repository names SHALL be explicit unique lookup keys
The system SHALL treat repository names as explicit user-facing lookup keys rather than always deriving them from the current folder basename. Repository names SHALL be unique across the registry.

#### Scenario: Initial analyze with explicit name
- **WHEN** a user indexes a new repository with an explicit repository name
- **THEN** the registry stores that name for the repository
- **AND** repo-selection flows can resolve the repository by that name

#### Scenario: Duplicate name rejected on create
- **GIVEN** an indexed repository already exists with name `alpha`
- **WHEN** a user tries to create or rename another repository to `alpha`
- **THEN** the command fails clearly
- **AND** the existing repository entry remains unchanged

#### Scenario: Name survives folder move
- **GIVEN** an indexed repository has name `alpha`
- **WHEN** the repository path changes through the supported relink flow
- **THEN** the repository name remains `alpha`
- **AND** it is not replaced with the new folder basename

### Requirement: Repository management flows SHALL separate analyze, rename, and relink
The system SHALL require explicit repository-management actions for rename and relink operations rather than inferring them from ambiguous analyze inputs.

#### Scenario: Analyze with conflicting name fails
- **GIVEN** path `/repos/a` is already indexed as repository `alpha`
- **WHEN** a user runs analyze for `/repos/a` while specifying repository name `beta`
- **THEN** the command fails with guidance to use the rename flow
- **AND** the repository keeps name `alpha`

#### Scenario: Analyze with existing name on new path fails
- **GIVEN** repository `alpha` exists at path `/repos/a`
- **WHEN** a user runs analyze for new path `/repos/b` while specifying repository name `alpha`
- **THEN** the command fails with guidance to use the relink flow
- **AND** the existing repository path remains `/repos/a`

#### Scenario: Explicit relink updates path
- **GIVEN** repository `alpha` exists at path `/repos/a`
- **WHEN** a user runs the supported relink command to move `alpha` to `/repos/b`
- **THEN** the registry updates `alpha` to path `/repos/b`
- **AND** future graph loads for `alpha` use `/repos/b`

### Requirement: Persisted repo references SHALL survive rename
Persisted and request-time structures that must continue addressing the same repository after rename SHALL store or accept the stable repository ID rather than relying only on repository name.

#### Scenario: Group member survives rename
- **GIVEN** a group member references repository `alpha`
- **AND** that reference is persisted
- **WHEN** repository `alpha` is renamed to `beta`
- **THEN** the persisted group member still resolves to the same repository
- **AND** group operations do not require manual repair

#### Scenario: Explicit API request survives rename
- **GIVEN** a client stores a repository-selecting API request targeting repository ID `R`
- **AND** repository `R` is renamed from `alpha` to `beta`
- **WHEN** the client executes that stored request after the rename
- **THEN** the request still resolves to repository `R`
- **AND** the system executes against the renamed repository without requiring the caller to update the scope identifier

#### Scenario: Legacy compatibility input resolves to stable identity
- **GIVEN** a documented compatibility request shape still accepts repository name during migration
- **WHEN** the system resolves that request successfully
- **THEN** the request is normalized to the repository's stable ID before authorization and execution

### Requirement: Legacy registry data SHALL migrate without silent loss
The system SHALL migrate existing registry entries that lack repository IDs and SHALL produce unique names for legacy duplicates without dropping repositories.

#### Scenario: Legacy unique entries migrate in place
- **GIVEN** existing registry entries have no repository IDs and unique names
- **WHEN** the migration runs
- **THEN** each entry receives a stable repository ID
- **AND** each entry keeps its existing name and path

#### Scenario: Legacy duplicate names are repaired deterministically
- **GIVEN** existing registry entries have duplicate names
- **WHEN** the migration runs
- **THEN** each entry receives a stable repository ID
- **AND** the migrated names become unique deterministically
- **AND** the system surfaces a warning describing the repaired names
- **AND** no registry entry is dropped

