# Incremental Semantic Convergence Specification

## ADDED Requirements

### Requirement: Incremental semantic output MUST converge to fresh full analysis

#### Scenario: Same final repository tree reached through an edit history

- **WHEN** the final incremental generation and a forced fresh full generation are normalized
- **THEN** canonical symbols, declaration fragments, relationships, trust/evidence receipts, and required retrieval membership MUST be equivalent
- **AND** equality MUST NOT be established only from node/edge counts.

### Requirement: Unchanged source MUST be re-resolved when dependency facts change

#### Scenario: Declaration/type/public-surface fact changes elsewhere

- **GIVEN** an unchanged file contains a dependent call/reference/import
- **WHEN** semantic invalidation closure is computed
- **THEN** the unchanged dependent site MUST be included for re-resolution.

### Requirement: Incomplete invalidation knowledge MUST fall back to full analysis

#### Scenario: Reverse dependency metadata is missing or incompatible

- **WHEN** planning cannot prove complete closure
- **THEN** the analyzer MUST automatically select the existing correctness-first full graph/BM25 rebuild
- **AND** MUST NOT require a user flag or migration command.

### Requirement: Failed incremental staging MUST preserve the active generation

#### Scenario: Incremental candidate fails convergence/read-back verification

- **WHEN** publication is aborted
- **THEN** the previously published Generation V2 snapshot MUST remain active and reopenable.
