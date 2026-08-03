# Tasks

## 1. Agent registry and setup integration metadata

- [ ] Update `code-intel/core/src/cli/agent-targets.ts` to add `AgentSetupIntegrationId` and optional `setupIntegrations` on `AgentOption`.
  - Map supported agent IDs to global integration IDs.
  - Keep project target paths and global integration metadata in the same registry.
  - Add explicit aliases only where two products intentionally share an installer.
  - Acceptance: no setup integration is inferred from labels or project target paths.

- [ ] Add or update `code-intel/core/tests/unit/cli/agent-targets.test.ts`.
  - Assert every declared setup integration ID is supported by the installer registry.
  - Assert no duplicate integration execution is produced by aliases.
  - Assert agents with project-only targets do not automatically gain a global setup integration.

## 2. Repository selection validation

- [ ] Create `code-intel/core/src/cli/setup-selection.ts` with `SetupSelectionResult` and `loadSetupSelection(repositoryPath)`.
  - Distinguish `available`, `missing`, and `invalid` states.
  - Validate `selectedAgents`, `targets`, unique IDs, and repository-relative target paths.
  - Report unknown agent IDs separately from malformed data.
  - Never fall back to all agents.

- [ ] Create `code-intel/core/tests/unit/cli/setup-selection.test.ts`.
  - Valid saved selection returns known IDs.
  - Missing file returns `missing`.
  - Malformed JSON returns `invalid`.
  - Invalid structure and unsafe paths return `invalid`.
  - Unknown IDs are reported and skipped without broadening scope.
  - Duplicate IDs are normalized or rejected deterministically.

## 3. Pure setup planning

- [ ] Create `code-intel/core/src/cli/setup-plan.ts`.
  - Add `SetupPlanInput`, `PlannedAgentIntegration`, and `SetupPlan`.
  - Add pure `resolveSetupPlan(input)`.
  - Plan MCP independently from agent integrations.
  - Gate global integrations by saved selection by default.
  - Support `--all-agents` for global integrations only.
  - Support `--mcp-only`.
  - Guarantee `projectWrites` is always empty.
  - Produce deterministic integration ordering.

- [ ] Create `code-intel/core/tests/unit/cli/setup-plan.test.ts`.
  - Cursor-only selection plans only Cursor integration.
  - Unselected Claude, Gemini, Copilot, OpenCode, and OpenClaw integrations are skipped.
  - `--all-agents` plans all registered global integrations but no project writes.
  - `--mcp-only` plans no agent integration.
  - Missing/invalid selection produces no selected-agent plan.
  - Dry-run changes execution mode but not plan eligibility.

## 4. Setup installer dispatch

- [ ] Create `code-intel/core/src/cli/setup-integrations.ts`.
  - Export typed `SETUP_INSTALLERS` keyed by `AgentSetupIntegrationId`.
  - Move or wrap existing Claude, Cursor, Gemini, Copilot, OpenCode, and OpenClaw installer functions.
  - Add `executeSetupIntegrations(plan)` returning stable installed/already-present/skipped/failed results.
  - Ensure dry-run bypasses every installer.
  - Preserve existing backup, atomic-write, and idempotency behavior.

- [ ] Create `code-intel/core/tests/unit/cli/setup-integrations.test.ts`.
  - Inject fake installers and assert only planned integrations execute.
  - Assert one failure does not block unrelated installers.
  - Assert dry-run invokes zero installers.
  - Assert summary classification is deterministic.

## 5. Setup command orchestration

- [ ] Create `code-intel/core/src/cli/setup-command.ts` with `SetupCommandOptions`, `SetupSummary`, and `runSetupCommand(targetPath, options)`.
  - Validate the repository path.
  - Process completion-only behavior.
  - Configure/display MCP independently.
  - Load saved selection for default setup.
  - Build and execute the setup plan.
  - Print selected, skipped, already-present, installed, and failed results.
  - Print that repository instruction files are managed by `code-intel analyze`.
  - Perform zero repository instruction-file writes.

- [ ] Update `code-intel/core/src/cli/app.ts`.
  - Replace the inline setup body with `runSetupCommand()`.
  - Add optional `[path]` argument.
  - Add setup-only `--all-agents`, `--mcp-only`, and `--dry-run` options.
  - Remove setup calls that write `.clinerules`, `.windsurfrules`, `.kilocode/**`, `.agents/**`, or `AGENTS.md`.
  - Do not add `analyze --configure-agents`, `analyze --agents`, or any agent-reconfiguration command.

- [ ] Remove or isolate the setup-only `installRulesFile()` path in `code-intel/core/src/cli/app.ts`.
  - If no runtime caller remains, delete the helper and setup-specific rule content.
  - If retained elsewhere, prove it is unreachable from `runSetupCommand()`.

## 6. CLI integration coverage

- [ ] Create `code-intel/core/tests/integration/cli/setup-agent-selection.test.ts`.
  - Seed a Cursor-only `.code-intel/agent-targets.json`.
  - Run setup with temporary repository and HOME.
  - Assert unrelated global installers are not invoked.
  - Assert setup does not create `.clinerules`, `.windsurfrules`, `.kilocode`, `.agents`, `AGENTS.md`, or `.github` project files.

- [ ] Add missing-selection coverage.
  - MCP may complete.
  - Agent integrations are skipped.
  - Guidance tells the user to run `code-intel analyze` first.
  - No project files are created.

- [ ] Add malformed-selection coverage.
  - Agent installation fails closed.
  - No fallback to all agents occurs.
  - Existing repository and global config fixtures remain unchanged except explicitly reported MCP writes.

- [ ] Add `--all-agents` coverage.
  - All registered global integrations are eligible.
  - No project instruction files are created.
  - Saved repository selection is not modified.

- [ ] Add `--mcp-only` coverage.
  - No agent installer executes.
  - No project file is created.

- [ ] Add `--dry-run` coverage.
  - Snapshot repository and fake HOME before/after.
  - Assert byte-identical filesystem state.
  - Assert output lists selected and skipped integrations.

- [ ] Add CLI help regression coverage.
  - `code-intel setup --help` documents only setup options.
  - `code-intel analyze --help` does not contain `--configure-agents`, `--agents`, or equivalent reselection options introduced by this change.

## 7. Backward compatibility and legacy diagnostics

- [ ] Preserve existing `.code-intel/agent-targets.json` compatibility in `setup-selection.ts` and storage tests.

- [ ] Add read-only legacy project-file diagnostics.
  - Detect known unselected files only for reporting.
  - Do not append, rewrite, or delete them.
  - Ensure custom user content is never modified.

- [ ] Verify existing installed global hooks/plugins remain idempotent and are not automatically removed when unselected.

## 8. Documentation

- [ ] Update `README.md`.
  - Explain that `analyze` owns project agent files.
  - Explain that `setup` reads the saved selection and installs selected global integrations only.
  - Remove claims that setup installs every agent or creates project rules for all agents.
  - Do not document a new analysis reconfiguration command.

- [ ] Update `code-intel/core/README.md` with the same command and ownership contract.

- [ ] Update `CHANGELOG.md` for v1.0.10.

- [ ] Update CLI help text in `code-intel/core/src/cli/app.ts`.
  - Document `[path]`, `--all-agents`, `--mcp-only`, and `--dry-run`.
  - State that project instruction files are generated by analysis.

## 9. Release validation

- [ ] Update `.github/workflows/release-readiness.yml` or the invoked validation script to include:
  - Cursor-only no-project-pollution regression;
  - missing/malformed selection fail-closed regression;
  - setup dry-run zero-write regression;
  - setup help contract;
  - analyze help assertion that no new agent-reconfiguration flag exists.

- [ ] Run build, type-check, full tests, packed CLI validation, package/version validation, and high/critical audit gate on one release candidate commit.

- [ ] Record final evidence in the v1.0.10 release notes.

## 10. Completion criteria

- [ ] Default setup is selection-driven.
- [ ] Setup writes no repository instruction files.
- [ ] Only selected-agent global integrations install by default.
- [ ] Missing or invalid selection never broadens to all agents.
- [ ] MCP-only, all-agents, and dry-run behavior is verified.
- [ ] Existing analyze selection behavior remains unchanged.
- [ ] No new agent-reconfiguration command or flag is implemented or documented.
- [ ] All release gates pass on the same commit.