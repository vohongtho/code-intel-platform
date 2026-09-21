# Symbol Identity

## Purpose

Define how the system assigns and preserves canonical symbol identity (identity v2) across declarations, call sites, and legacy selectors, so that semantically distinct declarations never collide, body-only edits don't churn identity, every contributing source fragment stays addressable as evidence, independent call sites stay distinguishable, and ambiguous legacy lookups never get silently resolved to a single arbitrary candidate.

## Requirements

### Requirement: Distinct semantic declarations MUST receive distinct canonical identities

The system MUST assign distinct canonical identities to declarations that are semantically distinct, even when they share a simple name.

#### Scenario: Overloads share owner and simple name

- **GIVEN** two declarations with the same owner/name but distinct supported signatures
- **WHEN** identity v2 is generated
- **THEN** their canonical symbol IDs MUST be different
- **AND** neither declaration MAY overwrite the other in a selector/resolution index.

### Requirement: Body-only edits MUST preserve canonical symbol identity

The system MUST preserve canonical symbol identity when only implementation bodies change and declaration identity facts do not change.

#### Scenario: Function implementation changes without declaration change

- **WHEN** the repository is reanalyzed
- **THEN** the function canonical ID MUST remain unchanged
- **AND** its body-derived content MAY change independently.

### Requirement: Partial and merged declarations MUST retain all source fragments

The system MUST retain every declaration fragment that contributes to one canonical symbol and MUST keep those fragments addressable as evidence.

#### Scenario: One canonical symbol has multiple valid declaration fragments

- **WHEN** analysis completes
- **THEN** one canonical symbol MUST represent the semantic entity
- **AND** every contributing fragment MUST remain addressable as source evidence
- **AND** source order MUST NOT discard a fragment.

### Requirement: Multiple call sites MUST remain independently identifiable

The system MUST preserve independent identity for each supported call site, even when caller and target are the same.

#### Scenario: Same caller invokes same target twice

- **GIVEN** two supported call sites at different source ranges
- **WHEN** call-site identity and relationships are persisted/reopened
- **THEN** both call sites MUST remain independently identifiable.

### Requirement: Ambiguous legacy selectors MUST NOT silently become exact

The system MUST return ambiguity for legacy or simple selectors that map to multiple canonical symbols unless contextual disambiguation makes the target exact.

#### Scenario: Old/simple selector maps to multiple v2 symbols

- **WHEN** an existing public workflow uses the selector
- **THEN** the selection path MUST preserve ambiguity or require available contextual disambiguation
- **AND** MUST NOT arbitrarily treat one candidate as exact.
