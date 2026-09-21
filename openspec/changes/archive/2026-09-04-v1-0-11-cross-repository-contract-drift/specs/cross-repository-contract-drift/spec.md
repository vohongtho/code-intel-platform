# Cross-Repository Contract Drift Specification

## ADDED Requirements

### Requirement: Group drift MUST compare semantic contract states

#### Scenario: Base and head snapshots exist
- **WHEN** drift is requested
- **THEN** contracts MUST be compared by stable identity and semantic fingerprints
- **AND** timestamps alone MUST NOT determine whether a contract changed.

### Requirement: Breaking producer changes MUST identify known consumers

#### Scenario: Removed response/schema/event field is consumed in another repository
- **WHEN** exact consumer evidence exists
- **THEN** the finding MUST identify the consumer repository and source artifact
- **AND** compatibility MUST be breaking unless contract-kind rules explicitly prove otherwise.

### Requirement: Unknown repository coverage MUST remain visible

#### Scenario: One repository in the group cannot produce the requested snapshot
- **WHEN** group drift completes for the remaining repositories
- **THEN** result coverage MUST be partial
- **AND** the missing repository MUST be listed as a boundary.

### Requirement: No known consumer MUST NOT imply globally unused

#### Scenario: No consumer is found inside synchronized group scope
- **WHEN** a producer contract changes
- **THEN** the result MAY state no known in-scope consumer
- **BUT** MUST NOT claim proven unused unless analysis scope establishes that guarantee.

### Requirement: Presentation limits MUST NOT alter analysis truth

#### Scenario: Caller requests top 20 findings
- **WHEN** more findings exist
- **THEN** output MAY truncate displayed findings
- **AND** MUST separately report total findings and presentation truncation.
