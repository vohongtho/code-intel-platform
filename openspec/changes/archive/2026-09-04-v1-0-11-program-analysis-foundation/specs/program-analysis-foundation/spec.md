# Program Analysis Foundation Specification

## ADDED Requirements

### Requirement: Advanced program analysis MUST not require a new mandatory workflow

Advanced program-analysis artifacts MUST be obtainable only through existing analyze/inspect/security/context workflows; the platform MUST NOT require a new mandatory command to produce or consume them.

#### Scenario: Existing consumer can benefit from an available advanced artifact

- **WHEN** Code Intel has sufficient semantic prerequisites
- **THEN** the artifact MAY be generated automatically/lazily through the existing workflow
- **AND** the user MUST NOT be required to run a new mandatory `build-cfg`/program-analysis command.

### Requirement: Unsupported lowering MUST remain explicit

Lowering MUST mark any construct it cannot model safely with an explicit unknown/boundary indication rather than silently treating it as exact.

#### Scenario: Language construct cannot be modeled safely

- **WHEN** IR/CFG/data-flow lowering encounters it
- **THEN** the artifact MUST contain an unknown/boundary indication
- **AND** MUST NOT silently treat the construct as exact no-op flow.

### Requirement: Resource limits MUST produce truncated status

When a resource limit is hit before analysis converges, the result MUST be marked truncated with a reason, and consumers MUST NOT treat it as complete.

#### Scenario: Worklist/block/statement/time limit is reached

- **WHEN** analysis stops before complete convergence
- **THEN** the result MUST be marked truncated with reason
- **AND** consumers MUST NOT treat it as complete.

### Requirement: Interprocedural certainty MUST not exceed call-graph certainty

An interprocedural summary or data-flow path MUST carry a certainty no stronger than the certainty of the call relationship it crosses.

#### Scenario: Data-flow path crosses a heuristic/candidate call relationship

- **WHEN** an interprocedural summary/path is produced
- **THEN** its certainty MUST be no stronger than the required call relationship certainty.

### Requirement: Detailed CFG/PDG artifacts MUST not explode the main graph by default

The main symbol graph MUST retain only approved summaries by default; detailed statement/block CFG/PDG artifacts MUST NOT be materialized into it and MAY instead live in a versioned side cache/store.

#### Scenario: Large repository runs ordinary analysis

- **WHEN** detailed statement/block artifacts are not needed by the active workflow
- **THEN** the main symbol graph MUST retain only approved summaries
- **AND** detailed artifacts MAY remain in a versioned side cache/store.
