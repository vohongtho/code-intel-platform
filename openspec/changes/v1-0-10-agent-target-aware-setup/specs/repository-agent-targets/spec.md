# Repository agent targets

## MODIFIED Requirements

### Requirement: Analyze persists the repository's selected agent targets

Interactive analysis MUST persist the selected agent IDs and their canonical or custom target configuration in `.code-intel/agent-targets.json`.

#### Scenario: First interactive analysis

**GIVEN** no saved repository agent selection exists

**AND** the session is interactive

**WHEN** the user selects one or more agents during analyze

**THEN** analyze saves exactly those agent IDs

**AND** saves one target configuration for each selected ID

**AND** generated project instruction files are limited to those resolved targets.

#### Scenario: Existing selection

**GIVEN** a valid saved repository agent selection exists

**WHEN** analyze runs without an agent reconfiguration option

**THEN** analyze reuses the saved selection

**AND** does not silently add newly supported agents.

#### Scenario: Non-interactive analysis without selection

**GIVEN** no saved selection exists

**AND** the analyze session is non-interactive

**WHEN** analysis completes

**THEN** no implicit all-agent selection is saved

**AND** no project agent instruction target is generated unless explicitly configured by a supported non-interactive mechanism.

### Requirement: Analyze owns project-scoped agent instruction files

The analyze context-generation flow MUST be the exclusive normal owner of repository agent instruction files.

#### Scenario: Selected target generation

**GIVEN** the saved selection contains Cursor with target `.cursor/rules/code-intel.mdc`

**WHEN** analyze generates context files

**THEN** the Cursor target is created or surgically updated

**AND** targets for unselected agents are not created or updated.

#### Scenario: Custom target generation

**GIVEN** a selected custom agent has a valid repository-relative target path and format

**WHEN** analyze generates context

**THEN** content is written only to that configured path

**AND** setup does not duplicate or replace the custom target.

### Requirement: Users can explicitly reconfigure repository agents

Analyze MUST provide an explicit interactive option to replace the saved repository agent selection.

#### Scenario: Reconfigure selected agents

**GIVEN** the saved selection contains Cursor and Copilot

**WHEN** the user runs `code-intel analyze --configure-agents` and selects Claude only

**THEN** the saved `selectedAgents` becomes `claude`

**AND** Claude's target becomes the active generated target

**AND** future setup runs use Claude as the selected setup agent.

#### Scenario: Removed target files are not deleted automatically

**GIVEN** an agent is removed during reconfiguration

**AND** its old project instruction file contains generated or user-authored content

**WHEN** analyze saves the new selection

**THEN** the old file is not deleted automatically

**AND** the user is informed that it is no longer managed by the current selection.

### Requirement: Agent selection persistence is atomic

Writing a repository agent selection MUST not expose a partial or malformed replacement file.

#### Scenario: Successful replacement

**GIVEN** an existing valid selection

**WHEN** a new valid selection is saved

**THEN** the replacement is written through a temporary file and atomic rename

**AND** later readers observe either the old complete selection or the new complete selection.

#### Scenario: Failed replacement

**GIVEN** an existing valid selection

**WHEN** writing the new selection fails before atomic rename

**THEN** the existing saved selection remains readable and unchanged.

### Requirement: Saved selections are validated before setup use

Setup MUST validate repository selection data rather than trusting parsed JSON shape.

#### Scenario: Selected target record missing

**GIVEN** `selectedAgents` contains `cursor`

**AND** `targets.cursor` is missing

**WHEN** setup loads the selection

**THEN** the selection is invalid for setup

**AND** no agent integration is installed.

#### Scenario: Target ID mismatch

**GIVEN** the `cursor` target record declares another `agentId`

**WHEN** setup validates the selection

**THEN** validation fails closed.

#### Scenario: Unsupported custom agent

**GIVEN** a valid custom selected agent with no registered global setup integration

**WHEN** setup builds the integration plan

**THEN** the selection remains valid for analyze-owned project context

**AND** no global integration is planned for that custom agent

**AND** output explains that no global setup integration is registered.
