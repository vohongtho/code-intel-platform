# Agent-aware setup

## ADDED Requirements

### Requirement: Setup uses the saved repository agent selection

`code-intel setup` MUST use the repository's persisted `.code-intel/agent-targets.json` as the default source of selected agent IDs.

#### Scenario: Selected agents gate setup integrations

GIVEN a repository with a valid saved selection containing `cursor` and `copilot`

WHEN the user runs `code-intel setup`

THEN setup MUST consider only global integrations mapped to `cursor` and `copilot`

AND setup MUST skip global integrations owned only by unselected agents.

#### Scenario: Setup targets another repository

GIVEN a valid repository at `./services/api` with its own saved agent selection

WHEN the user runs `code-intel setup ./services/api`

THEN setup MUST load `./services/api/.code-intel/agent-targets.json`

AND MUST NOT use a selection from the shell's current repository.

---

### Requirement: Setup never writes project-scoped agent instruction files

`code-intel setup` MUST NOT create, append, rewrite, truncate, migrate, or delete repository instruction files.

Protected project paths include, but are not limited to:

```text
AGENTS.md
CLAUDE.md
.clinerules
.windsurfrules
.cursor/**
.github/**
.kiro/**
.kilocode/**
.agents/**
```

#### Scenario: Cursor-only selection does not create unrelated files

GIVEN a repository selection containing only `cursor`

WHEN setup completes successfully

THEN setup MUST NOT create `.clinerules`, `.windsurfrules`, `.kilocode`, `.agents`, `AGENTS.md`, `CLAUDE.md`, or `.github` project files

AND any selected Cursor repository target remains owned by the analysis flow.

#### Scenario: Existing project file is preserved

GIVEN an existing `.clinerules` file containing user-authored content

WHEN setup runs for a selection that does not include Cline or Roo Code

THEN setup MUST NOT modify or delete `.clinerules`

AND MAY report it as a legacy unselected file.

#### Scenario: All-agents override remains global-only

GIVEN the user runs `code-intel setup --all-agents`

WHEN every supported global integration is planned

THEN setup MUST still perform zero project-scoped instruction-file writes.

---

### Requirement: Missing selection fails closed for agent integrations

When no saved selection exists, setup MAY configure MCP but MUST NOT install agent-specific hooks or plugins by default.

#### Scenario: Repository was not analyzed

GIVEN the target repository has no `.code-intel/agent-targets.json`

WHEN the user runs `code-intel setup`

THEN MCP setup MAY complete

AND no agent-specific installer may execute

AND setup MUST instruct the user to run `code-intel analyze` first.

---

### Requirement: Invalid selection never broadens setup scope

Malformed or structurally invalid selection data MUST prevent agent integration installation.

#### Scenario: Malformed JSON

GIVEN `.code-intel/agent-targets.json` contains malformed JSON

WHEN setup loads the selection

THEN setup MUST classify the selection as invalid

AND MUST execute no agent-specific installer

AND MUST NOT fall back to all supported agents.

#### Scenario: Unknown agent IDs

GIVEN a structurally valid selection containing one known agent and one unknown agent ID

WHEN setup resolves the integration plan

THEN setup MUST report and skip the unknown ID

AND MAY continue with integrations mapped to the known selected agent

AND MUST NOT infer an integration from the unknown label or target path.

---

### Requirement: MCP configuration remains independent

Setup MUST model MCP configuration separately from repository agent selection.

#### Scenario: MCP completes without agent selection

GIVEN no saved repository agent selection exists

WHEN MCP configuration is supported in the current environment

THEN setup MAY configure or display MCP

AND MUST report agent integration setup as skipped.

#### Scenario: MCP-only mode

GIVEN any saved selection

WHEN the user runs `code-intel setup --mcp-only`

THEN setup MUST perform MCP configuration only

AND MUST execute zero agent installers

AND MUST write zero project instruction files.

---

### Requirement: All-agent behavior requires explicit opt-in

The default setup behavior MUST NOT install every registered global integration.

#### Scenario: Explicit all-agent override

GIVEN the user runs `code-intel setup --all-agents`

WHEN setup resolves global integration eligibility

THEN every registered global integration MAY be considered

AND the saved repository selection MUST remain unchanged

AND no project-scoped instruction file may be created.

---

### Requirement: Setup dry-run has zero side effects

`code-intel setup --dry-run` MUST produce a complete plan without modifying the filesystem.

#### Scenario: Dry-run with saved selection

GIVEN a valid saved selection

WHEN the user runs `code-intel setup --dry-run`

THEN output MUST include the repository path, selection source, selected agent IDs, eligible integrations, skipped integrations, and project-file ownership

AND no MCP config, backup, hook, plugin, completion file, or project file may be written.

#### Scenario: Dry-run with malformed selection

GIVEN a malformed selection file

WHEN setup runs with `--dry-run`

THEN output MUST report invalid selection

AND no filesystem write may occur.

---

### Requirement: Setup reports deterministic results

Setup MUST provide a stable summary of MCP and global agent integration outcomes.

#### Scenario: Mixed installer outcomes

GIVEN one selected integration installs successfully, one is already present, and one fails

WHEN setup completes

THEN the summary MUST classify each result as installed, already present, skipped, or failed

AND one failure MUST NOT erase successful independent outcomes.

---

### Requirement: Setup does not add agent-reconfiguration behavior

This change MUST NOT add a new analysis command or option for reselecting repository agents.

#### Scenario: Analyze CLI remains unchanged

GIVEN the v1.0.10 implementation of this change

WHEN the user runs `code-intel analyze --help`

THEN help MUST NOT contain `--configure-agents`, a new `--agents` option, or another agent-reconfiguration command introduced by this change.

#### Scenario: Setup does not mutate saved selection

GIVEN a valid `.code-intel/agent-targets.json`

WHEN setup runs in default, MCP-only, all-agents, or dry-run mode

THEN the saved selection file MUST remain byte-identical.