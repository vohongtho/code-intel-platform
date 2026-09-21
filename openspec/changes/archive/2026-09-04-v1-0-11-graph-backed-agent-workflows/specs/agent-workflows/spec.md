# Agent Workflows Specification

## ADDED Requirements

### Requirement: Workflows MUST use existing Code Intel capabilities rather than duplicate them

#### Scenario: Impact workflow is installed
- **WHEN** an agent follows the workflow
- **THEN** it MUST direct the agent to existing impact/context/graph tools
- **AND** MUST NOT require a workflow-specific replacement impact implementation.

### Requirement: Workflows MUST preserve uncertainty

#### Scenario: Blast radius or relationship evidence is partial
- **WHEN** a workflow forms a conclusion
- **THEN** it MUST treat the result as incomplete/hypothesis-level as appropriate
- **AND** MUST direct targeted verification instead of claiming safety.

### Requirement: Setup MUST preserve user-owned files

#### Scenario: Destination workflow file was modified outside managed ownership
- **WHEN** setup/update runs
- **THEN** it MUST NOT silently overwrite the user's content
- **AND** MUST follow existing ownership/conflict handling.

### Requirement: Workflow references MUST match runtime schemas

#### Scenario: Tool is renamed or removed before release
- **WHEN** workflow release validation runs
- **THEN** validation MUST fail if a bundled workflow references a nonexistent required tool or field.

### Requirement: Optional capabilities MUST degrade explicitly

#### Scenario: API contract feature is unavailable
- **WHEN** API review workflow runs on an older/partial runtime
- **THEN** it MAY use routes/general impact as fallback
- **BUT** MUST identify that response-shape compatibility was not proven.
