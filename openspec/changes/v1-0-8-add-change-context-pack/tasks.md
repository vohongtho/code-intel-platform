# Tasks

- [ ] Extract shared unified-diff parsing from the MCP server switch.
- [ ] Add a shared change-context service that combines changed files, changed symbols, blast radius and suggested tests.
- [ ] Add the `change_context` MCP tool with compact default output.
- [ ] Add HTTP and CLI transports using the same service.
- [ ] Add deterministic tests for raw diff, base ref, staged, unstaged and empty-change cases.
- [ ] Enforce the context token budget on generated change packs.
- [ ] Document compatibility with `detect_changes`, `pr_impact` and `suggest_tests`.

> Status: not implemented in this session. Existing change analysis remains embedded in `mcp-server/server.ts`; extracting it safely requires a shared service and transport contract tests.
