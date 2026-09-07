# Repository Analysis Serialization Specification

## ADDED Requirements

### Requirement: Only one mutating analysis MAY run per repository

The system MUST acquire a repository-scoped exclusive lock before creating staging, cloning artifacts, spawning the atomic child, or publishing a generation.

#### Scenario: First analysis acquires the lock

- **GIVEN** no analysis lock exists for the repository
- **WHEN** `code-intel analyze` starts
- **THEN** it MUST atomically create `.code-intel/analyze.lock`
- **AND** the lock MUST record owner PID, hostname, start time, and version
- **AND** staging work MAY begin only after lock acquisition succeeds

#### Scenario: Second analysis starts while the first is active

- **GIVEN** process A owns a valid active repository lock
- **WHEN** process B starts analysis for the same repository
- **THEN** process B MUST fail clearly before staging creation
- **AND** the error MUST include A's PID, hostname, and start time when available
- **AND** process B MUST NOT modify A's lock, staging, artifacts, or current manifest

#### Scenario: Analyses target different repositories

- **GIVEN** repositories R1 and R2 have different `.code-intel` roots
- **WHEN** analyses run concurrently for R1 and R2
- **THEN** their locks MUST be independent
- **AND** both MAY proceed

### Requirement: Lock release MUST be owner-safe

A process MUST remove the lock only when the on-disk lock still belongs to that process's ownership token.

#### Scenario: Normal completion

- **GIVEN** process A owns the current lock
- **WHEN** analysis finishes successfully or fails
- **THEN** A MUST release its lock in a finalization path

#### Scenario: Lock replaced after stale recovery

- **GIVEN** process A retains an old in-memory lock object
- **AND** the on-disk lock has been removed and replaced by process B
- **WHEN** A attempts release
- **THEN** A MUST NOT remove B's lock

#### Scenario: Process terminates unexpectedly

- **GIVEN** the owner process exits without releasing the lock
- **WHEN** a later analysis inspects the lock
- **THEN** stale-lock rules MUST determine whether recovery is safe
- **AND** the later process MUST not assume every existing lock is active forever

### Requirement: Stale lock recovery MUST be conservative and explicit

Automatic recovery MUST require evidence that the owner is no longer active or that the lock is safely abandoned.

#### Scenario: Same-host owner PID is dead

- **GIVEN** the lock hostname matches the current host
- **AND** the owner PID is provably not running
- **WHEN** stale-lock recovery runs
- **THEN** the system MAY remove the stale lock
- **AND** it MUST preserve any staging that is still recent until staging cleanup evaluates it

#### Scenario: Same-host owner PID is alive

- **GIVEN** the owner PID is alive
- **WHEN** another analysis starts
- **THEN** the lock MUST be treated as active regardless of age
- **AND** the new analysis MUST fail before staging creation

#### Scenario: Different-host lock is recent

- **GIVEN** the lock hostname differs from the current host
- **AND** the lock age is below the configured stale threshold
- **WHEN** another analysis starts
- **THEN** the lock MUST be preserved
- **AND** the new analysis MUST fail safely

#### Scenario: Different-host lock exceeds stale threshold

- **GIVEN** the owner is on another host
- **AND** the lock exceeds the configured threshold
- **AND** no referenced staging heartbeat is recent
- **WHEN** stale-lock recovery runs
- **THEN** the system MAY classify it as stale according to documented policy
- **AND** recovery MUST be logged

#### Scenario: Malformed lock file

- **GIVEN** `.code-intel/analyze.lock` is malformed
- **WHEN** analysis starts
- **THEN** the system MUST NOT silently overwrite it
- **AND** it MUST provide a recovery instruction
- **AND** explicit force unlock MAY remove it

### Requirement: Lock metadata MUST track generation ownership

The lock MUST identify the base generation and active staging generation when they become known.

#### Scenario: Lock acquired before snapshot resolution

- **GIVEN** analysis has just acquired the lock
- **WHEN** the current snapshot is resolved
- **THEN** the lock SHOULD be updated with `baseGenerationId`

#### Scenario: Staging generation created

- **GIVEN** a publication plan requires staging
- **WHEN** the staging generation is created
- **THEN** the lock MUST be updated with `stagingGenerationId`
- **AND** cleanup MUST use that information to protect active staging

#### Scenario: No-op analysis

- **GIVEN** the planner returns no-op
- **WHEN** analysis exits
- **THEN** no staging generation ID MUST be assigned
- **AND** the lock MUST be released

### Requirement: Active staging MUST include ownership and activity metadata

Every staging generation MUST contain a staging manifest that can be correlated with the lock.

#### Scenario: Staging creation

- **GIVEN** a publication plan exists
- **WHEN** staging is created
- **THEN** `staging.json` MUST record generation ID, base generation ID, PID, hostname, creation time, and last activity time

#### Scenario: Long-running analysis

- **GIVEN** analysis remains active across multiple phases
- **WHEN** phase boundaries or parent/child lifecycle events occur
- **THEN** the staging activity timestamp SHOULD be refreshed
- **AND** cleanup MUST treat recent activity as evidence against abandonment

#### Scenario: Ownership mismatch

- **GIVEN** a staging manifest identifies a different owner than the active lock
- **WHEN** cleanup evaluates the directory
- **THEN** it MUST NOT assume the staging is safe to remove solely because names share a prefix
- **AND** it MUST apply stale/ownership validation

### Requirement: Cleanup MUST NOT remove active or retained state

Generation cleanup and staging cleanup MUST be separate operations with distinct safety rules.

#### Scenario: Successful publication cleanup

- **GIVEN** a new generation is published
- **WHEN** published-generation retention runs
- **THEN** it MUST preserve the current generation
- **AND** it MUST preserve the configured number of newest valid generations
- **AND** it MUST not evaluate staging using published-retention rules

#### Scenario: Active staging referenced by lock

- **GIVEN** a staging directory is referenced by the active lock
- **WHEN** stale-staging cleanup runs
- **THEN** the staging directory MUST be preserved regardless of directory name ordering

#### Scenario: Recent unreferenced staging

- **GIVEN** staging is not referenced by the current lock
- **AND** its activity time is within the stale threshold
- **WHEN** cleanup runs
- **THEN** it MUST be preserved conservatively

#### Scenario: Abandoned stale staging

- **GIVEN** staging exceeds the stale threshold
- **AND** no live owner or active lock references it
- **AND** its path is safely contained under the generations root
- **WHEN** cleanup runs
- **THEN** it MAY be removed
- **AND** the removal MUST be reported in verbose or maintenance output

#### Scenario: Symlinked staging path

- **GIVEN** a staging entry is a symlink or resolves outside the generations root
- **WHEN** cleanup runs
- **THEN** cleanup MUST NOT recursively follow it
- **AND** it MUST report the entry as invalid or unsafe

### Requirement: Analysis failure MUST release serialization ownership without harming another process

#### Scenario: Failure before staging creation

- **GIVEN** planning or snapshot validation fails after lock acquisition
- **WHEN** the command exits
- **THEN** it MUST release its own lock
- **AND** no staging MUST exist

#### Scenario: Failure after staging creation

- **GIVEN** the child or publication fails
- **WHEN** the parent handles the failure
- **THEN** it MUST remove only its own staging by default
- **AND** it MUST release only its own lock
- **AND** the active generation MUST remain unchanged

#### Scenario: Process loses lock ownership

- **GIVEN** the process discovers that the on-disk lock no longer matches its owner token
- **WHEN** it reaches publication
- **THEN** publication MUST be rejected
- **AND** the process MUST not replace `current.json`

## MODIFIED Requirements

### Requirement: Atomic analysis MUST serialize the complete mutation lifecycle

Existing atomic publication behavior MUST be extended so the lock covers planning through publication, not only final manifest replacement.

#### Scenario: Publication order

- **GIVEN** a real analysis requires publication
- **WHEN** the command runs
- **THEN** lock acquisition MUST precede snapshot resolution and staging mutation
- **AND** lock release MUST occur after publication or failure finalization
- **AND** cleanup that could affect shared repository state SHOULD occur only after publication state is settled

#### Scenario: No-op order

- **GIVEN** a no-op is resolved
- **WHEN** the command runs
- **THEN** the lock MUST protect the preflight decision
- **AND** the command MUST release the lock without creating staging or publishing