# Tasks

## Implementation note

The provisional design split setup selection, planning, installer dispatch, and command orchestration into several possible modules. During implementation, the behavior was consolidated into the existing agent registry, `setup-plan.ts`, and `app.ts` so the release could reuse the proven installer and backup logic without duplicating configuration writers. The completed tasks below describe the accepted implementation delivered in v1.0.10.

## 1. Agent registry and integration mapping

- [x] Extend `code-intel/core/src/cli/agent-targets.ts` with typed setup integration identifiers.
- [x] Map supported selected agents to their global hook/plugin integrations.
- [x] Keep repository target paths separate from global setup integration eligibility.
- [x] Deduplicate shared integrations deterministically.
- [x] Ensure agents with only repository instruction targets do not gain an unsupported global installer.

## 2. Saved-selection loading and fail-closed behavior

- [x] Add `code-intel/core/src/cli/setup-plan.ts`.
- [x] Resolve the target repository and `.code-intel/agent-targets.json` path.
- [x] Distinguish valid, missing, invalid, and explicit all-agents selection states.
- [x] Validate the saved selection shape before using it.
- [x] Normalize duplicate selected agent IDs.
- [x] Report unknown agent IDs without broadening the setup scope.
- [x] Ensure missing or malformed selection never falls back to every agent.
- [x] Preserve compatibility with the selection file written by the existing `analyze` flow.

## 3. Pure setup planning

- [x] Build a deterministic setup plan from the saved repository selection.
- [x] Plan MCP independently from agent integrations.
- [x] Select only supported global integrations mapped to selected agents by default.
- [x] Support `--all-agents` for global integrations only.
- [x] Support `--mcp-only` without executing agent installers.
- [x] Support `--dry-run` without invoking installers or modifying files.
- [x] Guarantee the setup plan contains no repository instruction-file writes.
- [x] Add unit tests in `code-intel/core/tests/unit/cli/setup-plan.test.ts` for selected, missing, invalid, unknown, duplicate, and all-agents cases.

## 4. Setup command orchestration

- [x] Update `code-intel/core/src/cli/app.ts` so `code-intel setup` accepts optional `[path]`.
- [x] Add setup-only options `--all-agents`, `--mcp-only`, and `--dry-run`.
- [x] Configure or display MCP independently of the selected agent integrations.
- [x] Dispatch only integrations present in the resolved plan.
- [x] Reuse existing idempotent hook/plugin installers and their backup/atomic-write behavior.
- [x] Print selected, skipped, already-present, installed, and failed outcomes.
- [x] Tell users that repository instruction files are managed by `code-intel analyze`.
- [x] Keep one installer failure isolated from unrelated integrations.

## 5. Repository-write ownership

- [x] Remove setup-time creation of `.clinerules`.
- [x] Remove setup-time creation of `.windsurfrules`.
- [x] Remove setup-time creation of `.kilocode/**`.
- [x] Remove setup-time creation of `.agents/**`.
- [x] Remove setup-time creation or append behavior for `AGENTS.md` and other repository instruction files.
- [x] Ensure setup does not create `.cursor/**` or `.github/**` project instruction files.
- [x] Preserve existing repository files without rewriting or deleting them.
- [x] Keep `analyze` as the only owner of repository instruction-file generation.

## 6. Existing analyze lifecycle

- [x] Preserve the existing first interactive `analyze` agent-selection flow.
- [x] Preserve `.code-intel/agent-targets.json` as the single repository selection source.
- [x] Reuse the saved selection on later analyses.
- [x] Do not add `code-intel analyze --configure-agents`.
- [x] Do not add an equivalent re-selection command or flag in v1.0.10.

## 7. Tests and release validation

- [x] Add setup-plan unit coverage.
- [x] Add a release smoke test with a Cursor-only saved selection.
- [x] Assert the setup plan contains Cursor integration and excludes unselected Claude integration.
- [x] Assert setup dry-run creates no `.cursor`, `.kilocode`, `.agents`, `.clinerules`, `.windsurfrules`, or `AGENTS.md` repository files.
- [x] Assert dry-run invokes no installer writes.
- [x] Assert missing and invalid selection remain fail-closed.
- [x] Assert `--all-agents` affects only global integration eligibility.
- [x] Assert `--mcp-only` skips all agent integrations.
- [x] Assert no analyze reconfiguration option is introduced.

## 8. Documentation and release metadata

- [x] Update the root `README.md` with the setup/analyze ownership contract.
- [x] Update `code-intel/core/README.md` with the same contract and command options.
- [x] Update `CHANGELOG.md` for v1.0.10.
- [x] Add `docs/releases/v1.0.10.md` release notes.
- [x] Update CLI help to document `[path]`, `--all-agents`, `--mcp-only`, and `--dry-run`.

## 9. Completion criteria

- [x] Default setup is driven by `.code-intel/agent-targets.json`.
- [x] Setup writes no repository instruction files.
- [x] Only selected supported global integrations install by default.
- [x] Missing or invalid selection never broadens to all agents.
- [x] MCP-only, all-agents, and dry-run behavior are implemented and verified.
- [x] Existing analyze selection behavior remains unchanged.
- [x] No new agent-reconfiguration command or flag exists.
- [x] Quality, Test, Code Intel PR Impact, Export Source Snapshot, and Release Readiness pass on the release candidate.
