# Design: Agent-target-aware setup

## 1. Observed 1.0.9 control flow

### 1.1 Analysis-side agent selection

`code-intel/core/src/cli/app.ts` contains the repository agent-selection flow:

```text
analyzeWorkspace()
  → loadAgentTargets(workspaceRoot)
  → if selection exists: reuse it
  → otherwise, for an eligible interactive session:
       promptForAgentTargets(workspaceRoot)
       saveAgentTargets(workspaceRoot, selection)
  → writeContextFiles(...selected targets...)
```

The persisted selection is stored by `code-intel/core/src/storage/metadata.ts` at:

```text
<repo>/.code-intel/agent-targets.json
```

The relevant current symbols are:

```ts
export interface AgentTargetConfig
export interface AgentTargetSelection
export function getAgentTargetsPath(repoDir: string): string
export function loadAgentTargets(repoDir: string): AgentTargetSelection | null
export function saveAgentTargets(repoDir: string, selection: AgentTargetSelection): void
```

The target registry is defined in:

```text
code-intel/core/src/cli/agent-targets.ts
```

with:

```ts
export interface AgentOption
export const AGENT_OPTIONS
export function getAgentOption(agentId: string)
export function resolveBuiltinTarget(agentId: string)
```

The existing lifecycle prompts on the first eligible interactive analysis and reuses the saved selection later. This design does not change that lifecycle and does not add a new analysis flag.

### 1.2 Setup-side integration installation

The current `setup` command is also implemented inside `code-intel/core/src/cli/app.ts`.

Its current control flow is approximately:

```text
setup
  → optionally install shell completion
  → display/write MCP configuration
  → install Claude hook
  → install Cursor hook
  → install Gemini hook
  → install Copilot integration
  → install OpenCode plugin
  → install OpenClaw plugin
  → write project rule files under process.cwd()
       .clinerules
       .windsurfrules
       .kilocode/rules/code-intel-rules.md
       .agents/rules/code-intel-rules.md
       AGENTS.md
```

The setup command does not build its plan from `loadAgentTargets()` and therefore ignores repository selection.

### 1.3 Ownership conflict

Two independent mappings currently exist:

- analysis uses `AGENT_OPTIONS` plus persisted `AgentTargetConfig`;
- setup uses hard-coded installer calls and hard-coded project paths.

This violates a single-source-of-truth design and can create duplicate or conflicting repository files.

---

## 2. Design goals

1. Setup MUST read the saved repository selection.
2. Setup MUST install only selected-agent global integrations by default.
3. Setup MUST perform no repository instruction-file writes.
4. Analyze/context-writer remain the sole owners of repository target files.
5. MCP configuration remains available independently.
6. Missing or malformed selection MUST fail closed for agent integrations.
7. Setup planning MUST be deterministic and testable without filesystem writes.
8. Existing analyze selection behavior MUST remain unchanged.
9. No new `analyze --configure-agents`, `analyze --agents`, or equivalent command is introduced.
10. Existing global integrations MUST not be removed automatically.

---

## 3. Core invariants

### Invariant A — One repository selection source

For default setup behavior, selected agents come only from:

```text
<repo>/.code-intel/agent-targets.json
```

The setup path may be explicitly supplied or default to `process.cwd()`.

### Invariant B — Setup does not own project targets

No function reachable only from the setup command may call `installRulesFile()` or otherwise create/update:

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

### Invariant C — Selection gates global integrations

A global integration is eligible only when:

```text
selected agent
  AND agent registry maps it to the integration
  AND mode is not --mcp-only
```

`--all-agents` explicitly changes the first predicate for global integrations only.

### Invariant D — No broad fallback

Missing, malformed, or partially invalid selection cannot imply “all agents.”

### Invariant E — Existing analyze lifecycle remains stable

This change does not alter when analysis prompts, how it saves selection, or how later analyses reuse it.

---

## 4. Proposed module ownership

The current setup implementation is too large and tightly coupled inside `app.ts`. Split planning and execution into shared, testable modules.

### 4.1 `code-intel/core/src/cli/agent-targets.ts`

Extend the existing registry with setup metadata.

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

The registry owns agent-to-integration mapping. Setup must not infer integrations from labels or target file paths.

Suggested examples:

```ts
{ id: 'claude', setupIntegrations: ['claude-hook'], ... }
{ id: 'cursor', setupIntegrations: ['cursor-hook'], ... }
{ id: 'gemini-cli', setupIntegrations: ['gemini-hook'], ... }
{ id: 'copilot', setupIntegrations: ['copilot-hook'], ... }
{ id: 'opencode', setupIntegrations: ['opencode-plugin'], ... }
{ id: 'openclaw', setupIntegrations: ['openclaw-plugin'], ... }
```

Aliases must be explicit when one product shares another product's installer.

### 4.2 `code-intel/core/src/cli/setup-plan.ts`

New pure planning module.

```ts
export interface SetupPlanInput {
  repositoryPath: string;
  selectedAgentIds: string[];
  allAgents: boolean;
  mcpOnly: boolean;
  dryRun: boolean;
}

export interface PlannedAgentIntegration {
  integrationId: AgentSetupIntegrationId;
  agentIds: string[];
  selected: boolean;
  reason:
    | 'selected'
    | 'all-agents-override'
    | 'unselected'
    | 'mcp-only'
    | 'unsupported';
}

export interface SetupPlan {
  repositoryPath: string;
  selectionSource: 'saved' | 'missing' | 'invalid' | 'all-agents';
  selectedAgentIds: string[];
  mcp: { enabled: boolean };
  integrations: PlannedAgentIntegration[];
  projectWrites: [];
  dryRun: boolean;
}

export function resolveSetupPlan(input: SetupPlanInput): SetupPlan;
```

The planner MUST be pure. It receives validated IDs and returns a deterministic plan. It performs no reads or writes.

`projectWrites` is intentionally an empty tuple/array and acts as an assertion of ownership.

### 4.3 `code-intel/core/src/cli/setup-selection.ts`

New repository-selection loader and validator.

```ts
export type SetupSelectionResult =
  | {
      status: 'available';
      repositoryPath: string;
      path: string;
      selection: AgentTargetSelection;
      validAgentIds: string[];
      unknownAgentIds: string[];
    }
  | {
      status: 'missing';
      repositoryPath: string;
      path: string;
    }
  | {
      status: 'invalid';
      repositoryPath: string;
      path: string;
      reason: string;
    };

export function loadSetupSelection(repositoryPath: string): SetupSelectionResult;
```

Validation requirements:

- root value is an object;
- `selectedAgents` is an array of unique non-empty strings;
- `targets` is an object;
- each known selected agent that has a target references a repository-relative path;
- duplicate IDs are normalized or rejected deterministically;
- unknown IDs are reported and skipped;
- malformed JSON produces `invalid`, not `missing`;
- no fallback to all agents occurs.

The existing `loadAgentTargets()` may remain permissive for backward compatibility. Setup should use a stricter loader or a shared validated parser.

### 4.4 `code-intel/core/src/cli/setup-integrations.ts`

Move installer dispatch behind a typed map.

```ts
export type SetupInstaller = () => HookInstallResult;

export const SETUP_INSTALLERS: Record<AgentSetupIntegrationId, SetupInstaller>;

export interface SetupIntegrationExecution {
  integrationId: AgentSetupIntegrationId;
  result: 'installed' | 'already-present' | 'skipped' | 'failed';
  reason?: string;
}

export function executeSetupIntegrations(
  plan: SetupPlan,
): SetupIntegrationExecution[];
```

Dry-run must bypass every installer.

Installer functions retain current idempotency, backups, and atomic writes.

### 4.5 `code-intel/core/src/cli/setup-command.ts`

Extract setup orchestration from `app.ts`.

```ts
export interface SetupCommandOptions {
  completion?: boolean;
  allAgents?: boolean;
  mcpOnly?: boolean;
  dryRun?: boolean;
}

export async function runSetupCommand(
  targetPath: string,
  options: SetupCommandOptions,
): Promise<number>;
```

Responsibilities:

1. validate target repository path;
2. process completion-only behavior;
3. build/execute MCP setup unless dry-run;
4. load repository selection unless `--all-agents` or `--mcp-only` makes the selection unnecessary for the relevant branch;
5. resolve the plan;
6. execute eligible global integrations;
7. print deterministic summary;
8. never invoke project rules installers.

### 4.6 `code-intel/core/src/cli/app.ts`

Retain only Commander registration and argument normalization:

```ts
program
  .command('setup')
  .argument('[path]', 'Repository whose saved agent selection is used', '.')
  .option('--completion', ...)
  .option('--all-agents', ...)
  .option('--mcp-only', ...)
  .option('--dry-run', ...)
  .action((targetPath, options) => runSetupCommand(targetPath, options));
```

The setup registration MUST NOT add an analysis reconfiguration option.

---

## 5. Setup control flow

### 5.1 Default setup

```text
resolve repository path
  ↓
validate directory
  ↓
build MCP plan
  ↓
load .code-intel/agent-targets.json
  ├─ available → validate IDs → resolve selected integration plan
  ├─ missing   → MCP only + guidance
  └─ invalid   → MCP status + fail-closed agent result
  ↓
execute selected global integrations
  ↓
print summary
```

### 5.2 MCP-only

```text
resolve repository path
  ↓
configure/display MCP
  ↓
skip selection loader
  ↓
skip all agent installers
```

### 5.3 All-agents override

```text
resolve repository path
  ↓
configure/display MCP
  ↓
resolve every registered global integration
  ↓
execute global installers
  ↓
perform zero repository target writes
```

`--all-agents` does not modify saved selection.

### 5.4 Dry-run

```text
resolve repository path
  ↓
read/validate saved selection when needed
  ↓
resolve full plan
  ↓
print plan
  ↓
zero writes
```

No MCP config, backup file, hook, plugin, completion file, or repository file may be written.

---

## 6. Analyze behavior

No new analyze behavior is required.

The following existing functions remain the owner of selection creation and reuse:

```ts
promptForAgentTargets(workspaceRoot)
getOrCreateAgentTargets(workspaceRoot, silent)
loadAgentTargets(workspaceRoot)
saveAgentTargets(workspaceRoot, selection)
writeContextFiles(...)
```

Version 1.0.10 must not add:

```text
code-intel analyze --configure-agents
code-intel analyze --agents
code-intel agent configure
```

Any future reselection behavior requires a separate proposal.

---

## 7. Project-file removal from setup

Remove the setup-only control flow that invokes `installRulesFile()` for:

```text
.clinerules
.windsurfrules
.kilocode/rules/code-intel-rules.md
.agents/rules/code-intel-rules.md
AGENTS.md
```

The generic helper may be removed if no other runtime path needs it. If retained for another purpose, it must not be reachable from `runSetupCommand()`.

Setup may inspect known legacy paths for diagnostics, but inspection must be read-only.

---

## 8. Integration result model

Use a stable result shape:

```ts
export interface SetupSummary {
  repositoryPath: string;
  selectionSource: 'saved' | 'missing' | 'invalid' | 'all-agents';
  selectedAgentIds: string[];
  unknownAgentIds: string[];
  mcp: {
    result: 'installed' | 'updated' | 'already-present' | 'displayed' | 'skipped' | 'failed';
    reason?: string;
  };
  integrations: SetupIntegrationExecution[];
  projectFilesWritten: [];
  dryRun: boolean;
}
```

This can remain internal in 1.0.10 but should be returned by orchestration for deterministic testing.

---

## 9. Error and fallback semantics

### Missing selection

Return successful MCP status and an agent-integration skip with guidance. Do not fail the entire command solely because analysis has not yet saved agents.

### Malformed selection

Do not execute agent installers. Return a non-zero status or clearly classified partial-failure status after reporting MCP outcome. Never broaden scope.

### Unknown agents

Skip and report them. Known selected agents remain eligible.

### Installer failure

Continue independent installers and summarize failures. Do not roll back previously installed global integrations.

### Invalid repository path

Fail before selection or agent writes. Dry-run also requires a valid repository path.

### Existing project files

Never modify or delete them from setup. Report legacy unselected files only as diagnostics.

---

## 10. Compatibility

### Saved state

Current `AgentTargetSelection` JSON remains valid.

### CLI

`code-intel setup` remains the command. New setup-only options are backward-compatible additions.

### Analysis

No new flags, prompts, or state transitions are introduced.

### Project files

Existing files are preserved; setup simply stops managing them.

### Global integrations

Existing hooks/plugins remain idempotent and are not automatically removed.

---

## 11. Alternatives considered

### Alternative A — Let setup prompt for agents

Rejected because it creates another source of truth and can diverge from repository context generation.

### Alternative B — Keep broad setup but only skip project files

Rejected because global hooks/plugins would still ignore explicit repository selection.

### Alternative C — Add `analyze --configure-agents`

Rejected for this change. The requested correction concerns setup behavior, not expansion of the analysis command surface.

### Alternative D — Remove all existing unselected global integrations

Rejected because global configuration can serve multiple repositories and automatic removal may be destructive.

### Alternative E — Use detected installed editors instead of saved selection

Rejected because installed software is not equivalent to repository intent.

---

## 12. Observability

Default output should include:

```text
Repository: /workspace/api
Selection: .code-intel/agent-targets.json
Selected agents: cursor, copilot

MCP:
  updated: code-intel

Global agent integrations:
  installed: cursor-hook
  already present: copilot-hook
  skipped (unselected): claude-hook, gemini-hook

Project instruction files:
  managed by `code-intel analyze`
  written by setup: none
```

Missing selection output must guide the user to run analysis first.

Dry-run output must use “would install,” “would skip,” and “would update” language.

---

## 13. Test strategy

### 13.1 Unit tests

#### `tests/unit/cli/setup-plan.test.ts`

Verify:

- selected IDs map only to their integrations;
- unselected integrations are skipped;
- `--all-agents` selects every global integration;
- `--mcp-only` selects none;
- project writes are always empty;
- deterministic ordering;
- aliases do not duplicate installer execution.

#### `tests/unit/cli/setup-selection.test.ts`

Verify:

- valid selection loads;
- missing file is distinct from malformed JSON;
- duplicate IDs are handled deterministically;
- unknown IDs are reported;
- invalid target paths fail validation;
- no broad fallback.

#### `tests/unit/cli/setup-command.test.ts`

Inject fake MCP writer and installers. Verify:

- only planned installers execute;
- dry-run executes none;
- missing selection executes MCP only;
- invalid selection executes no agent installer;
- summary categorization is stable;
- no project writer dependency exists.

### 13.2 Integration tests

#### Cursor-only repository

Given saved selection `['cursor']`, run setup in a temporary home/repository and assert:

- Cursor global integration is eligible;
- unrelated global installers are not called;
- `.clinerules`, `.windsurfrules`, `.kilocode`, `.agents`, `AGENTS.md`, and `.github` are not created by setup.

#### Missing selection

Assert MCP behavior plus zero agent/project writes.

#### Malformed selection

Assert fail-closed behavior and unchanged files.

#### Dry-run

Snapshot both repository and fake home before/after; assert byte-identical filesystem state.

#### Analyze CLI surface

Assert `code-intel analyze --help` contains no `--configure-agents` or other new reconfiguration option.

### 13.3 Documentation tests

README, core README, changelog, and CLI help must state:

- analysis owns repository target files;
- setup reads saved selection;
- setup installs selected global integrations only;
- setup does not create project rules;
- no new analysis reconfiguration command is documented.

---

## 14. Release validation

Release Readiness must include:

1. build and type-check;
2. full unit/integration tests;
3. packed CLI setup smoke test;
4. Cursor-only no-project-pollution regression;
5. missing/malformed selection regression;
6. dry-run zero-write regression;
7. CLI help assertion that no agent reconfiguration flag was added;
8. package metadata/version checks;
9. high/critical audit gate.

---

## 15. Final architecture

```text
AGENT_OPTIONS
  ├─ project target metadata → analyze/context-writer
  └─ global integration metadata → setup planner

.code-intel/agent-targets.json
  ├─ analyze reuses selection
  └─ setup gates global integration eligibility

analyze
  └─ owns all repository instruction files

setup
  ├─ MCP configuration
  ├─ selected global hooks/plugins
  └─ zero repository instruction writes
```

The existing agent selection remains stable; this design changes only how setup consumes it.