# Generation Semantic Verification Specification

## MODIFIED Requirements

### Requirement: Candidate generation MUST pass semantic read-back before publication

The candidate generation MUST pass semantic read-back before publication.

#### Scenario: Required files exist but persisted relationships are incomplete

- **GIVEN** analyzer producer receipts for a staging generation
- **AND** the staging graph file exists and is non-empty
- **WHEN** production read-back shows required persisted semantic content is collapsed/incomplete
- **THEN** publication MUST fail
- **AND** `current.json` MUST continue referencing the previous generation.

### Requirement: Compatibility MUST be derived from semantic analyzer artifacts

Compatibility MUST be derived from semantic analyzer artifacts.

#### Scenario: Resolver semantics change without basic graph-file layout change

- **WHEN** the current resolver/identity/fact compatibility fingerprint differs from the published generation
- **THEN** ordinary analysis planning MUST select the required semantic rebuild/reanalysis
- **AND** MUST NOT trust the index solely because a manual schema version is unchanged.

### Requirement: Artifact trust MUST be capability-specific and truthful

Artifact trust MUST be capability-specific and truthful.

#### Scenario: Vector artifact is unavailable but BM25/graph are verified and vector is optional

- **WHEN** a BM25-only consumer checks trust
- **THEN** graph/BM25 capability MAY remain trusted
- **AND** vector capability MUST report unavailable/unverified independently.

### Requirement: Failed candidate verification MUST preserve the active published snapshot

Failed candidate verification MUST preserve the active published snapshot.

#### Scenario: Evidence or BM25 reopen fails

- **WHEN** candidate verification aborts
- **THEN** the previous graph/BM25/vector/metadata generation MUST remain active and reopenable
- **AND** the failed candidate MUST NOT become current.

### Requirement: Concurrent mutable control-file writers MUST not share one staging pathname

Concurrent mutable control-file writers MUST not share one staging pathname.

#### Scenario: Two processes atomically update the same mutable control file

- **WHEN** both stage writes concurrently
- **THEN** each writer MUST use a private temporary pathname before rename
- **AND** one writer MUST NOT fail solely because the other renamed a shared fixed temp file.
