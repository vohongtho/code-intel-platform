# Analysis Certainty Specification

## ADDED Requirements

### Requirement: Materialized semantic relationships MUST be explainable

The system MUST persist compact trust metadata and an addressable site identity for materialized semantic relationships.

#### Scenario: Resolver emits a call/reference relationship

- **WHEN** the relationship is persisted
- **THEN** compact trust metadata MUST identify confidence, certainty, strategy, and resolver version
- **AND** the source call/reference site MUST be addressable when applicable.

### Requirement: Absence MUST NOT be treated as proof when coverage is incomplete

The system MUST NOT treat empty or missing relationship results as exact proof when coverage is incomplete.

#### Scenario: No caller edge is found but interface dispatch is unresolved

- **WHEN** impact or unused-code analysis returns
- **THEN** the result MUST NOT claim exact safe/unused status
- **AND** the incomplete boundary MUST be observable.

### Requirement: Truncation MUST reduce analysis certainty

The system MUST downgrade certainty and mark coverage incomplete when traversal or candidate expansion is truncated.

#### Scenario: Candidate/path expansion reaches a configured limit

- **WHEN** analysis returns only a bounded subset
- **THEN** coverage MUST be incomplete
- **AND** the result MUST be `truncated`/lower-bound rather than exact.

### Requirement: Unresolved outcomes MUST NOT require fake graph targets

The system MUST record unresolved semantic outcomes as evidence without fabricating graph targets.

#### Scenario: Runtime-dynamic/reflection behavior has no safe static target

- **WHEN** resolution declines to bind a target
- **THEN** the system MUST record the unresolved/boundary outcome as evidence
- **AND** MUST NOT fabricate a target edge solely to preserve graph connectivity.

### Requirement: Trust fields MUST be additive to existing public contracts

The system MUST expose trust fields additively so existing clients remain usable without mandatory migration.

#### Scenario: Older client ignores new fields

- **WHEN** it invokes an existing MCP/HTTP operation
- **THEN** existing required response fields MUST remain usable
- **AND** no replacement tool or route MAY be required.
