# Repository agent targets

## MODIFIED Requirements

### Requirement: Repository agent selection is persisted and reused

Code Intel MUST persist repository agent selection in:

```text
<repo>/.code-intel/agent-targets.json
```

The saved selection MUST remain the canonical repository source for both context generation and selection-aware setup.

#### Scenario: First eligible interactive analysis saves selection

GIVEN a repository without `.code-intel/agent-targets.json`

AND analysis runs in an eligible interactive terminal

WHEN the user selects one or more coding agents

THEN Code Intel MUST persist `selectedAgents` and corresponding target configurations

AND analysis MUST generate only the selected repository target files.

#### Scenario: Later analysis reuses selection

GIVEN a valid saved repository selection

WHEN analysis runs again

THEN analysis MUST reuse the saved target set

AND MUST NOT create targets for unselected agents.

#### Scenario: Setup consumes the same selection

GIVEN a valid saved repository selection

WHEN `code-intel setup` runs for that repository

THEN setup MUST use the same `selectedAgents` list to gate global integration eligibility

AND MUST NOT maintain a separate repository selection.

---

### Requirement: Repository target metadata remains authoritative

The `targets` map in the saved selection MUST remain the canonical source for analysis-managed project target paths and formats.

#### Scenario: Built-in target

GIVEN a selected agent with a built-in target in `AGENT_OPTIONS`

WHEN analysis writes context

THEN it MUST use the canonical built-in path and format recorded in the selection.

#### Scenario: Custom target

GIVEN a selected agent with a validated custom repository-relative target

WHEN analysis writes context

THEN it MUST write only that configured target

AND setup MUST NOT replace it with a hard-coded path.

#### Scenario: Setup has a different legacy path

GIVEN an older setup implementation previously used a different path for the same agent

WHEN v1.0.10 setup runs

THEN setup MUST NOT create the legacy project path

AND analysis target metadata remains authoritative.

---

### Requirement: Project target files are analysis-owned

Repository-scoped target creation and managed block updates MUST remain owned by analysis/context-writer.

#### Scenario: Selected project target is generated

GIVEN a selected agent target

WHEN analysis completes without `--skip-agents-md`

THEN context-writer MUST create or update the managed target according to its existing marker-preservation rules.

#### Scenario: Setup follows analysis

GIVEN analysis already created the selected project target

WHEN setup runs

THEN setup MUST leave that file byte-identical

AND MAY install only the selected agent's supported global integration.

#### Scenario: Unselected target does not appear

GIVEN an agent is absent from `selectedAgents`

WHEN analysis and setup both complete

THEN neither command may create that agent's repository target as a side effect of setup behavior.

---

### Requirement: Saved selection validation is safe

Consumers of repository agent targets MUST reject unsafe or malformed state without broadening behavior.

#### Scenario: Unsafe custom path

GIVEN a target path is absolute or escapes the repository using `..`

WHEN setup validates the saved selection

THEN the selection MUST be classified as invalid for agent setup

AND no global installer may be selected through fallback behavior.

#### Scenario: Unknown selected agent

GIVEN `selectedAgents` contains an ID absent from `AGENT_OPTIONS`

WHEN setup validates the selection

THEN it MUST report and skip the unknown ID

AND MUST NOT infer behavior from the target label or path.

#### Scenario: Missing targets map entry

GIVEN a selected agent ID does not have a corresponding target entry

WHEN the agent has a known global setup integration

THEN setup MAY gate the global integration using the selected ID

AND MUST report the incomplete target metadata

AND analysis behavior remains governed by its existing validation and target resolution rules.

---

### Requirement: Setup does not mutate repository selection

`code-intel setup` MUST treat `.code-intel/agent-targets.json` as read-only.

#### Scenario: Default setup

GIVEN a valid saved selection

WHEN default setup completes

THEN the selection file MUST remain byte-identical.

#### Scenario: All-agents override

GIVEN a valid saved selection

WHEN setup runs with `--all-agents`

THEN every global integration MAY be considered

BUT the saved repository selection MUST remain unchanged.

#### Scenario: MCP-only and dry-run

GIVEN any valid saved selection

WHEN setup runs with `--mcp-only` or `--dry-run`

THEN the saved selection MUST remain unchanged.

---

### Requirement: Existing analysis selection lifecycle remains unchanged

Version 1.0.10 agent-aware setup MUST NOT add a new repository agent-reconfiguration command, option, or prompt path.

#### Scenario: No new analyze option

GIVEN the implemented v1.0.10 CLI

WHEN `code-intel analyze --help` is rendered

THEN it MUST NOT include `--configure-agents`

AND MUST NOT include a newly introduced `--agents` option for reselection.

#### Scenario: Existing saved selection continues to be reused

GIVEN a valid saved selection exists

WHEN analysis runs after upgrading to v1.0.10

THEN the existing selection MUST be reused according to the prior lifecycle

AND setup MUST consume that same selection.

#### Scenario: Future reselection is separate scope

GIVEN a future requirement to change repository agent selection

WHEN that behavior is designed

THEN it MUST be proposed as a separate change rather than being implicitly added to agent-aware setup.

---

### Requirement: Legacy files are preserved non-destructively

Existing project files created by older setup behavior MUST NOT be automatically removed or rewritten by this change.

#### Scenario: Legacy unselected file exists

GIVEN `.kilocode/rules/code-intel-rules.md` exists from an older setup run

AND Kilo Code is not selected

WHEN setup runs

THEN the file MUST remain unchanged

AND setup MAY print a diagnostic that it is no longer managed.

#### Scenario: Legacy file contains user content

GIVEN an old agent file contains both Code Intel text and user-authored content

WHEN setup runs

THEN setup MUST not attempt managed-block removal or file deletion.