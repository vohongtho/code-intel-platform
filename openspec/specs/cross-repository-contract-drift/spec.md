# Cross-Repository Contract Drift

## Purpose

Upgrade repository groups from discovery/linking into semantic compatibility analysis across producer and consumer repositories, so a backend, shared-schema, or event change can be checked against known consumers rather than only validated locally.

## Requirements

### Requirement: Group drift MUST compare semantic contract states

Cross-repository contract drift MUST compare producer and consumer contracts by stable identity and semantic fingerprint across base and head snapshots, not by timestamp alone.

#### Scenario: Base and head snapshots exist
- **WHEN** drift is requested
- **THEN** contracts MUST be compared by stable identity and semantic fingerprints
- **AND** timestamps alone MUST NOT determine whether a contract changed.

### Requirement: Breaking producer changes MUST identify known consumers

When a producer contract change has exact consumer evidence, the finding MUST identify the affected consumer repository and source artifact, and compatibility MUST be classified as breaking unless contract-kind rules explicitly prove otherwise.

#### Scenario: Removed response/schema/event field is consumed in another repository
- **WHEN** exact consumer evidence exists
- **THEN** the finding MUST identify the consumer repository and source artifact
- **AND** compatibility MUST be breaking unless contract-kind rules explicitly prove otherwise.

### Requirement: Unknown repository coverage MUST remain visible

When a repository in a synchronized group cannot produce the requested snapshot, group drift results MUST report partial coverage and MUST list the missing repository as a boundary.

#### Scenario: One repository in the group cannot produce the requested snapshot
- **WHEN** group drift completes for the remaining repositories
- **THEN** result coverage MUST be partial
- **AND** the missing repository MUST be listed as a boundary.

### Requirement: No known consumer MUST NOT imply globally unused

When no consumer is found within synchronized group scope, the result MAY state that no known in-scope consumer exists but MUST NOT claim the contract is proven globally unused unless the analysis scope establishes that guarantee.

#### Scenario: No consumer is found inside synchronized group scope
- **WHEN** a producer contract changes
- **THEN** the result MAY state no known in-scope consumer
- **BUT** MUST NOT claim proven unused unless analysis scope establishes that guarantee.

### Requirement: Presentation limits MUST NOT alter analysis truth

Presentation limits, such as top-N truncation, MUST NOT alter the underlying analysis results; output MUST separately report the total number of findings and any presentation-level truncation.

#### Scenario: Caller requests top 20 findings
- **WHEN** more findings exist
- **THEN** output MAY truncate displayed findings
- **AND** MUST separately report total findings and presentation truncation.
