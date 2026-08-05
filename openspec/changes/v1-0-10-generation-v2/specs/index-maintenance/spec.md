# Index Maintenance and Migration Specification

## ADDED Requirements

### Requirement: Published generation retention MUST be configurable and safe

The system MUST retain the current generation and a configurable number of valid published generations.

#### Scenario: Default retention

- **GIVEN** no custom retention configuration
- **WHEN** a new generation publishes successfully
- **THEN** the system MUST retain the current generation and at least one previous valid generation
- **AND** the effective default `keepGenerations` MUST be `2`

#### Scenario: Retention configured to one

- **GIVEN** `keepGenerations` is configured as `1`
- **WHEN** cleanup runs after successful publication
- **THEN** the current generation MUST be retained
- **AND** older published generations MAY be removed
- **AND** active staging MUST not be evaluated as a published generation

#### Scenario: Invalid retention value

- **GIVEN** `keepGenerations` is zero, negative, non-numeric, or outside supported bounds
- **WHEN** configuration validation runs
- **THEN** the value MUST be rejected
- **AND** cleanup MUST not proceed with an unsafe effective value

### Requirement: Stale staging retention MUST be configurable and conservative

The system MUST use a positive stale-staging threshold and ownership/activity evidence before deleting staging.

#### Scenario: Default stale threshold

- **GIVEN** no custom stale-staging configuration
- **WHEN** cleanup evaluates staging
- **THEN** the effective default threshold MUST be 24 hours

#### Scenario: Invalid stale threshold

- **GIVEN** a non-positive or unsupported stale-staging duration
- **WHEN** configuration validation runs
- **THEN** the value MUST be rejected
- **AND** cleanup MUST preserve uncertain staging rather than deleting aggressively

### Requirement: The CLI MUST provide a safe index cleanup command

The system MUST provide `code-intel index cleanup` for explicit inspection and cleanup of old generations, stale staging, and optionally legacy flat artifacts.

#### Scenario: Dry-run cleanup

- **GIVEN** removable old generations or stale staging exist
- **WHEN** the user runs `code-intel index cleanup --dry-run`
- **THEN** the command MUST list paths and reasons
- **AND** it MUST remove nothing
- **AND** it MUST identify protected current, retained, active, and recent entries

#### Scenario: Normal cleanup

- **GIVEN** entries are safely removable under retention and stale rules
- **WHEN** the user runs `code-intel index cleanup`
- **THEN** only safely removable entries MUST be deleted
- **AND** the current generation MUST remain
- **AND** active/recent staging MUST remain
- **AND** command output MUST summarize removed and preserved entries

#### Scenario: Override retained generation count

- **GIVEN** the user supplies `--keep <n>` with a valid positive value
- **WHEN** cleanup runs
- **THEN** that invocation MUST use the requested retention count
- **AND** it MUST still preserve the current generation

#### Scenario: Unsafe path encountered

- **GIVEN** cleanup finds an entry whose resolved path escapes the index root or is an unsafe symlink
- **WHEN** cleanup runs
- **THEN** it MUST not recursively delete the entry
- **AND** it MUST report the entry as unsafe
- **AND** the command SHOULD return non-zero when manual intervention is required

### Requirement: Legacy flat artifacts MUST be removed only by explicit verified action

Migration MUST preserve legacy source artifacts until the user explicitly requests removal and the generation-backed index is trusted.

#### Scenario: Legacy migration succeeds

- **GIVEN** complete legacy flat graph, BM25, metadata, and optional vector artifacts
- **WHEN** migration creates and publishes a generation
- **THEN** the legacy files MUST remain by default
- **AND** the new generation MUST become current only after validation

#### Scenario: Cleanup without remove-legacy

- **GIVEN** trusted current generation and legacy flat files coexist
- **WHEN** the user runs normal cleanup
- **THEN** legacy flat files MUST remain

#### Scenario: Explicit legacy removal

- **GIVEN** the current generation is trusted and all required generation artifacts validate
- **WHEN** the user runs `code-intel index cleanup --remove-legacy`
- **THEN** the command MAY remove legacy flat artifacts
- **AND** it MUST report each removed path
- **AND** it MUST not remove generation-backed artifacts

#### Scenario: Untrusted current generation

- **GIVEN** the current generation is missing, untrusted, stale, or incomplete
- **WHEN** the user requests `--remove-legacy`
- **THEN** legacy removal MUST be refused
- **AND** the legacy files MUST remain available for recovery

### Requirement: The CLI MUST provide safe lock inspection and unlock behavior

The system MUST provide `code-intel index unlock` for stale lock recovery without making silent lock deletion the default.

#### Scenario: Provably stale same-host lock

- **GIVEN** a same-host lock whose PID is no longer running
- **WHEN** the user runs `code-intel index unlock`
- **THEN** the command MAY remove the lock
- **AND** it MUST display the former owner information

#### Scenario: Active lock

- **GIVEN** the lock owner is active
- **WHEN** the user runs `code-intel index unlock` without force
- **THEN** the command MUST refuse removal
- **AND** it MUST display owner PID, hostname, and start time

#### Scenario: Forced unlock

- **GIVEN** the user explicitly runs `code-intel index unlock --force`
- **WHEN** a lock exists
- **THEN** the command MUST print owner information before removal
- **AND** it MAY remove malformed or unverifiable lock state
- **AND** it MUST warn that an active analysis may fail

#### Scenario: No lock exists

- **GIVEN** no analysis lock exists
- **WHEN** the user runs unlock
- **THEN** the command MUST report that there is no lock
- **AND** it MUST not modify generation state

### Requirement: Maintenance commands MUST preserve public compatibility and machine-readable failures

#### Scenario: Existing CLI behavior

- **GIVEN** users rely on existing analyze, search, inspect, serve, repo, and group commands
- **WHEN** v1.0.10 is installed
- **THEN** existing commands and flags MUST remain valid
- **AND** maintenance additions MUST not change their default output contracts

#### Scenario: Maintenance command failure

- **GIVEN** cleanup or unlock cannot safely complete
- **WHEN** the command exits
- **THEN** it MUST return non-zero
- **AND** the error MUST identify the unsafe or blocked condition
- **AND** it MUST not leave partially deleted protected state

### Requirement: Maintenance and migration MUST be observable

#### Scenario: Verbose cleanup

- **GIVEN** cleanup runs with verbose output
- **WHEN** it evaluates index entries
- **THEN** it MUST identify each entry as current, retained, active staging, recent staging, stale staging, abandoned generation, legacy, invalid, removed, or preserved

#### Scenario: Status after migration

- **GIVEN** a legacy index has been migrated
- **WHEN** index status is requested
- **THEN** status MUST report the active generation ID and manifest version
- **AND** it MAY report that removable legacy artifacts remain

## MODIFIED Requirements

### Requirement: Legacy index migration MUST participate in repository serialization

Existing legacy migration MUST acquire the same repository analysis lock used by normal generation publication.

#### Scenario: Migration conflicts with active analysis

- **GIVEN** an analysis process owns the repository lock
- **WHEN** legacy migration or cleanup requiring mutation starts
- **THEN** the mutation MUST be rejected before changing files
- **AND** the active process MUST remain unaffected

### Requirement: Generation cleanup MUST run only after publication state is settled

Existing post-publication cleanup MUST not race the active publication lifecycle.

#### Scenario: Successful publication

- **GIVEN** a replacement generation has validated and `current.json` points to it
- **WHEN** retention cleanup runs
- **THEN** cleanup MUST preserve the new current generation
- **AND** it MUST apply retention to valid published generations only

#### Scenario: Failed publication

- **GIVEN** publication fails before pointer replacement
- **WHEN** failure cleanup runs
- **THEN** current-generation retention MUST not remove the previous active generation
- **AND** only the failing process's owned staging MAY be aborted immediately