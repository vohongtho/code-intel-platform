# Agent Integration Status

This page records what Code Intel 1.0.9 actually supports and what remains a product backlog. It intentionally separates MCP, instruction files, hooks/plugins, skills, and stale-index automation.

## Support matrix

| Client | MCP registration | Instruction file | Hook or plugin | Skills | Status in 1.0.9 |
|---|---|---|---|---|---|
| Claude Code | Manual/client CLI; setup writes a Claude Desktop-style config | `CLAUDE.md` | Global `PreToolUse` hook | No | Strong, but registration still needs verification |
| Codex | Manual/client CLI or TOML | `AGENTS.md` | No runtime hook | No | MCP + instructions |
| Cursor | Manual project/global config | `.cursor/rules/code-intel.mdc` | Global `preToolUse` hook | No | MCP + rule + hook |
| GitHub Copilot | Project `.vscode/mcp.json` | `.github/copilot-instructions.md` | Project hook JSON | No | MCP + instructions + project hook |
| Gemini CLI | Manual MCP config | Custom target or generated file | Global `BeforeTool` hook | No | Hook available; MCP adapter incomplete |
| Antigravity | Manual MCP config | `.agents/rules/code-intel-rules.md` | No dedicated runtime hook | No | Prompt-level integration |
| Cline / Roo Code | Manual MCP config | `.clinerules` | No runtime hook | No | MCP + prompt rules |
| Windsurf | Manual MCP config | `.windsurfrules` | No runtime hook | No | MCP + prompt rules |
| OpenCode | Manual config | Custom target | Global plugin when detected | No | MCP + plugin |
| OpenClaw | Not automatically registered | Custom target | Global extension when detected | No | Plugin only |
| Kilo Code | Manual MCP config | Setup writes `.kilocode/rules/...`; selected target handling differs | No runtime hook | No | Prompt-level integration |

## What Code Intel already does well

- A broad MCP tool set for repository understanding, change impact, quality, and security.
- Stable repository registry and multi-repository groups.
- Managed instruction blocks that preserve custom content.
- A lightweight `code-intel-hook` binary for low-latency command rewriting.
- Automatic hook/plugin installation for several clients.
- Change-context CLI, HTTP, and MCP transports for CI-oriented workflows.
- OpenSpec workflows documented alongside repository-intelligence workflows.

## Important gaps compared with GitNexus-style onboarding

### Generated skills

Code Intel generates instruction files, but it does not generate task skills such as:

- repository exploration;
- debugging;
- impact analysis;
- refactoring;
- architecture mapping;
- cluster-specific `SKILL.md` files.

Skills should be optional and generated from stable templates plus indexed cluster metadata.

### MCP prompt templates

The MCP server exposes tools and three resources, but no `prompts` capability. Useful built-in prompts would include:

- `analyze_change_request`;
- `detect_impact`;
- `review_pull_request`;
- `generate_architecture_map`;
- `prepare_openspec_change`;
- `verify_openspec_change`.

### Post-Git stale-index handling

Current hooks focus on rewriting shell discovery commands before execution. They do not detect successful `git commit`, `merge`, `rebase`, `cherry-pick`, or `pull` operations and then warn that the index may be stale.

### Fully verified setup automation

`code-intel init` and `code-intel setup` use partial editor detection, but they do not provide a complete per-client adapter with validation and rollback.

## Code issues found during this review

### 1. Unscoped npx command

The published package is:

```text
@vohongtho.infotech/code-intel
```

However, setup/init code generates `npx code-intel mcp .`. The npx fallback should use the scoped package and a pinned version, or use the absolute global executable.

Recommended form:

```bash
npx -y @vohongtho.infotech/code-intel@1.0.9 mcp /absolute/path/to/repository
```

### 2. Shared editor configuration schema

The init wizard writes one common `servers` structure for VS Code, Cursor, Windsurf, and Zed. These clients do not all use the same wrapper or file location. Each client needs a dedicated adapter.

### 3. Hardcoded MCP server version

The MCP server identifies itself as version `0.1.0` while the package is 1.0.9. The MCP server should load the package version at runtime.

### 4. README drift

The package README still contains an older version badge and older release-specific notes. It also describes incremental graph behavior that does not match the 1.0.9 correctness-first graph rebuild.

### 5. Support claims are too broad

“Supports client X” should be split into:

- MCP registration;
- generated instructions;
- runtime hook/plugin;
- skills;
- post-change stale-index detection.

### 6. CLI help and documentation drift

The main help table omits advanced and administrative commands. Previous guide content also listed nonexistent commands (`repo remove`, `group delete`). Documentation should be generated from command schemas or validated in CI.

### 7. Agent-target inconsistency

The selected-agent target for Kilo Code and the legacy context target use different paths. Consolidate the canonical target path and add a migration.

### 8. Token authentication ergonomics

When `CODE_INTEL_TOKEN` is enabled, every MCP tool requires `_token`. Many clients cannot inject a common tool argument automatically. Prefer transport-level environment/auth handling or document client-specific injection support.

## Recommended product backlog

### Priority 0 — correctness and trust

1. Replace unscoped npx commands with the real scoped package.
2. Add per-client setup adapters and integration tests.
3. Read MCP version metadata from `package.json`.
4. Correct README and generated documentation for 1.0.9 behavior.
5. Add CI checks that reject undocumented or nonexistent CLI commands.

### Priority 1 — onboarding parity

1. Add `code-intel setup --coding-agent <agents>`.
2. Add `code-intel setup --dry-run`.
3. Add `code-intel setup --verify` that launches the generated command and performs MCP initialize/list-tools/overview.
4. Add a support matrix to README and the CLI setup output.
5. Use absolute global executable paths when available.
6. Add Windows `cmd /c` generation where required.

### Priority 2 — agent experience

1. Add prebuilt exploration, debugging, impact, refactoring, PR-review, and OpenSpec skills.
2. Add optional cluster-generated skills.
3. Register MCP prompt templates.
4. Add post-Git stale-index hooks.
5. Add a standard `index_status` MCP tool or resource that every workflow calls first.

### Priority 3 — maintainability

1. Generate CLI reference from Commander and standalone-command definitions.
2. Generate MCP reference from `ListTools` and `ListResources` schemas.
3. Add snapshot tests for generated client configs.
4. Add end-to-end tests for every claimed client integration.
5. Keep docs versioned with release branches rather than patching older content.