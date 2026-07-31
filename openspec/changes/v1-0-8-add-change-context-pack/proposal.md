# Proposal: Add a One-Call Change Context Pack

## Intent

Give coding agents one deterministic, trust-aware, token-bounded API for understanding a source change before implementation or review.

## Why

Version 1.0.7 exposes useful but disconnected tools: `detect_changes`, `pr_impact`, `suggest_tests`, and `context`. A coding agent must call several tools, merge overlapping results, repeat graph traversals, and independently manage token limits. The current diff parser is embedded in the MCP server and recognizes only a subset of unified diff paths.

## What changes

### Shared diff and change mapping

Add reusable modules for parsing unified diffs, collecting working-tree changes, mapping changed ranges to indexed symbols, retaining file-level fallback, and diagnosing unindexed files and stale index state.

### Shared impact analysis

Refactor PR impact to start from changed symbols and file fallbacks, then return direct symbols, transitive callers/importers, risk, routes, flows, clusters/modules, contract impact where available, and files to review.

### Batch test recommendations

Reuse and batch `suggestTests()` for the highest-risk changed symbols while deduplicating existing tests and recommendations.

### Token-bounded context package

Select deterministic seed symbols and build context through the strict context builder. The complete package reports token use and truncation.

### New public interfaces

- MCP tool `change_context`.
- CLI command `code-intel changes context`.
- HTTP endpoint `POST /api/v1/changes/context`.

Existing `detect_changes` and `pr_impact` remain and delegate to the shared implementation.

## Compatibility

Existing legacy tools and parameter names remain. New outputs are additive. The tool does not modify source code, execute tests, or claim a trusted verdict for corrupted or rebuild-required indexes.

## Dependencies

- Index status and workspace-change model from `v1-0-8-stabilize-incremental-index`.
- Strict context budget and shared search/context types from `v1-0-8-trusted-retrieval-contracts`.

## Non-goals

- Generating or applying source patches.
- Running tests.
- Creating OpenSpec artifacts automatically.
- Full semantic analysis of arbitrary binary files.
- Cross-repo Git operations.

## Success measures

- One MCP request returns trust, changes, impact, tests, and context.
- The same input and generation produce deterministic output.
- Legacy tools produce compatible results through shared modules.
- The complete package stays within its declared budget.
- New, deleted, renamed, and untracked files produce explicit diagnostics.
