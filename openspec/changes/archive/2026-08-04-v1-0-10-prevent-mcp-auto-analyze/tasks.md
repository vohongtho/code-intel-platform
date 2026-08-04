## 1. Enforce manual-only MCP startup without transport failure

- [x] 1.1 Update `code-intel/core/src/cli/app.ts` `program.command('mcp')` action to remove both the `analyzeWorkspace(targetPath, { silent: true })` fallback and the dedicated missing-index startup exit, so MCP connects successfully even when the current repo has no published index.
- [x] 1.2 Keep the existing indexed startup branch in `code-intel/core/src/cli/app.ts` loading the published graph snapshot and calling `startMcpStdio(...)`, with acceptance evidence that no analyze path is invoked when metadata and graph DB exist.

## 2. Lock the contract with tests

- [x] 2.1 Add or update CLI/MCP startup tests under the existing `code-intel/core` test suite to assert that starting `code-intel mcp` in a repo without `.code-intel/` still connects successfully, prints no startup failure, and leaves no newly created `.code-intel/` artifacts on disk.
- [x] 2.2 Add or update MCP tool-path tests under the existing `code-intel/core` test suite to assert that a graph-backed MCP tool called for an unindexed repo returns the manual `code-intel analyze` recovery instruction while keeping the MCP session usable.
- [x] 2.3 Add or update CLI/MCP startup tests under the existing `code-intel/core` test suite to assert that starting `code-intel mcp` with an existing published index succeeds by loading persisted graph artifacts and does not rebuild the index.
- [x] 2.4 Add or update regression coverage tied to `openspec/specs/mcp-graph-index-reload/spec.md` so explicit post-startup reload behavior still works after a user later runs `code-intel analyze`.
- [x] 2.5 Add or update `code-intel serve` coverage only as needed to prove this change does not break existing fallback behavior for an unindexed current repo when another indexed repo exists, or when no indexed repos exist.

## 3. Update docs and release guidance

- [x] 3.1 Update user-facing docs such as `README.md` and any MCP setup guidance referencing `code-intel setup` / `code-intel mcp` so first-run instructions explicitly require `code-intel analyze`, recommend `code-intel analyze && code-intel setup` as the canonical first-run sequence, and explain that MCP can stay connected while an unindexed repo returns a manual analyze instruction.
- [x] 3.2 Update root `CHANGELOG.md` with a v1.0.10 entry describing the behavior change: MCP startup is now read-only, no longer auto-analyzes unindexed repositories, and no longer drops the connection when a repo is unindexed.
- [x] 3.3 If the project also maintains separate release notes, update that release-notes location with the same v1.0.10 behavior change summary.
