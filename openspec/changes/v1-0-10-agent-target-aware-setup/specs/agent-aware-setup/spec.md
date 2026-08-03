# Agent-aware setup

## ADDED Requirements

### Requirement: Setup uses the saved repository agent selection

`code-intel setup` MUST resolve the target repository and use its validated `.code-intel/agent-targets.json` as the default source of selected agent IDs.

#### Scenario: Selected subset controls setup

**GIVEN** a repository selection containing only `cursor` and `copilot`

**WHEN** the user runs `code-intel setup` for that repository

**THEN** only global setup integrations declared for `cursor` and `copilot` are eligible to run

**AND** integrations for unselected agents are not invoked.

#### Scenario: Explicit repository path

**GIVEN** repository A is the current directory

**AND** repository B has a different saved agent selection

**WHEN** the user runs `code-intel setup ./repository-b`

**THEN** setup uses repository B's saved selection

**AND** does not use repository A's selection.

### Requirement: Setup does not create project-scoped agent files

The setup command MUST NOT create, append, replace, or delete repository-scoped agent instruction files.

#### Scenario: Selected agents still use analyze-owned files

**GIVEN** `cursor` and `copilot` are selected

**WHEN** setup completes

**THEN** setup does not create or modify `.cursor/rules/code-intel.mdc`

**AND** setup does not create or modify `.github/copilot-instructions.md`

**AND** those files remain owned by the analyze/context generation flow.

#### Scenario: Unselected legacy targets are not created

**GIVEN** Kilo Code, Antigravity, Cline, Roo Code, Windsurf, and Codex are not selected

**WHEN** setup completes

**THEN** setup does not create `.kilocode`

**AND** setup does not create `.agents`

**AND** setup does not create `.clinerules`

**AND** setup does not create `.windsurfrules`

**AND** setup does not create or append `AGENTS.md`.

#### Scenario: Existing legacy file is preserved

**GIVEN** an unselected legacy project file already exists and contains user-authored content

**WHEN** setup runs

**THEN** the file remains byte-identical

**AND** setup may report a read-only diagnostic.

### Requirement: Missing selection fails closed for agent integrations

A missing saved selection MUST NOT be interpreted as selecting all supported agents.

#### Scenario: Setup before analyze

**GIVEN** the repository has no `.code-intel/agent-targets.json`

**WHEN** the user runs `code-intel setup`

**THEN** MCP configuration may proceed

**AND** no agent hook or plugin is newly installed

**AND** no project agent file is created

**AND** the command instructs the user to run `code-intel analyze` and rerun setup.

### Requirement: Invalid selection fails closed

Malformed or invalid saved selection MUST prevent agent-specific installation and MUST NOT trigger a broad fallback.

#### Scenario: Malformed JSON

**GIVEN** `.code-intel/agent-targets.json` is malformed JSON

**WHEN** setup runs

**THEN** no agent installer is invoked

**AND** no project file is changed

**AND** the command reports the invalid selection.

#### Scenario: Unsafe target path

**GIVEN** the saved selection contains an absolute or parent-traversal target path

**WHEN** setup validates the selection

**THEN** the selection is rejected for agent setup

**AND** no all-agent fallback occurs.

### Requirement: MCP setup is independent from repository instruction targets

MCP configuration MUST remain a distinct setup responsibility.

#### Scenario: MCP with a valid selection

**GIVEN** a valid saved agent selection

**WHEN** setup runs normally

**THEN** MCP configuration is processed

**AND** selected global integrations are processed separately.

#### Scenario: MCP-only mode

**GIVEN** a valid saved selection with supported global integrations

**WHEN** the user runs `code-intel setup --mcp-only`

**THEN** MCP configuration is processed

**AND** no agent hook or plugin installer is invoked

**AND** no project file is changed.

### Requirement: All-agent behavior is explicit

Installing every supported global integration MUST require an explicit command-line override.

#### Scenario: Explicit all-agents override

**GIVEN** the user runs `code-intel setup --all-agents`

**WHEN** setup builds its plan

**THEN** every registered global setup integration is eligible to run

**AND** no project-scoped instruction file is created.

#### Scenario: Default command is not all-agents

**GIVEN** no `--all-agents` flag

**WHEN** setup builds its plan

**THEN** it never expands missing or partial selection to all integrations.

### Requirement: Setup dry-run is side-effect free

The setup command MUST support a dry-run that exposes the complete plan without filesystem writes.

#### Scenario: Dry-run with selected agents

**GIVEN** a valid selected-agent set

**WHEN** the user runs `code-intel setup --dry-run`

**THEN** output lists the selected agents and planned global integrations

**AND** MCP files are not written

**AND** hooks and plugins are not written

**AND** backup files are not created

**AND** project files are not written.

### Requirement: Setup results are observable

Setup MUST report the selection source and integration outcomes deterministically.

#### Scenario: Mixed installer outcomes

**GIVEN** one selected integration is installed, one is already present, and one fails

**WHEN** setup finishes

**THEN** the summary separates installed, already-present, skipped, and failed results

**AND** identifies each integration by stable integration ID or canonical agent label.
