# Symbol Identity Specification

## ADDED Requirements

### Requirement: Distinct semantic declarations MUST receive distinct canonical identities

#### Scenario: Overloads share owner and simple name

- **GIVEN** two declarations with the same owner/name but distinct supported signatures
- **WHEN** identity v2 is generated
- **THEN** their canonical symbol IDs MUST be different
- **AND** neither declaration MAY overwrite the other in a selector/resolution index.

### Requirement: Body-only edits MUST preserve canonical symbol identity

#### Scenario: Function implementation changes without declaration change

- **WHEN** the repository is reanalyzed
- **THEN** the function canonical ID MUST remain unchanged
- **AND** its body-derived content MAY change independently.

### Requirement: Partial and merged declarations MUST retain all source fragments

#### Scenario: One canonical symbol has multiple valid declaration fragments

- **WHEN** analysis completes
- **THEN** one canonical symbol MUST represent the semantic entity
- **AND** every contributing fragment MUST remain addressable as source evidence
- **AND** source order MUST NOT discard a fragment.

### Requirement: Multiple call sites MUST remain independently identifiable

#### Scenario: Same caller invokes same target twice

- **GIVEN** two supported call sites at different source ranges
- **WHEN** call-site identity and relationships are persisted/reopened
- **THEN** both call sites MUST remain independently identifiable.

### Requirement: Ambiguous legacy selectors MUST NOT silently become exact

#### Scenario: Old/simple selector maps to multiple v2 symbols

- **WHEN** an existing public workflow uses the selector
- **THEN** the selection path MUST preserve ambiguity or require available contextual disambiguation
- **AND** MUST NOT arbitrarily treat one candidate as exact.
