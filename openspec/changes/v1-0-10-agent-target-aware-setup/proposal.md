# v1.0.10: Make `code-intel setup` respect repository agent selection

## Change ID

`v1-0-10-agent-target-aware-setup`

## Release

`1.0.10`

## Priority

`P0 — Correctness, repository hygiene, and predictable setup behavior`

## Owner area

`cli-and-agent-integrations`

## One-liner

Make `code-intel setup` install only integrations for agents selected and persisted by `code-intel analyze`, while making `analyze` the sole owner of project-scoped agent instruction files.

---

## 1. Summary

Code Intel currently has two independent agent-configuration flows:

1. `code-intel analyze` asks the user which coding agents are used for a repository and persists the selection in `.code-intel/agent-targets.json`.
2. `code-intel setup` ignores that saved selection and unconditionally attempts to install integrations for many agents.

The current `setup` command also writes project-scoped rules files directly into the current working directory, including paths such as:

```text
.clinerules
.windsurfrules
.kilocode/rules/code-intel-rules.md
.agents/rules/code-intel-rules.md
AGENTS.md
```

Other agent-targeted files may also be created during analysis, including:

```text
.cursor/rules/code-intel.mdc
.github/copilot-instructions.md
.kiro/steering/code-intel.md
CLAUDE.md
AGENTS.md
```

As a result, a repository can gain directories and instruction files for agents the user did not select and may not use.

Version 1.0.10 will establish one source of truth:

```text
.code-intel/agent-targets.json
```

The selected agent set saved by `analyze` will determine which agent-specific setup integrations are eligible to install.

Project-scoped instruction files will be owned exclusively by `analyze` and `context-writer`. The `setup` command will no longer create project-level `.cursor`, `.github`, `.kilocode`, `.agents`, `.clinerules`, `.windsurfrules`, `AGENTS.md`, or similar files.

`setup` will continue to configure the MCP server, and it may install global hooks or plugins only for selected agents that support such integrations.

---

## 2. Current behavior

### 2.1 Agent selection during analysis

On the first interactive analysis, Code Intel displays a multi-select list of agents.

The result is persisted as:

```json
{
  "selectedAgents": ["cursor", "copilot"],
  "targets": {
    "cursor": {
      "agentId": "cursor",
      "label": "Cursor",
      "path": ".cursor/rules/code-intel.mdc",
      "format": "markdown",
      "builtin": true
    },
    "copilot": {
      "agentId": "copilot",
      "label": "GitHub Copilot",
      "path": ".github/copilot-instructions.md",
      "format": "markdown",
      "builtin": true
    }
  }
}
```

Subsequent `analyze` runs load this file and generate only the saved targets.

### 2.2 Setup ignores the saved selection

The current `setup` command does not call `loadAgentTargets()`.

Instead, it independently invokes all supported setup installers and then writes hard-coded project rules files under `process.cwd()`.

The project-scoped section currently creates or appends rules for:

- Cline / Roo Code;
- Windsurf;
- Kilo Code;
- Google Antigravity;
- Codex CLI.

These writes are not conditional on `selectedAgents`.

### 2.3 Two ownership models conflict

`analyze` uses `AGENT_OPTIONS` and saved `AgentTargetConfig` values as the canonical target definitions.

`setup` uses separate hard-coded paths.

This causes inconsistencies. For example, the current built-in Kilo Code target in `AGENT_OPTIONS` is `AGENTS.md`, while `setup` writes `.kilocode/rules/code-intel-rules.md`.

The same agent can therefore receive multiple instruction files from different commands.

---

## 3. User-visible problem

A user may select only Cursor during `analyze`:

```text
Selected agents:
- Cursor
```

The expected repository output is:

```text
.cursor/rules/code-intel.mdc
```

However, running:

```bash
code-intel setup
```

can additionally create:

```text
.clinerules
.windsurfrules
.kilocode/
.agents/
AGENTS.md
```

This is incorrect because:

- the user did not select those agents;
- unrelated directories pollute the repository;
- generated files may be committed accidentally;
- tools may auto-detect instruction files for agents that are not in use;
- duplicated instruction files can contain conflicting policy;
- setup behavior differs from analysis behavior;
- users cannot reliably predict what `setup` will write.

---

## 4. Required behavior

### 4.1 One repository source of truth

The selected agent set MUST come from:

```text
<repo>/.code-intel/agent-targets.json
```

The selection saved during `analyze` MUST be the default input for `setup`.

`setup` MUST NOT infer that every supported agent is selected.

### 4.2 Project-scoped files belong to `analyze`

`code-intel analyze` and `context-writer` MUST be the only normal flow that creates or updates project-scoped agent instruction files.

`code-intel setup` MUST NOT create or append any project-scoped instruction file, including:

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

This applies even when the corresponding agent is selected.

The selected agent's project file will already be created or updated by `analyze` according to the saved target configuration.

### 4.3 Selected global integrations only

`setup` MAY install global hooks or plugins for a selected agent when Code Intel has a supported global integration.

Examples:

| Selected agent ID | Eligible setup integration |
| --- | --- |
| `claude` | Claude Code global PreToolUse hook |
| `cursor` | Cursor global hook configuration |
| `gemini-cli` | Gemini CLI global hook |
| `copilot` | GitHub Copilot supported global hook/configuration |
| `opencode` | OpenCode global plugin |

An unselected agent MUST NOT receive a new global integration during that setup run.

Existing global integrations for agents that are no longer selected MUST NOT be removed automatically in 1.0.10.

### 4.4 MCP remains independent

MCP server configuration is a platform integration, not a repository-specific instruction target.

`setup` SHOULD continue to display and configure MCP regardless of whether an agent selection exists.

Agent-specific installation occurs only after resolving a valid repository selection.

### 4.5 Missing selection

When `.code-intel/agent-targets.json` does not exist:

- MCP setup MAY proceed;
- no agent-specific hook, plugin, or project file may be created;
- the command must explain that no repository agent selection is available;
- the command must instruct the user to run `code-intel analyze` first and rerun `code-intel setup`.

Example output:

```text
ℹ No saved agent selection found for this repository.
  MCP configuration completed.
  Run `code-intel analyze` to select agents, then rerun `code-intel setup`.
```

### 4.6 Invalid selection

If `agent-targets.json` is malformed or contains invalid data:

- setup must fail closed for agent integrations;
- setup must not fall back to all agents;
- setup must not create project files;
- the error must identify the invalid repository selection;
- existing user files must remain unchanged.

### 4.7 Repository path

The setup command SHOULD accept an optional repository path:

```bash
code-intel setup [path]
```

Default:

```text
process.cwd()
```

The resolved path determines where `.code-intel/agent-targets.json` is loaded from.

This avoids coupling selection to the shell's current directory when the user explicitly targets another repository.

### 4.8 Explicit compatibility override

For users who intentionally want the historical broad installation behavior, add an explicit opt-in flag:

```bash
code-intel setup --all-agents
```

The flag MAY install every supported global integration, but it still MUST NOT create project-scoped instruction files.

The default behavior MUST remain selection-driven.

### 4.9 Dry-run visibility

Add:

```bash
code-intel setup [path] --dry-run
```

Dry-run must report:

- resolved repository;
- selection source;
- selected agent IDs;
- global integrations that would be installed;
- integrations skipped because the agent is unselected;
- project instruction files managed by `analyze`;
- zero filesystem writes.

---

## 5. Proposed command contract

```text
code-intel setup [path]
  --completion
  --all-agents
  --mcp-only
  --dry-run
```

### Default

```bash
code-intel setup
```

Behavior:

1. resolve current repository;
2. configure or display MCP;
3. load saved agent selection;
4. build an integration plan;
5. install global integrations only for selected agents;
6. do not write repository instruction files.

### Path-specific

```bash
code-intel setup ./services/api
```

Loads:

```text
./services/api/.code-intel/agent-targets.json
```

### MCP only

```bash
code-intel setup --mcp-only
```

Configures MCP and skips all agent hook/plugin installations.

### All global integrations

```bash
code-intel setup --all-agents
```

Explicitly opts into all supported global integrations.

This does not restore project-level bulk rules generation.

---

## 6. Ownership model

### `analyze` owns

- interactive agent selection;
- persisted repository selection;
- canonical target paths;
- project-scoped agent context generation;
- managed block updates;
- custom target paths;
- target format handling.

### `setup` owns

- MCP configuration;
- selected-agent global hooks;
- selected-agent global plugins;
- integration diagnostics;
- setup dry-run;
- idempotent global setup writes.

### Shared registry owns

- agent IDs;
- labels;
- canonical project target metadata;
- supported setup integration type;
- aliases where multiple products share a file or hook implementation.

---

## 7. Integration mapping

Extend agent metadata so setup capability is declared in the same registry as the analysis target.

Suggested shape:

```ts
export type AgentSetupIntegrationId =
  | 'claude-hook'
  | 'cursor-hook'
  | 'gemini-hook'
  | 'copilot-hook'
  | 'opencode-plugin'
  | 'openclaw-plugin';

export interface AgentOption {
  id: string;
  label: string;
  builtinTarget?: AgentTargetConfig;
  setupIntegrations?: AgentSetupIntegrationId[];
}
```

Example:

```ts
{
  id: 'cursor',
  label: 'Cursor',
  builtinTarget: {
    agentId: 'cursor',
    label: 'Cursor',
    path: '.cursor/rules/code-intel.mdc',
    format: 'markdown',
    builtin: true
  },
  setupIntegrations: ['cursor-hook']
}
```

Agents with project rules only do not need a setup integration because `analyze` already owns their project target.

---

## 8. Analyze selection updates

The current analysis flow reuses an existing selection and does not normally ask again.

Version 1.0.10 SHOULD add an explicit way to update repository agent selection:

```bash
code-intel analyze --configure-agents
```

Behavior:

- rerun interactive selection;
- replace `.code-intel/agent-targets.json` atomically;
- generate/update selected target files;
- stop updating targets removed from the selection;
- do not delete removed target files automatically;
- print a warning identifying legacy files that are no longer managed.

Non-interactive automation MAY use a future explicit `--agents` option, but that is not required for the initial 1.0.10 implementation.

---

## 9. Legacy project files

Version 1.0.10 will stop creating unselected project files but will not automatically delete existing files.

Reason:

- files may contain user-authored content;
- managed markers may coexist with custom content;
- deletion during setup would be destructive;
- ownership of older files may be ambiguous.

When setup detects known project files for unselected agents, it SHOULD print a non-destructive diagnostic:

```text
ℹ Legacy agent file detected but not modified: .kilocode/rules/code-intel-rules.md
```

Cleanup or managed-block removal requires a separate explicit command and is outside this change.

---

## 10. In scope

- load repository agent selection during setup;
- validate the selection before agent-specific setup;
- stop setup from writing all project-scoped rules files;
- install global hooks/plugins only for selected agents;
- add optional setup repository path;
- add `--mcp-only`;
- add `--all-agents` as explicit compatibility opt-in;
- add `--dry-run` planning output;
- centralize setup integration metadata with agent options;
- add `analyze --configure-agents` for reselection;
- update CLI help, README, core README, changelog, tests, and release validation.

---

## 11. Non-goals

This change will not:

- delete existing global hooks for unselected agents;
- delete project instruction files automatically;
- migrate arbitrary user-authored agent files;
- detect every installed coding agent on the system;
- install agents or editors;
- change MCP tools or MCP response contracts;
- change context content or tool-policy wording;
- generate project instruction files from `setup`;
- make one repository's selection globally authoritative for all repositories;
- add remote/distributed setup state;
- modify Generation V2 behavior.

---

## 12. Compatibility

### Existing saved selections

Existing `.code-intel/agent-targets.json` files remain valid.

### Existing setup command

`code-intel setup` remains available.

Its default behavior becomes safer and narrower:

```text
Before: attempt integrations for all supported agents.
After: configure MCP plus selected-agent global integrations only.
```

### Existing project files

No existing project file is removed.

### Existing global hooks

Existing hooks remain installed and are treated idempotently.

### Non-interactive setup

Non-interactive setup does not prompt for repository agents. It uses saved selection, `--all-agents`, or `--mcp-only`.

---

## 13. Failure semantics

### Missing repository

If the target path does not exist or is not a directory, setup exits with a clear error before writing agent integrations.

### Missing selection

MCP may complete; agent integrations are skipped successfully with guidance.

### Malformed selection

Agent integration planning fails closed. No all-agent fallback is allowed.

### Unknown agent ID

Unknown IDs are reported. The safe default is to skip them rather than map them heuristically.

If all selected IDs are unknown, setup performs MCP only and returns a diagnostic failure status for agent setup.

### Individual global installer failure

One selected integration failure does not roll back other successful global installations, matching current idempotent setup behavior.

The final summary must list installed, already present, skipped, and failed integrations separately.

### Dry-run

Dry-run performs no writes, including MCP config, backups, hooks, plugins, or completion changes.

---

## 14. Security and safety

- repository paths must be resolved and validated;
- agent target paths must remain repository-relative;
- setup must not execute target paths as commands;
- malformed JSON must not trigger broad fallback behavior;
- project file writes must be absent from setup;
- global config writes must retain current backup and atomic-write behavior;
- dry-run must not touch the filesystem;
- logs must not include secrets from unrelated editor configuration;
- aliases must be explicit in the registry rather than inferred from labels.

---

## 15. Observability

Default setup summary:

```text
Repository: /workspace/api
Selection source: .code-intel/agent-targets.json
Selected agents: cursor, copilot

MCP:
  installed: code-intel

Agent integrations:
  installed: cursor-hook
  already present: copilot-hook
  skipped: claude-hook (agent not selected)

Project instruction files:
  managed by analyze; no setup writes performed
```

Missing selection summary:

```text
Repository: /workspace/api
Selection source: none
Selected agents: none

MCP:
  configured

Agent integrations:
  skipped: no saved repository agent selection

Next:
  run `code-intel analyze` and select agents
```

---

## 16. Required tests

### Selected subset

Given saved selection `cursor` and `copilot`, setup must:

- plan only Cursor and Copilot global integrations;
- not invoke Claude, Gemini, OpenCode, or other installers;
- not create `.clinerules`;
- not create `.windsurfrules`;
- not create `.kilocode`;
- not create `.agents`;
- not create or append `AGENTS.md`;
- not create `.cursor/rules` or `.github/copilot-instructions.md`.

### Missing selection

Setup must configure MCP only and create no agent files or hooks.

### Malformed selection

Setup must create no agent integration and must never fall back to all agents.

### All-agent override

`--all-agents` may invoke every supported global installer but still creates no project instruction files.

### MCP-only

`--mcp-only` invokes no agent installer even when a saved selection exists.

### Dry-run

`--dry-run` reports the plan and creates zero files.

### Path resolution

`setup ./repo-b` must use repo B's saved selection even when executed from repo A.

### Custom targets

A custom target selected during analysis remains owned by analyze; setup does not write it.

### Reselection

`analyze --configure-agents` replaces the saved selected-agent set and future setup runs use the new set.

### Existing legacy files

Setup does not delete or modify unselected legacy project files.

---

## 17. Acceptance criteria

The change is complete when:

1. `code-intel setup` loads saved repository agent selection.
2. No default setup path installs all agents.
3. Setup creates no project-scoped agent instruction file.
4. Selected agents alone determine global installer eligibility.
5. Missing or invalid selections fail closed for agent integrations.
6. MCP setup continues to work independently.
7. `setup [path]` resolves selection from the target repository.
8. `--mcp-only`, `--all-agents`, and `--dry-run` behave as specified.
9. `analyze --configure-agents` can update the saved selection.
10. Existing files and global hooks are not deleted.
11. Unit and integration tests verify absence of unselected writes.
12. README and CLI help describe `analyze` before selection-aware setup.
13. All release workflows pass on one exact commit.

---

## 18. Release evidence

Release Readiness must prove:

- setup with one selected agent invokes only its installer;
- setup does not create `.cursor`, `.github`, `.kilocode`, `.agents`, or unrelated rule files;
- missing selection is MCP-only;
- malformed selection does not broaden installation;
- all-agent behavior requires explicit flag;
- dry-run is side-effect free;
- package CLI help contains the updated command contract;
- packed-package execution matches source tests;
- high/critical audit gate passes.

---

## 19. Final decision

Version 1.0.10 will replace the current model:

```text
analyze selection saved
        +
setup independently installs every agent
        +
setup writes hard-coded repository rules
```

with:

```text
analyze selects and persists agents
        ↓
analyze owns project instruction files
        ↓
setup loads the saved selection
        ↓
setup configures MCP
        ↓
setup installs selected global integrations only
```

This removes unwanted repository directories, eliminates duplicate target definitions, and makes setup behavior match the user's explicit agent selection.
