# Program Analysis Foundation Specification

## ADDED Requirements

### Requirement: Advanced program analysis MUST not require a new mandatory workflow

#### Scenario: Existing consumer can benefit from an available advanced artifact

- **WHEN** Code Intel has sufficient semantic prerequisites
- **THEN** the artifact MAY be generated automatically/lazily through the existing workflow
- **AND** the user MUST NOT be required to run a new mandatory `build-cfg`/program-analysis command.

### Requirement: Unsupported lowering MUST remain explicit

#### Scenario: Language construct cannot be modeled safely

- **WHEN** IR/CFG/data-flow lowering encounters it
- **THEN** the artifact MUST contain an unknown/boundary indication
- **AND** MUST NOT silently treat the construct as exact no-op flow.

### Requirement: Resource limits MUST produce truncated status

#### Scenario: Worklist/block/statement/time limit is reached

- **WHEN** analysis stops before complete convergence
- **THEN** the result MUST be marked truncated with reason
- **AND** consumers MUST NOT treat it as complete.

### Requirement: Interprocedural certainty MUST not exceed call-graph certainty

#### Scenario: Data-flow path crosses a heuristic/candidate call relationship

- **WHEN** an interprocedural summary/path is produced
- **THEN** its certainty MUST be no stronger than the required call relationship certainty.

### Requirement: Detailed CFG/PDG artifacts MUST not explode the main graph by default

#### Scenario: Large repository runs ordinary analysis

- **WHEN** detailed statement/block artifacts are not needed by the active workflow
- **THEN** the main symbol graph MUST retain only approved summaries
- **AND** detailed artifacts MAY remain in a versioned side cache/store.
