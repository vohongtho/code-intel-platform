# Design: Agent-target-aware setup

## 1. Observed 1.0.9 control flow

### Analyze

`code-intel/core/src/cli/app.ts` owns the current selection flow:

1. `promptForAgentTargets(workspaceRoot)` displays `AGENT_OPTIONS`.
2. Built-in targets come from `resolveBuiltinTarget(agentId)`.
3. Custom agents collect a repository-relative target path and format.
4. `saveAgentTargets(workspaceRoot, selection)` persists `.code-intel/agent-targets.json`.
5. `getOrCreateAgentTargets()` reuses the saved selection on later analyses.
6. `writeContextFiles()` writes only the resolved target list unless `--skip-agents-md` is used.

The persisted structure is defined in `code-intel/core/src/storage/metadata.ts`:

```ts
interface AgentTargetSelection {
  selectedAgents: string[];
  targets: Record<string, AgentTargetConfig>;
}
```

### Setup

The `setup` action is implemented inline in `code-intel/core/src/cli/app.ts`.

It currently:

1. configures MCP;
2. invokes global hook/plugin installers independently;
3. enters a hard-coded prompt-level section;
4. derives `cwd = process.cwd()`;
5. calls `installRulesFile()` for every known prompt-level agent;
6. writes `.clinerules`, `.windsurfrules`, `.kilocode/rules/code-intel-rules.md`, `.agents/rules/code-intel-rules.md`, and `AGENTS.md` regardless of saved selection.

The setup action does not load `AgentTargetSelection`.

## 2. Design objectives

- one source of truth for repository agent selection;
- no project-level instruction writes from setup;
- selected-agent-only global integrations;
- deterministic and testable planning before writes;
- preserve MCP setup independently;
- preserve existing global installer idempotency;
- fail closed on invalid selection;
- no automatic deletion of legacy files or global hooks.

## 3. Invariants

### Selection invariant

For default setup, an agent integration is eligible only when its canonical agent ID exists in the validated saved selection.

### Project ownership invariant

Only analyze/context-writer may create or update repository agent instruction files.

### No broad fallback invariant

Missing or malformed selection never means all agents.

### Explicit override invariant

All-agent behavior requires `--all-agents`.

### Read-before-write invariant

Setup resolves repository, selection, options, and the complete integration plan before invoking an installer.

### Non-destructive invariant

Setup does not delete project files or uninstall existing global integrations.

## 4. Module boundaries

### 4.1 `cli/agent-targets.ts`

Extend `AgentOption` with setup integration metadata.

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

Add:

```ts
export function getSetupIntegrations(agentId: string): AgentSetupIntegrationId[];
export function getAllSetupIntegrationIds(): AgentSetupIntegrationId[];
```

The registry must use exact IDs, not labels or path heuristics.

### 4.2 New `cli/setup-plan.ts`

Pure planning module.

```ts
export type SetupSelectionSource =
  | 'saved-selection'
  | 'all-agents-override'
  | 'mcp-only'
  | 'missing-selection';

export interface SetupPlanInput {
  repoDir: string;
  selection: AgentTargetSelection | null;
  allAgents: boolean;
  mcpOnly: boolean;
}

export interface SetupPlan {
  repoDir: string;
  selectionSource: SetupSelectionSource;
  selectedAgentIds: string[];
  integrationIds: AgentSetupIntegrationId[];
  skippedIntegrationIds: AgentSetupIntegrationId[];
  configureMcp: boolean;
  writeProjectFiles: false;
  diagnostics: string[];
}

export function buildSetupPlan(input: SetupPlanInput): SetupPlan;
```

Rules:

1. `mcpOnly` wins over agent selection.
2. `allAgents` uses all declared global setup integrations.
3. valid saved selection maps selected agent IDs to declared integration IDs.
4. missing selection produces no agent integrations.
5. duplicate integrations are de-duplicated deterministically.
6. output order follows a stable registry order.
7. `writeProjectFiles` is always `false`.

Conflicting `--mcp-only --all-agents` should be rejected during CLI option validation.

### 4.3 New `cli/agent-target-selection.ts`

Move repository selection loading and validation out of generic metadata helpers.

```ts
export interface AgentTargetSelectionLoadResult {
  state: 'valid' | 'missing' | 'invalid';
  selection: AgentTargetSelection | null;
  path: string;
  errors: string[];
}

export function loadValidatedAgentTargetSelection(repoDir: string): AgentTargetSelectionLoadResult;
export function validateAgentTargetSelection(value: unknown): string[];
export function saveAgentTargetSelectionAtomic(repoDir: string, selection: AgentTargetSelection): void;
```

Validation includes:

- root object shape;
- `selectedAgents` array of non-empty strings;
- no duplicate selected IDs;
- each selected ID has a matching target;
- target `agentId` matches the record key;
- target path passes `isValidRepoRelativeTargetPath()`;
- format is markdown, text, or json;
- unknown selected IDs are reported.

Unknown custom agents already persisted by older behavior may remain valid for project generation, but they have no setup integration unless explicitly registered.

### 4.4 New `cli/setup-agent-integrations.ts`

Own setup execution, with injected installers for testing.

```ts
export type SetupIntegrationStatus =
  | 'installed'
  | 'already-present'
  | 'skipped'
  | 'failed';

export interface SetupIntegrationResult {
  integrationId: AgentSetupIntegrationId;
  status: SetupIntegrationStatus;
  reason?: string;
}

export interface SetupInstallerRegistry {
  install(integrationId: AgentSetupIntegrationId): SetupIntegrationResult;
}

export interface RunSetupOptions {
  repoDir: string;
  completion?: boolean;
  allAgents?: boolean;
  mcpOnly?: boolean;
  dryRun?: boolean;
}

export async function runSetup(options: RunSetupOptions): Promise<number>;
```

`runSetup()` responsibilities:

1. validate repository path;
2. load selection unless overridden;
3. build plan;
4. print plan for dry-run and return without writes;
5. configure MCP;
6. invoke only planned global installers;
7. print one summary;
8. return nonzero only for invalid selection or failed requested integrations according to established CLI failure policy.

Project rules functions are not called from this module.

### 4.5 `cli/app.ts`

Keep commander registration thin.

Replace the inline setup action with:

```ts
program
  .command('setup')
  .argument('[path]', 'Repository whose saved agent selection should be used', '.')
  .option('--completion', ...)
  .option('--all-agents', ...)
  .option('--mcp-only', ...)
  .option('--dry-run', ...)
  .action(async (targetPath, opts) => {
    process.exitCode = await runSetup({
      repoDir: path.resolve(targetPath),
      ...opts,
    });
  });
```

Remove all project-scoped `installRulesFile()` invocations from setup.

If `installRulesFile()` has no remaining owner after removal, delete it and its setup-only constants. Context content remains owned by `context-writer.ts`.

### 4.6 `cli/context-writer.ts`

No broad target list is allowed.

Continue accepting an explicit `AgentTargetConfig[]` resolved from saved selection.

Add or preserve assertions that only passed targets are written.

Do not introduce fallback to `LEGACY_CONTEXT_TARGETS` when a saved selection exists.

### 4.7 `storage/metadata.ts`

The raw path helper may remain for compatibility, but setup should use validated selection APIs.

`saveAgentTargets()` should become atomic or delegate to `saveAgentTargetSelectionAtomic()`.

### 4.8 Analyze reselection

Add `configureAgents?: boolean` to `analyzeWorkspace` options and `--configure-agents` to the command.

Modify `getOrCreateAgentTargets()`:

```ts
async function getOrCreateAgentTargets(
  workspaceRoot: string,
  options: { silent?: boolean; forceConfigure?: boolean }
): Promise<AgentTargetConfig[]>;
```

When `forceConfigure` is true:

- ignore the existing selection for prompting purposes;
- prompt again;
- atomically replace the saved selection;
- return only newly selected targets.

Removed targets are no longer updated, but their files are not deleted.

## 5. Agent integration registry

A setup integration is global and optional. A project target is repository-scoped. They are separate fields.

Example mapping:

```ts
const AGENT_OPTIONS = [
  {
    id: 'claude',
    label: 'Claude Code',
    builtinTarget: { path: 'CLAUDE.md', ... },
    setupIntegrations: ['claude-hook'],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    builtinTarget: { path: '.cursor/rules/code-intel.mdc', ... },
    setupIntegrations: ['cursor-hook'],
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    builtinTarget: { path: '.github/copilot-instructions.md', ... },
    setupIntegrations: ['copilot-hook'],
  },
  {
    id: 'kilocode',
    label: 'Kilo Code',
    builtinTarget: { path: 'AGENTS.md', ... },
    setupIntegrations: [],
  },
];
```

The Kilo example demonstrates the ownership split: analyze writes its selected target; setup does not create `.kilocode` merely because Kilo is supported.

## 6. MCP behavior

MCP remains independent and should be represented as a separate setup step rather than an agent integration ID.

Dry-run must render MCP planned state but invoke no MCP write.

The current Claude Desktop config write remains idempotent and should be extracted behind an injectable helper for tests.

## 7. Legacy file diagnostics

Add a read-only known-path scanner:

```ts
export interface LegacyAgentFileDiagnostic {
  path: string;
  associatedAgentIds: string[];
  selected: boolean;
}

export function findLegacyAgentFiles(repoDir: string, selectedAgentIds: string[]): LegacyAgentFileDiagnostic[];
```

This scanner must not create directories and must not delete files.

Known paths include historical setup outputs. Diagnostics are informational.

## 8. Setup execution flow

```text
Resolve repo path
      ↓
Validate CLI option combination
      ↓
Load and validate saved selection
      ↓
Build pure SetupPlan
      ↓
Dry-run? ── yes ──> print plan; zero writes
      ↓ no
Configure MCP unless disabled by command mode
      ↓
For each planned integration ID
      ↓
Invoke mapped global installer
      ↓
Collect results
      ↓
Scan legacy project files read-only
      ↓
Print summary
```

No branch in this flow writes a repository instruction file.

## 9. Failure semantics

### Invalid target path

No agent installer runs. MCP behavior should be planned before write; preferred implementation validates selection before any write and returns an error, keeping the command fully plan-first.

### Installer error

Return a structured failed result and continue other selected integrations. Final exit status is nonzero if any requested integration failed unexpectedly.

### Missing selection

Not an error for MCP. Agent section is skipped with guidance.

### Unsupported selected agent

Not an error if the agent has no global setup integration. Report that its project instructions are managed by analyze.

### Option conflict

`--all-agents` plus `--mcp-only` returns usage error before filesystem writes.

## 10. Migration

No storage schema migration is required.

Existing selection JSON is validated at runtime.

Existing project files remain untouched.

Existing global hooks remain untouched when no longer selected.

The behavioral migration is documented:

```text
Run analyze first to save repository agent selection.
Then run setup to configure MCP and selected global integrations.
```

## 11. Alternatives considered

### Keep installing every agent

Rejected because it ignores explicit user selection and pollutes repositories.

### Let setup prompt independently

Rejected because it creates a second source of truth and can diverge from analyze.

### Let setup write only selected project files

Rejected because analyze already owns managed context generation and supports custom target paths. Duplicate ownership still risks conflicting content.

### Delete unselected files automatically

Rejected as destructive and unsafe for user-authored content.

### Detect installed editors and ignore saved selection

Rejected because installation detection does not mean the repository uses that agent.

### Store selection globally

Rejected because agent usage can differ by repository.

## 12. Test strategy

### Unit: setup plan

Create `tests/unit/cli/setup-plan.test.ts`.

Assert:

- selected subset maps to subset integrations;
- duplicates are removed;
- missing selection maps to no integrations;
- `mcpOnly` maps to none;
- all-agents maps to all registry integrations;
- `writeProjectFiles` is always false;
- output order is deterministic.

### Unit: selection validation

Create `tests/unit/cli/agent-target-selection.test.ts`.

Assert malformed shapes, duplicate IDs, mismatched target IDs, unsafe paths, invalid formats, valid custom agents, and atomic save.

### Unit: setup executor

Create `tests/unit/cli/setup-agent-integrations.test.ts` with injected fake installers and filesystem.

Assert only planned installer IDs are called and dry-run calls none.

### Integration: CLI setup subset

Create `tests/integration/cli/setup-agent-selection.test.ts`.

Use isolated HOME and repository temp directories.

Assert selected subset, no project file creation, missing selection, invalid selection, explicit path, MCP-only, all-agents, and dry-run.

### Integration: analyze reselection

Extend analyze agent-target integration tests.

Assert `--configure-agents` replaces selection and future setup uses the new set.

### Regression: repository hygiene

Before and after setup, snapshot the repository tree excluding allowed `.code-intel` state. Assert setup creates none of the forbidden project paths.

## 13. Documentation

Update:

- top-level `README.md`;
- `code-intel/core/README.md`;
- CLI help text;
- `CHANGELOG.md`;
- `docs/releases/v1.0.10.md`;
- release readiness checklist.

Documentation must clearly separate:

- analyze = repository target selection and files;
- setup = MCP and selected global integrations.

## 14. Release gates

Release validation must run packed CLI behavior with isolated HOME and repository fixtures.

Required evidence:

- selected Cursor only does not create `.github`, `.kilocode`, `.agents`, `.clinerules`, `.windsurfrules`, or `AGENTS.md`;
- missing selection installs no hooks;
- malformed selection does not install all hooks;
- `--all-agents` is explicit;
- dry-run writes nothing;
- build, tests, package validation, version check, and audit gates pass.
