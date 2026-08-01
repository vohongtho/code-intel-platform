# Code Intel 1.0.9 Runtime Verification Backlog

This file is intentionally **not loaded by the public guide**. It records implemented or source-reviewed functionality that must receive a passing runtime test before it can be documented as a supported user workflow.

## CLI and options to test later

### Setup and editor integration
- `code-intel setup`
- Claude Code, Codex, Cursor, VS Code/Copilot, Cline, Windsurf, OpenCode, OpenClaw, Gemini, Kilo Code, and Antigravity configuration behavior
- generated hooks, rules, and instruction files

### Analysis modes not covered by the certified baseline
- `analyze --incremental`
- `analyze --parallel`
- `analyze --embeddings`
- `analyze --skip-git`
- `analyze --skip-folders`
- `analyze --skip-files`
- `analyze --verbose`
- `analyze --summarize` and all LLM-provider options
- `analyze --dry-run`
- `analyze --max-memory`
- `analyze --profile`

### Server lifecycle
- `serve --force`
- `serve --detach`
- `code-intel stop`
- `code-intel watch`

### Repository mutations and destructive cleanup
- `repo rename`
- `repo relink`
- destructive `clean`
- `clean --purge`
- `clean --all --force`
- `clean --list-trash`

### Configuration and saved query operations
- `config get`
- `config set`
- `config list`
- `config reset`
- `config-validate`
- query from file
- saved-query create, run, list, and delete

### Change-review commands
- CLI `pr-impact`
- `change-context-mcp`
- `change-context-http`
- `index-status --upgrade-legacy`

### Repository-group operations
- `group remove`
- `group list`
- `group init-workspace`
- alternate group filters and dry-run options

### Administration and maintenance
- user management
- token management
- `auth login`, logout, and rotation
- OIDC
- backup create, list, and `backup restore`
- migration status, dry-run, and rollback
- `keystore set`, get, delete, list, and backend
- `code-intel update`
- `code-intel doctor`
- hidden `rewrite` and `hook` commands

## MCP scenarios to test later

All 31 MCP tools have one passing happy path. The following variants are not yet certified:

- vector and hybrid search modes
- pagination and alternate scopes
- token-authenticated MCP calls
- timeout overrides
- invalid-input and failure responses
- large repository behavior
- multi-language repositories beyond the TypeScript fixture
- concurrent calls
- external editor/client interoperability
- Windows, macOS, and WSL execution

## Other product areas to test before adding to the public guide

- full React Web UI workflow
- all HTTP API routes, authorization roles, and destructive endpoints
- WebSocket live updates
- embeddings/model downloads
- external LLM providers
- OpenSpec integration workflows
- backup encryption and restore compatibility
- release upgrade and migration workflows
