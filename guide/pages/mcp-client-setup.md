# MCP Client Setup

This page separates three integration layers that were previously mixed together:

1. **MCP registration** — lets the client call Code Intel tools.
2. **Instruction files** — tells the agent when and how to use those tools.
3. **Hooks or plugins** — rewrites shell discovery commands or adds automatic behavior.

## Before setup

```bash
npm install -g @vohongtho.infotech/code-intel@1.0.9
cd /absolute/path/to/repository
code-intel analyze --embeddings
code-intel status
which code-intel
```

Prefer the globally installed binary for fast MCP startup. A safe scoped npx fallback is:

```bash
npx -y @vohongtho.infotech/code-intel@1.0.9 mcp /absolute/path/to/repository
```

## What `code-intel setup` actually does

Run from the repository root:

```bash
code-intel setup
```

In 1.0.9 it performs these actions:

- prints a generic MCP configuration;
- attempts to merge a Claude configuration under `~/.config/claude/claude_desktop_config.json`;
- prints a VS Code project configuration example;
- installs a Claude Code `PreToolUse` hook;
- installs Cursor and Gemini hooks when their directories exist;
- writes a project GitHub Copilot hook;
- installs OpenCode and OpenClaw plugins when detected;
- writes prompt-level rules for Cline/Roo Code, Windsurf, Kilo Code, Antigravity, and Codex.

It does **not** fully and correctly register MCP for every supported client. Use the client-specific configuration below and verify it.

`code-intel setup --completion` only installs shell completion and exits.

## Claude Code

### MCP registration

```bash
claude mcp add --scope project code-intel -- code-intel mcp "$(pwd)"
claude mcp list
claude mcp get code-intel
```

Inside Claude Code:

```text
/mcp
```

Manual project configuration in `.mcp.json`:

```json
{
  "mcpServers": {
    "code-intel": {
      "type": "stdio",
      "command": "code-intel",
      "args": ["mcp", "/absolute/path/to/repository"]
    }
  }
}
```

### Hook and instructions

`code-intel setup` installs a global Claude Code `PreToolUse` hook using the lightweight `code-intel-hook claude` binary. It rewrites selected `grep`, `rg`, and `cat` discovery commands.

`code-intel analyze` can maintain a managed Code Intel block in `CLAUDE.md` when Claude is selected as an agent target.

## OpenAI Codex CLI and Codex app

### MCP registration

```bash
codex mcp add code-intel -- code-intel mcp "$(pwd)"
codex mcp list
```

Manual configuration in `~/.codex/config.toml` or project `.codex/config.toml`:

```toml
[mcp_servers.code-intel]
command = "code-intel"
args = ["mcp", "/absolute/path/to/repository"]
enabled = true
```

### Instructions

Code Intel does not install a Codex runtime hook in 1.0.9. It writes or appends policy to `AGENTS.md`, and analysis can maintain the managed Code Intel block when Codex is a selected target.

## Cursor

Project MCP configuration:

```json
{
  "mcpServers": {
    "code-intel": {
      "command": "code-intel",
      "args": ["mcp", "/absolute/path/to/repository"]
    }
  }
}
```

Store it in the MCP configuration location supported by the installed Cursor version. `code-intel setup` can install a global `preToolUse` hook under `~/.cursor/hooks.json` and analysis can generate `.cursor/rules/code-intel.mdc`.

## VS Code and GitHub Copilot

Project `.vscode/mcp.json`:

```json
{
  "servers": {
    "code-intel": {
      "type": "stdio",
      "command": "code-intel",
      "args": ["mcp", "/absolute/path/to/repository"]
    }
  }
}
```

`code-intel setup` also creates `.github/hooks/code-intel-rewrite.json` and analysis can generate `.github/copilot-instructions.md`.

## Cline and Roo Code

Add the local stdio server through the client MCP configuration:

```json
{
  "mcpServers": {
    "code-intel": {
      "command": "code-intel",
      "args": ["mcp", "/absolute/path/to/repository"],
      "disabled": false
    }
  }
}
```

`code-intel setup` writes prompt-level policy to `.clinerules`. There is no programmatic Cline/Roo hook in 1.0.9.

## Windsurf

Add a local stdio MCP server through Windsurf settings:

```json
{
  "mcpServers": {
    "code-intel": {
      "command": "code-intel",
      "args": ["mcp", "/absolute/path/to/repository"]
    }
  }
}
```

`code-intel setup` writes `.windsurfrules`. There is no Windsurf runtime hook in 1.0.9.

## OpenCode

```json
{
  "mcp": {
    "code-intel": {
      "type": "local",
      "command": ["code-intel", "mcp", "/absolute/path/to/repository"],
      "enabled": true
    }
  }
}
```

When `~/.config/opencode` exists, `code-intel setup` installs `~/.config/opencode/plugins/code-intel.ts`. The plugin rewrites selected shell discovery commands.

## Gemini CLI and Antigravity

Use a local stdio MCP server with the configuration schema supported by the installed Gemini or Antigravity version. `code-intel setup` installs a Gemini `BeforeTool` hook when `~/.gemini` exists. Antigravity receives prompt-level rules under `.agents/rules/code-intel-rules.md`; it does not receive a dedicated Antigravity MCP registration adapter in 1.0.9.

## Generic MCP client

```json
{
  "name": "code-intel",
  "transport": "stdio",
  "command": "code-intel",
  "args": ["mcp", "/absolute/path/to/repository"]
}
```

The client must keep stdin and stdout attached to the process for the complete session.

## Windows and WSL

Run Code Intel and the AI client inside the same WSL distribution when possible. When a native Windows client launches an npm command, a wrapper may be required:

```text
command: cmd
args: ["/c", "npx", "-y", "@vohongtho.infotech/code-intel@1.0.9", "mcp", "C:\\absolute\\repo"]
```

Do not mix Windows paths and WSL paths in one server definition.

## Verify every client setup

1. Run `code-intel index-status .` and `code-intel status`.
2. Confirm the client lists `code-intel` as connected.
3. Call `overview` and verify expected file/node counts.
4. Search for a known symbol.
5. Call `inspect` and `blast_radius`.
6. Restart the client and repeat one call.
7. After a Git commit, confirm the index is still current; 1.0.9 does not automatically add a post-commit stale-index hook.

## Recommended first prompt

```text
Use Code Intel MCP as the primary repository-intelligence source.
Start with overview, then search and inspect relevant symbols.
Use find_path or explain_relationship when connections are unclear.
Run blast_radius before edits.
After implementation, run detect_changes or pr_impact and suggest_tests.
Do not begin with broad recursive file reading unless Code Intel cannot resolve the target.
```

## Troubleshooting

### Command not found

Use the absolute path returned by `which code-intel` as the MCP command.

### Wrong repository

Use a fixed absolute repository path rather than relying on the client working directory.

### Empty tools or data

```bash
cd /absolute/path/to/repository
code-intel index-status .
code-intel analyze --embeddings
code-intel status
```

### Connection closes immediately

Run the exact server command in a terminal:

```bash
code-intel mcp /absolute/path/to/repository
```

Check `~/.code-intel/logs/` and ensure no normal output is written to MCP stdout.