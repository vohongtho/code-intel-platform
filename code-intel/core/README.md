# Code Intelligence Platform

[![npm version](https://img.shields.io/badge/npm-v0.9.0-blue)](https://www.npmjs.com/package/@vohongtho.infotech/code-intel)

A static code analysis platform that builds a **Knowledge Graph** from your source code and makes it explorable through a Web UI, HTTP API, CLI, and MCP server.

![Code Intelligence Platform](screenshots/explorer-overview.png)

---

## ✨ Features

- **Knowledge Graph** — parses 14+ languages into nodes (functions, classes, files, etc.) and edges (calls, imports, extends, etc.)
- **Force-directed Graph Explorer** — interactive Sigma.js visualization with color-coded node types, hover highlighting, and filters
- **Graph Query Language (GQL)** — query your codebase with `FIND`, `TRAVERSE`, `PATH`, `COUNT GROUP BY`; CLI, HTTP API, and MCP tool
- **Source Code Preview** — click any node to open syntax-highlighted source at the exact line; "Open in editor" (`vscode://`) button
- **Query Console** — web UI panel with GQL editor, sortable results table, query history, and example queries
- **AI-Generated Symbol Summaries** — optional `--summarize` flag generates 1-2 sentence summaries per symbol via OpenAI, Anthropic, or Ollama; cached by code hash
- **Hybrid Search (BM25 + Vector RRF)** — Reciprocal Rank Fusion of keyword + semantic search; `searchMode: 'bm25' | 'vector' | 'hybrid'` in response
- **Semantic Vector Search** — embeddings via `all-MiniLM-L6-v2`; enriched with summaries when available
- **Code AI Chat** — grounded assistant that cites source files in every answer
- **File Watcher & Auto-Reindex** — `code-intel watch` detects file saves and patches the live graph within ~1 second; WebSocket push notifies connected clients
- **Code Health** — `code-intel health` reports dead code, circular dependencies (Tarjan SCC), god nodes, orphan files, and a 0–100 health score
- **HTTP API** — REST endpoints for graph, search, inspect, blast radius, flows, query, source, health
- **MCP Server** — Model Context Protocol integration for LLM tooling with 6 new reasoning tools (`explain_relationship`, `pr_impact`, `similar_symbols`, `health_report`, `suggest_tests`, `cluster_summary`), pagination, and tool-chaining hints
- **Security & Quality Scanning** — `code-intel secrets` (hardcoded API keys, DB URLs, RSA keys), `code-intel scan` (SQL Injection CWE-89, XSS CWE-79, SSRF CWE-918, Path Traversal CWE-22, Command Injection CWE-78), `--format sarif` for CI integration
- **Complexity Metrics** — `code-intel complexity --top N` ranks functions by cyclomatic + cognitive complexity; `complexity_hotspots` MCP tool
- **Test Coverage Gaps** — `code-intel coverage` lists untested exported symbols sorted by blast radius; `--threshold <pct>` fails CI if below target
- **Deprecated API Detection** — `code-intel deprecated` finds usages of `@deprecated` JSDoc, `@Deprecated` (Java), `#[deprecated]` (Rust), and built-in Node.js deprecated APIs
- **AI Context Files** — auto-generates `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.cursor/rules/code-intel.mdc`, and `.kiro/steering/code-intel.md` after every analysis — supporting Amp, Claude Code, Codex, Copilot, Cursor, Aider, Gemini, Kiro, Trae, Hermes, Factory, OpenCode, Pi, Antigravity, OpenClaw, and more
- **Multi-language** — TypeScript, JavaScript, Python, Java, Go, C, C++, C#, Rust, PHP, Ruby, Swift, Kotlin, Dart (14 languages via tree-sitter AST)
- **Incremental Analysis** — `--incremental` re-parses only changed files; 10k-file repo / 3 changes: 288ms
- **Parallel Analysis** — `--parallel` runs parse + resolve phases on worker threads for large repos
- **Structured Logging** — winston-based logger with daily-rotating log files, sensitive-data masking, and configurable log levels
- **`code-intel init` Wizard** _(v0.9)_ — interactive 5-step setup wizard; creates `~/.code-intel/config.json`
- **Config Management CLI** _(v0.9)_ — `config get/set/list/validate/reset` with JSON Schema, `$ENV_VAR` expansion, masked secrets
- **Better Error Messages** _(v0.9)_ — `CI-XXXX` codes, actionable hints, `--debug` stack traces, startup prerequisite checks
- **Shell Completion** _(v0.9)_ — `code-intel completion bash|zsh|fish`; `setup --completion` auto-installs
- **VS Code Extension** _(v0.9)_ — symbol hover, Symbol Explorer panel, status bar, command palette, go-to-definition from graph
- **Self-Update** _(v0.9)_ — `code-intel update`; background version check; `--no-update-check` to suppress
- **`--dry-run` flag** _(v0.9)_ — `analyze`, `clean`, `group sync` preview without side effects
- **`code-intel doctor`** _(v0.9)_ — full diagnostics: Node.js, git, config, registry, DB integrity, network

---

## 🚀 Quick Start

### Install from npm _(recommended)_

```bash
npm install -g @vohongtho.infotech/code-intel
```

> **Note:** You may see `npm warn ERESOLVE overriding peer dependency` warnings about `tree-sitter`. These are **harmless** — they relate to the native Node.js bindings which are not used. The CLI uses `web-tree-sitter` (WASM) exclusively. If you prefer a warning-free install, use:
> ```bash
> npm install -g @vohongtho.infotech/code-intel --legacy-peer-deps
> ```

The `code-intel` binary is placed in your `$PATH` automatically (via the `bin` field in `package.json`).

Verify:

```bash
code-intel --version
```

### Build from source

```bash
npm install --legacy-peer-deps
npm run build
```

---

## 🖥️ Web UI

| Panel | Description |
|-------|-------------|
| **Explorer** | Graph composition stats, search results, overview counters |
| **Filters** | Toggle node/edge types, set focus depth |
| **Files** | Recursive file tree with search filter and file icons |
| **Graph Canvas** | Force-directed graph, click nodes to inspect, hover to highlight neighbors |
| **Source Preview** | Syntax-highlighted source code at the exact symbol line; resizable panel; "Open in editor" button |
| **Query Console** | GQL editor with keyword highlighting, run button (`Ctrl+Enter`), sortable results table, query history |
| **Code AI** | Chat with grounded answers citing source file locations |

### Search Modes

- **Keyword** (default) — BM25-like text search across node names and content
- **⚡ vec** — Semantic vector search using embeddings (auto-built in background after server starts)

Toggle between modes using the `vec` button in the header search bar.

---

## 📦 Architecture

```
code-intel-platform/
├── code-intel/
│   ├── shared/       # Shared types: CodeNode, CodeEdge, NodeKind, EdgeKind, Language
│   ├── core/         # Backend: pipeline, parser, HTTP API, MCP, CLI, storage
│   │   └── src/
│   │       ├── pipeline/      # 6-phase DAG: scan→structure→parse→resolve→cluster→flow
│   │       ├── languages/     # 14 language modules (tree-sitter queries)
│   │       ├── graph/         # In-memory knowledge graph with O(1) lookup
│   │       ├── search/        # BM25 text search + vector embeddings
│   │       ├── storage/       # LadybugDB persistence, repo registry
│   │       ├── http/          # Express REST API + static web UI serving
│   │       ├── mcp-server/    # MCP stdio transport
│   │       ├── multi-repo/    # Group registry, group sync, cross-repo query
│   │       ├── shared/        # Logger, language detection utilities
│   │       └── cli/           # Commander CLI (progress bars, spinners)
│   └── web/          # React + Sigma.js frontend
│       └── src/
│           ├── components/    # GraphView, NodeDetail, SidebarChat, SidebarFiles, Filters
│           ├── ai/            # Agent with intent parsing + tool calls
│           ├── api/           # ApiClient (search, vector-search, inspect, blast-radius)
│           ├── graph/         # Colors palette, layout utilities
│           └── state/         # React context + reducer
└── .code-intel/      # Generated per-repo: graph.db, vector.db, meta.json
```

### Pipeline Phases

| Phase | Description |
|-------|-------------|
| `scan` | Walk filesystem, collect source files (parallel batch I/O), ignore `node_modules`, `dist`, large files, etc. |
| `structure` | Create file and directory nodes in the graph |
| `parse` | Read files in parallel batches of 64, extract symbols (functions, classes, etc.), build per-file function index |
| `resolve` | Resolve imports → edges, build call graph (O(log n) lookup), detect heritage (extends/implements) |
| `cluster` | Directory-based community detection, add cluster nodes |
| `flow` | Detect entry points, trace execution flows |
| `summarize` | _(opt-in)_ Generate 1–2 sentence AI summaries via OpenAI, Anthropic, or Ollama; skips unchanged nodes |

Each phase reports live progress to the CLI via animated `█░` progress bars.

---

## 🖥️ CLI Progress Display

When running `code-intel analyze`, each pipeline phase shows a real-time progress bar:

```
  [parse    ] ████████████████░░░░░░░░░░░░░░  53% (80/151)
```

Post-pipeline steps (DB persist, skill generation, context files) show a braille spinner:

```
  ⠹ Persisting graph to DB…
```

---

## 📋 Logging

Logs are written to **`~/.code-intel/logs/`** using daily rotation:

| Setting | Default | Override |
|---------|---------|----------|
| Log directory | `~/.code-intel/logs/` | — |
| Log file pattern | `YYYY-MM-DD-code-intel.log` | — |
| Max file size | 20 MB | — |
| Retention | 14 days | — |
| Log level | `info` | `LOG_LEVEL=debug\|info\|warn\|error\|silent` |
| Production mode | Console only | `NODE_ENV=production` |

Sensitive data (passwords, tokens, API keys, emails, etc.) is automatically masked before writing.

---

## 🛠️ CLI Commands

```bash
code-intel analyze [path]          # Analyze and persist graph
code-intel analyze --incremental   # Re-parse only changed files (git diff / mtime)
code-intel analyze --parallel      # Use worker threads (faster on multi-core)
code-intel analyze --summarize     # Generate AI summaries after analysis
code-intel analyze --skills        # Emit per-cluster SKILL.md files
code-intel serve [path] -p 4747    # Analyze + start HTTP server
code-intel watch [path] -p 4747    # HTTP server + file watcher (auto-reindex on save)
code-intel mcp [path]              # Start MCP server (stdio)
code-intel setup                   # Register MCP server in editor config (one-time)
code-intel query "<gql>"           # Run a GQL query (FIND / TRAVERSE / PATH / COUNT GROUP BY)
code-intel query "<gql>" --format table|json|csv
code-intel query --save <name> "<gql>"   # Save a named query
code-intel query --run <name>            # Run a saved query
code-intel query --list                  # List saved queries
code-intel health [path]           # Code health: dead code, cycles, god nodes, orphans, score
code-intel health --dead-code      # List dead-code symbols
code-intel health --cycles         # List circular dependency cycles
code-intel health --json           # Machine-readable output
code-intel search <query>          # Text search
code-intel inspect <symbol>        # Inspect a symbol
code-intel impact <symbol>         # Blast radius analysis
code-intel list                    # List indexed repos
code-intel status [path]           # Show index status
code-intel clean [path]            # Remove index data
```

---

## 🌐 HTTP API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/v1/health` | Server status, graph size, watcher state |
| `GET`  | `/api/v1/repos` | List indexed repos |
| `GET`  | `/api/v1/graph/:repo` | Full graph (nodes + edges) |
| `POST` | `/api/v1/search` | BM25 / hybrid text + vector search |
| `POST` | `/api/v1/vector-search` | Semantic vector search |
| `GET`  | `/api/v1/vector-status` | Vector index ready/building status |
| `GET`  | `/api/v1/nodes/:id` | Node detail (callers, callees, imports, etc.) |
| `POST` | `/api/v1/blast-radius` | Impact analysis |
| `POST` | `/api/v1/query` | Execute GQL query; 408 on timeout with partial results |
| `POST` | `/api/v1/query/explain` | Return query plan without executing |
| `GET`  | `/api/v1/source` | File content with ±20 lines context; path-traversal protected |
| `POST` | `/api/v1/grep` | Regex search in file content |
| `GET`  | `/api/v1/flows` | List detected flows |
| `GET`  | `/api/v1/clusters` | List clusters |
| `GET`  | `/api/v1/openapi.json` | OpenAPI 3.1 spec |

---

## 🤖 MCP Server Tools

| Tool | Description |
|------|-------------|
| `repos` | List all indexed repositories |
| `overview` | Repository summary: total nodes/edges + full breakdown by kind |
| `search` | BM25 / hybrid keyword + semantic search across all symbols |
| `inspect` | 360° view of a symbol: definition, callers, callees, imports, heritage, members, cluster |
| `blast_radius` | Impact analysis: traverse call/import graph to find all affected symbols |
| `file_symbols` | List all symbols defined in a file, ordered by line number |
| `find_path` | Shortest call/import path between two symbols via BFS |
| `list_exports` | List all exported symbols — the public API surface of the codebase |
| `routes` | List all HTTP route handler mappings detected in the codebase |
| `clusters` | List detected code clusters with member counts and top symbols |
| `flows` | List detected execution flows with entry points and steps |
| `query` | Execute a GQL query (`FIND`, `TRAVERSE`, `PATH`, `COUNT GROUP BY`); returns nodes/edges/groups + executionTimeMs |
| `detect_changes` | Git-diff impact analysis: maps changed lines to graph symbols |
| `raw_query` | _(deprecated — use `query`)_ Simplified Cypher-like graph query |
| `group_list` | List all configured repository groups |
| `group_sync` | Extract contracts and detect cross-repo provider→consumer links |
| `group_contracts` | Inspect extracted contracts and confidence-ranked cross-repo links |
| `group_query` | BM25 search across all repos in a group merged via RRF |
| `group_status` | Check index freshness and sync staleness for all group members |

---

## 🔬 Node Type Color Palette

| Type | Color | Hex |
|------|-------|-----|
| Function | 🩵 Cyan | `#22D3EE` |
| File | 🟠 Orange | `#FB923C` |
| Class | 🟢 Green | `#4ADE80` |
| Interface | 🟣 Purple | `#A78BFA` |
| Enum | 🔷 Indigo | `#6366F1` |
| Constant | 🟡 Yellow | `#FACC15` |
| Type Alias | 🔴 Pink | `#FB7185` |
| Flow | 🩵 Teal | `#14B8A6` |
| Method | 💙 Sky Blue | `#38BDF8` |
| Module | 🪻 Fuchsia | `#E879F9` |
| Route | 🔴 Red | `#F87171` |
| Cluster | ⬜ Slate | `#64748B` |

---

## 🧪 Testing

```bash
npm run test
```

46+ tests across unit + integration suites covering:
- Knowledge graph operations
- Language detection
- Call classifier
- MRO computation
- Scope analysis
- Text search
- Pipeline integration (parse → resolve)
- Parser corpus golden-file regression (10 languages, 100% recall)
- Tree-sitter query correctness (Swift, Kotlin, Dart)

---

## 📋 Requirements

- **Node.js** 22+
- **npm** 10+

---

## 📄 License

MIT © 2024
