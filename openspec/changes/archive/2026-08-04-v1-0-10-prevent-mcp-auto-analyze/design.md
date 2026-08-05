## Context

Observed v1.0.7 control flow:

```text
Agent Code / editor MCP client
        │
        ▼
launches `code-intel mcp .`
        │
        ▼
code-intel/core/src/cli/app.ts `.command('mcp')`
        │
        ├─ existing published index found
        │      └─ load graph DB, startMcpStdio(...)
        │
        └─ no published index found
               └─ analyzeWorkspace(targetPath, { silent: true })
                  then startMcpStdio(...)
```

This means MCP connection startup is currently state-mutating. Opening an unindexed repository from an MCP client creates `.code-intel/`, writes metadata, and performs a potentially expensive full analysis without an explicit user command.

Ownership boundaries:
- `code-intel/core/src/cli/app.ts`
  - owns CLI commands including exported user-facing `mcp` command
  - owns private `analyzeWorkspace(...)`
  - currently decides whether MCP startup loads an existing graph or analyzes first
- `code-intel/core/src/mcp-server/server.ts`
  - owns `startMcpStdio(...)` and `createMcpServer(...)`
  - should serve a graph, not decide to build one
- `code-intel/core/src/storage/index-snapshot.ts`, `metadata.ts`
  - own published-index discovery and metadata validation

Constraint:
- explicit `code-intel analyze` remains the only allowed index-building path.
- MCP startup must stay compact and preserve backward compatibility of tool schemas, while changing missing-index behavior from startup failure to tool-time guidance for unindexed repositories.

## Goals / Non-Goals

**Goals:**
- Make `code-intel mcp` read-only at bootstrap.
- Allow MCP startup to succeed even when the current repo has no published index.
- Return a clear, actionable tool-time message when a graph-backed MCP call targets an unindexed repo: run `code-intel analyze` first.
- Guarantee missing-index MCP startup and tool responses do not create `.code-intel/` or mutate published artifacts.
- Preserve successful behavior for already indexed repos.
- Preserve later MCP graph reload behavior after explicit analyze updates the index.

**Non-Goals:**
- Changing `code-intel analyze` incremental/full selection behavior.
- Redesigning MCP tool schemas or runtime tool semantics.
- Changing `code-intel serve` fallback behavior in this change; `serve` may continue starting against another indexed repo or an empty UI when the current repo is unindexed.
- Removing every other implicit analyze path in this change unless they are required to keep MCP policy coherent.
- Adding background indexing, prompts, or automatic retry flows.

## Decisions

### 1. `code-intel mcp` will connect without auto-analyze even when the repo is unindexed
- Replace the missing-index branch in the `mcp` command action in `code-intel/core/src/cli/app.ts`.
- New behavior: if no valid published index snapshot/metadata exists, still start the MCP server with the existing fallback graph path instead of calling `analyzeWorkspace(...)` or exiting.
- Rationale: this keeps MCP transport stable, avoids generic connection-closed editor errors, and still enforces manual-only analyze.

Alternatives considered:
- Fail fast at startup. Rejected: editor users only see a transport-level failure and lose the opportunity for tool-time guidance.
- Keep auto-analyze but add a warning. Rejected: still mutates state unexpectedly.
- Add `--auto-analyze` opt-in to `mcp`. Rejected for now: not needed to solve the correctness issue and complicates editor config.

### 2. Missing-index handling moves to MCP tool-time repo loading
- The `mcp` command may still prefer loading a startup graph when a published index exists.
- Missing-index detection for the target repo should rely on the existing lazy repo-loading path in `createMcpServer(...)` / `ensureRepoLoaded(...)`.
- Graph-backed MCP tools must surface an explicit manual-analyze instruction when the requested repo is unindexed.
- Rationale: ownership stays clear. CLI bootstrap owns transport startup; MCP server owns repo graph availability at tool time.

Alternatives considered:
- Keep missing-index handling only in CLI bootstrap. Rejected: causes transport failure instead of actionable tool-level guidance.

### 3. Missing-index tool response must be explicit, actionable, non-ambiguous
- Graph-backed MCP responses for an unindexed repo should mention the repo path and instruct the user to run `code-intel analyze`.
- The MCP connection must remain open so the user can analyze and retry without reconnecting.
- Rationale: editor users need an obvious manual recovery step without a transport-level failure.

Candidate shape:
```text
No published index found for /path/to/repo.
Run `code-intel analyze` in this repository, then retry the MCP tool call.
```

### 4. Existing indexed startup path remains unchanged
- If snapshot + graph DB + metadata are present, `code-intel mcp` still loads DB and starts MCP immediately.
- Rationale: avoid unnecessary churn for already-indexed repositories and preserve fast startup.

### 5. `code-intel serve` remains separate in this release
- `code-intel serve` already has non-mutating fallback behavior for unindexed current repos: it may start against another previously indexed repo from the registry, or start an empty UI if no indexed repos exist.
- This change will not alter that `serve` behavior.
- Rationale: the bug is specific to Agent Code / MCP startup mutating the current repo. `serve` is a UI bootstrap path and already avoids auto-analyzing the current unindexed repo.

Alternatives considered:
- Force `serve` to fail like `mcp` when the current repo is unindexed. Rejected for this release: it would remove an existing convenience path without being necessary to fix the MCP correctness issue.

### 6. Test at command-boundary and tool-boundary
- Add/adjust tests for the `mcp` command startup path covering:
  - missing index still allows MCP startup and does not create `.code-intel/`
  - graph-backed tool calls for an unindexed repo return the manual `code-intel analyze` instruction while keeping the connection usable
  - existing index starts MCP without invoking analyze
  - after explicit analyze creates index, a later graph-backed MCP call succeeds and existing reload specs remain coherent
- Rationale: this is a user-visible CLI and MCP contract, not an internal helper detail.

## Risks / Trade-offs

- [Tool contract change] Some graph-backed MCP tools may currently return empty/fallback results for an unindexed repo unless guarded explicitly → Mitigation: add clear missing-index tool responses and regression tests.
- [Policy gap] `search` / `inspect` / `impact` CLI commands still have implicit analyze via `loadOrAnalyzeWorkspace(...)` → Mitigation: document this change as MCP-specific, optionally follow with separate proposal for all read-only commands.
- [Test fragility] MCP tests may accidentally assert only connection success rather than tool semantics → Mitigation: assert missing-index tool responses, `.code-intel/` absence, and post-analyze auto-reload behavior.
- [Future drift] another startup path may reintroduce hidden analyze → Mitigation: keep command-boundary and tool-boundary tests around the `mcp` contract.

## Migration Plan

1. Update `code-intel mcp` startup branch to avoid both auto-analyze and startup failure for unindexed repos.
2. Add/adjust MCP tests for missing-index connection success, missing-index graph-tool responses, indexed startup cases, and post-analyze auto-reload behavior.
3. Update README/setup guidance to make `code-intel analyze && code-intel setup` the canonical first-run sequence for MCP-enabled repos while documenting the connected-but-unindexed behavior.
4. Ship in v1.0.8 with changelog/release note calling out the new MCP missing-index workflow.

Rollback:
- Revert the `mcp` command branch to the previous startup-failure policy or the earlier auto-analyze fallback.
- No data migration needed because this change only alters MCP startup and tool-time control flow.

## Open Questions

- None currently.
