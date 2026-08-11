# Framework Semantic Adapter Specification

## ADDED Requirements

### Requirement: Framework analysis MUST extend rather than replace base language semantics

#### Scenario: No supported framework is confidently detected

- **WHEN** a repository is analyzed
- **THEN** normal language facts/resolution MUST remain available
- **AND** no framework configuration MUST be required.

### Requirement: Framework relationships MUST have registration evidence

#### Scenario: Route or DI relationship is materialized

- **WHEN** a framework adapter contributes the binding
- **THEN** evidence MUST identify the adapter/version and source registration
- **AND** naming convention alone MUST NOT produce exact certainty.

### Requirement: Ambiguous framework registration MUST remain ambiguous

#### Scenario: Multiple providers/handlers are statically possible

- **WHEN** no framework evidence proves one active target
- **THEN** the resolver MUST preserve candidate/unknown semantics
- **AND** MUST NOT select one based only on iteration order.

### Requirement: Framework registration changes MUST participate in incremental invalidation

#### Scenario: DI binding changes while consumer file is unchanged

- **WHEN** dependency-aware incremental analysis computes closure
- **THEN** affected unchanged consumers MUST be eligible for re-resolution.

### Requirement: Framework adapters MUST NOT scan the repository once per registration

#### Scenario: Route/provider count grows

- **WHEN** production adapter extraction/resolution runs
- **THEN** generation-scoped detection/index preparation MUST satisfy the configured structural traversal budget.
