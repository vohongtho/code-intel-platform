## Why

Agent Code and other MCP clients currently launch `code-intel mcp .` on repository open. In v1.0.7, when `.code-intel/` is missing, the MCP command silently runs `analyzeWorkspace(...)` and creates a new index as a side effect of connection startup. This violates the expected contract that indexing happens only when a user explicitly runs `code-intel analyze`, surprises users opening unindexed repos, and makes MCP connection behavior state-mutating.

## What Changes

- Change `code-intel mcp` startup so it never runs analysis implicitly.
- Allow MCP startup to succeed even when no published index exists for the current repo.
- Make graph-backed MCP tools return a clear instruction to run `code-intel analyze` manually when the requested repo is unindexed.
- Preserve current MCP behavior when a valid published index already exists.
- Keep missing-index semantics non-mutating: no `.code-intel/` creation, no metadata writes, no graph/vector/BM25 side effects during MCP connection or missing-index tool responses.
- Add tests covering missing-index MCP connection, missing-index graph-tool responses, existing-index behavior, and compatibility with graph reload after explicit analyze.
- Document the explicit workflow for MCP users: connect first if needed, run `code-intel analyze`, then let the next graph-backed tool auto-reload.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mcp-graph-index-reload`: MCP startup must never auto-analyze during connection bootstrap; graph-backed MCP tools must surface a clear missing-index instruction for unindexed repos and auto-reload after a later explicit analyze.

## Impact

- Affected code: `code-intel/core/src/cli/app.ts`, `code-intel/core/src/mcp-server/server.ts`, related CLI/MCP tests, README/OpenSpec docs.
- Affected behavior: `code-intel mcp` becomes read-only at startup and may connect without an index, but graph-backed tools for an unindexed repo must respond with a clear manual analyze instruction.
- Compatibility: MCP clients should remain connected for unindexed repos instead of seeing a transport-level startup failure.
- Dependencies: Must remain compatible with existing explicit `code-intel analyze` flow and existing MCP graph reload behavior after an index is later created or refreshed.
