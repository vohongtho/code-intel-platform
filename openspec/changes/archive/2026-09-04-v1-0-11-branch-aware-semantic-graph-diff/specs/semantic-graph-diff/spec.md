# Semantic Graph Diff Specification

## ADDED Requirements

### Requirement: Semantic diff MUST compare two independently identified states

#### Scenario: Base and head refs are supplied
- **WHEN** graph diff runs
- **THEN** each side MUST have a semantic snapshot descriptor tied to its Git tree and analyzer fingerprints
- **AND** neither side MAY silently alias the currently published graph when its requested state differs.

### Requirement: Read-only diff MUST NOT mutate the working tree or published generation

#### Scenario: Graph diff analyzes another branch
- **WHEN** the operation completes or fails
- **THEN** the user's checkout MUST remain unchanged
- **AND** the current Generation V2 publication pointer MUST remain unchanged.

### Requirement: Relationship certainty change MUST be diffable

#### Scenario: Same call changes from exact to ambiguous resolution
- **WHEN** base/head graphs are compared
- **THEN** the relationship MUST appear changed even if display source/target names are unchanged.

### Requirement: Rename detection MUST be conservative

#### Scenario: Two unrelated symbols share a name across refs
- **WHEN** continuity evidence is insufficient
- **THEN** the diff MUST report remove/add rather than a proven rename.

### Requirement: Partial snapshot MUST produce partial diff coverage

#### Scenario: Head analysis reaches an unresolved/truncated boundary
- **WHEN** semantic diff returns
- **THEN** coverage MUST be partial/lower-bound as applicable
- **AND** consumers MUST NOT interpret missing deltas as proof of no change.
