# Code Intelligence Platform

[![npm version](https://img.shields.io/badge/npm-v1.0.1-blue)](https://www.npmjs.com/package/@vohongtho.infotech/code-intel)

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
- **CLI** — analyze, serve, watch, query, search, inspect, impact, health commands with animated `█░` progress bars and braille spinners
- **Multi-language** — TypeScript, JavaScript, Python, Java, Go, C, C++, C#, Rust, PHP, Ruby, Swift, Kotlin, Dart (14 languages via tree-sitter AST)
- **Incremental Analysis** — `--incremental` flag re-parses only git-changed/mtime-changed files; 10k-file repo with 3 changes: 288ms
- **Parallel Analysis** — `--parallel` flag runs parse + resolve phases on worker threads for large repos
- **AI Context Files** — auto-generates `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.cursor/rules/code-intel.mdc`, `.kiro/steering/code-intel.md`, `.clinerules`, `.windsurfrules`, `.kilocode/rules/code-intel-rules.md`, and `.agents/rules/code-intel-rules.md` after every analysis — supporting Amp, Claude Code, Codex, Copilot, Cursor, Aider, Gemini, Kiro, Trae, Hermes, Factory, OpenCode, Pi, Antigravity, OpenClaw, Cline, Windsurf, Kilo Code, and more
- **Agent Hook System** _(v1.0.2)_ — `code-intel setup` installs PreToolUse hooks for all major AI agents; when an agent runs `grep MyClass src/`, the `code-intel-hook` binary (~10KB, ~50ms startup) silently rewrites it to `code-intel search "MyClass"` — saving ~3,000 tokens per lookup; supports Claude Code, Cursor, Gemini CLI, GitHub Copilot (VS Code + CLI), OpenCode, OpenClaw; rules files for Cline/Roo Code, Windsurf, Kilo Code, Antigravity, Codex CLI
- **Skill Files** — generates `.claude/skills/code-intel/` with per-cluster SKILL.md files (hot symbols, entry points, impact guidance) for AI assistants
- **Repository Groups** — multi-repo / monorepo service tracking with workspace auto-discovery (npm, pnpm, Nx, Turborepo), contract extraction (OpenAPI, GraphQL, Protobuf), type-aware similarity scoring, and cross-repo dependency detection
- **`.codeintelignore`** — exclude directories from analysis (like `.gitignore` but for code-intel)
- **Structured Logging** — winston-based logger with daily-rotating log files at `~/.code-intel/logs/`, sensitive-data masking, and configurable log levels
- **Performance** — parallel batch file I/O, shared file cache (zero double-reads), O(log n) binary-search enclosing-function lookup
- **`code-intel init` Wizard** _(v0.9)_ — interactive 5-step setup wizard; creates `~/.code-intel/config.json` with editor MCP registration, LLM provider, embeddings, auth mode, and port settings
- **Config Management CLI** _(v0.9)_ — `config get/set/list/validate/reset` with JSON Schema, `$ENV_VAR` expansion, and masked secret output
- **Better Error Messages** _(v0.9)_ — `CI-XXXX` error codes, actionable hints, `--debug` stack traces, startup prerequisite checks
- **Shell Completion** _(v0.9)_ — `code-intel completion bash|zsh|fish`; dynamic repo + group name completion; `setup --completion` auto-installs
- **VS Code Extension** _(v0.9)_ — symbol hover tooltips, Symbol Explorer panel, status bar freshness indicator, "Open in Graph" command, command palette integration
- **Self-Update** _(v0.9)_ — `code-intel update` checks npm registry; background version check on startup; `--no-update-check` to suppress
- **`--dry-run` flag** _(v0.9)_ — `analyze`, `clean`, `group sync` preview what would happen without side effects
- **`code-intel doctor`** _(v0.9)_ — full diagnostics: Node.js, git, config, registry, DB integrity, network; exit 1 on any failure
- **Lazy Graph Loading** _(v1.0)_ — `serve` starts in <2s for 10k-file repos; LRU node cache (5,000 nodes by default, `GRAPH_CACHE_SIZE` env var); background warm of high-blast-radius nodes
- **Pre-Built BM25 Index** _(v1.0)_ — inverted index built at analysis time; loaded into memory on `serve` startup; 2,000+ q/s throughput; incremental-only updates on re-index
- **Memory-Efficient Graph** _(v1.0)_ — `Int32Array`-packed adjacency + symbol interning = ≥30% memory reduction; `--max-memory <MB>` flag spills node content to DB
- **Pipeline Profiling** _(v1.0)_ — `analyze --profile` writes `.code-intel/profile.json`; per-phase heap memory captured; bottleneck warning if any phase >50% of total; verbose timing table
- **Load & Soak Tests** _(v1.0)_ — nightly CI load tests (1k/10k fixture repos), weekly soak tests (memory stability, watcher throughput), regression gate: >20% regression fails CI; `tests/perf/baseline.json` committed to repo
- **Graceful Degradation** _(v1.0)_ — `X-Stale`/`X-Stale-Since` headers on DB outage; LLM-unavailable summarize skip; MCP tool timeout → `{ truncated: true }`; watcher crash recovery; worker crash retry
- **Token-Efficient MCP** _(v1.0.1)_ — compact JSON responses (null/undefined stripped); MCP tool defaults tuned for LLM sessions: `search`/`file_symbols`/`list_exports` default 10 results (was 50), `blast_radius`/`pr_impact` default 2 hops (was 5); `suggested_next_tools` opt-in via `CODE_INTEL_SUGGEST_NEXT_TOOLS=true`; ~63% fewer tokens per typical 5-tool session
- **Context Builder** _(v1.0.1)_ — `src/context/builder.ts` builds structured `[SUMMARY]` / `[LOGIC]` / `[RELATION]` / `[FOCUS CODE]` documents from seed symbols in ≤50% of v1.0.0 token cost; query-intent presets (`code`, `callers`, `architecture`, `auto`); adaptive snippets; cross-block dedup; `code-intel context <symbols...> --show-context`
- **Enforced Tool Policy in AI Context Files** _(v1.0.1)_ — `AGENTS.md`/`CLAUDE.md`/`copilot-instructions.md`/`.cursor/rules`/`.kiro/steering` now include a `TOOL POLICY: ENFORCED` block forbidding raw `grep`/`find`/`cat` in favour of `code-intel search` → `inspect` → `impact`; saves ~3,000 tokens per cold-file lookup

---

## 🚀 Quick Start

### Requirements

- **Node.js** 22+
- **npm** 10+

---

### Option A — Install globally from npm _(recommended)_

```bash
npm install -g @vohongtho.infotech/code-intel
```

> **Note:** You may see `npm warn ERESOLVE overriding peer dependency` warnings about `tree-sitter`. These are **harmless** — they relate to native Node.js bindings that are not used; the CLI uses `web-tree-sitter` (WASM) exclusively. For a warning-free install, add `--legacy-peer-deps`.

Verify the installation:

```bash
code-intel --version
```

---

### Option B — Build from source

Use this if you want to develop, modify, or contribute to the platform.

**1. Clone the repository**

```bash
git clone https://github.com/vohongtho/code-intel-platform.git
cd code-intel-platform
```

**2. Install all workspace dependencies**

```bash
npm install --legacy-peer-deps
```

**3. Build all packages** (shared → core → web)

```bash
npm run build
```

This runs `tsup` for the core package (outputs to `code-intel/core/dist/`) and `vite` for the web UI (outputs to `code-intel/web/dist/`).

**4. Install the built CLI globally**

```bash
npm install -g ./code-intel/core
```

Verify:

```bash
code-intel --version
```

> **Tip:** After making code changes, re-run `npm run build` — the CLI picks up the new build automatically since the global install points to the local `dist/` folder.

---

### Option C — Build locally & install globally _(CI / automation)_

Use this approach in CI pipelines, Docker images, or any environment where you need a clean, self-contained global install from local source without a persistent `node_modules` link.

**1. Clone & install dependencies**

```bash
git clone https://github.com/vohongtho/code-intel-platform.git
cd code-intel-platform
npm install --legacy-peer-deps
```

**2. Build all packages**

```bash
npm run build
```

**3. Pack the core package into a tarball**

```bash
cd code-intel/core
npm pack
# produces: vohongtho.infotech-code-intel-0.1.4.tgz (version number may vary)
cd ../..
```

**4. Install the tarball globally**

```bash
npm install -g code-intel/core/vohongtho.infotech-code-intel-*.tgz
```

**5. Verify**

```bash
code-intel --version
```

#### One-liner (copy-paste for CI scripts)

```bash
git clone https://github.com/vohongtho/code-intel-platform.git && \
  cd code-intel-platform && \
  npm install --legacy-peer-deps && \
  npm run build && \
  npm pack --workspace=code-intel/core && \
  npm install -g vohongtho.infotech-code-intel-*.tgz
```

#### Docker example

```dockerfile
FROM node:22-bookworm-slim

RUN git clone https://github.com/vohongtho/code-intel-platform.git /opt/code-intel && \
    cd /opt/code-intel && \
    npm install --legacy-peer-deps && \
    npm run build && \
    npm pack --workspace=code-intel/core && \
    npm install -g vohongtho.infotech-code-intel-*.tgz && \
    rm -rf /opt/code-intel

WORKDIR /workspace
ENTRYPOINT ["code-intel"]
```

> **Why pack instead of `npm install -g ./code-intel/core`?**
> `npm pack` produces a standalone tarball containing only the published `files` (the `dist/` folder + `package.json`). This mirrors exactly what is published to npm and avoids bringing in dev symlinks or workspace hoisting artefacts.

---

### Analyze & Serve

```bash
# First, analyze the project to build the index
code-intel analyze

# Then start the server (requires an existing index)
code-intel serve

# Or with a specific path and port
code-intel analyze ./my-project
code-intel serve ./my-project --port 4747
```

Then open **http://localhost:4747** in your browser — the Web UI auto-connects and loads the graph.

### After analysis

`code-intel analyze` automatically generates or updates:
- **`AGENTS.md`** + **`CLAUDE.md`** — AI context files with stats, CLI reference, and skill links. These files are managed with **surgical precision**:
  - **File does not exist** → created from a template with a managed block and a clearly marked section for your own notes
  - **File exists with markers** → only the `<!-- code-intel:start -->…<!-- code-intel:end -->` block is updated; all your custom content is preserved untouched
  - **File exists without markers** → the block is appended at the end; existing content is never overwritten
- **`.claude/skills/code-intel/`** — per-cluster SKILL.md files with hot symbols, entry points, and impact guidance

### Exclude directories

Create a `.codeintelignore` file in your project root:

```
# one directory name per line
vendor
generated
fixtures
```

---

## 🤖 MCP Setup (one-time)

Run the one-time setup command to configure the MCP server and install agent hooks:

```bash
code-intel setup
```

This does two things:

**1. MCP server** — writes `~/.config/claude/claude_desktop_config.json` so your editor can start the MCP server automatically:

```json
{
  "mcpServers": {
    "code-intel": {
      "command": "npx",
      "args": ["@vohongtho.infotech/code-intel", "mcp", "."]
    }
  }
}
```

**2. Agent hooks** — installs PreToolUse hooks for every supported AI agent (idempotent, always safe to re-run):

| Agent | Hook type | What it does |
|-------|-----------|--------------|
| **Claude Code** | `~/.claude/settings.json` PreToolUse | Auto-rewrites grep/cat → code-intel search/inspect |
| **Cursor** | `~/.cursor/hooks.json` preToolUse | Auto-rewrites grep/cat → code-intel search/inspect |
| **Gemini CLI** | `~/.gemini/settings.json` BeforeTool | Auto-rewrites grep/cat → code-intel search/inspect |
| **GitHub Copilot** | `.github/hooks/code-intel-rewrite.json` | VS Code Chat: transparent rewrite; CLI: deny + suggestion |
| **OpenCode** | `~/.config/opencode/plugins/code-intel.ts` | Plugin: intercepts before tool execution |
| **OpenClaw** | `~/.openclaw/extensions/code-intel/` | Plugin: `before_tool_call` intercept |
| **Cline / Roo Code** | `.clinerules` | Prompt-level policy (also written by `analyze`) |
| **Windsurf** | `.windsurfrules` | Prompt-level policy (also written by `analyze`) |
| **Kilo Code** | `.kilocode/rules/code-intel-rules.md` | Prompt-level policy (also written by `analyze`) |
| **Antigravity** | `.agents/rules/code-intel-rules.md` | Prompt-level policy (also written by `analyze`) |
| **Codex CLI** | `AGENTS.md` (appended) | Prompt-level policy (also written by `analyze`) |

> **How hooks work:** The `code-intel-hook` binary (~10KB, ~50ms startup) intercepts every Bash tool call. When the agent tries to run `grep MyClass src/`, the hook silently rewrites it to `code-intel search "MyClass"` — saving ~3,000 tokens per lookup and returning structured graph results instead of raw text.

After setup, the MCP server starts automatically when your AI editor launches, giving it direct access to all code-intel tools.

---

## 🖥️ Web UI

| Panel | Description |
|-------|-------------|
| **Explorer** | Graph composition stats, search results, overview counters |
| **Filters** | Toggle node/edge types, set focus depth |
| **Files** | Recursive file tree with search filter and file icons |
| **Group** | Multi-repo group view with contracts and cross-repo links (visible when in group mode) |
| **Graph Canvas** | Force-directed graph, click nodes to inspect, hover to highlight neighbors |
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
│   ├── shared/                    # Shared types published alongside core
│   │   └── src/
│   │       ├── graph-types.ts     # CodeNode, CodeEdge, NodeKind, EdgeKind
│   │       ├── languages.ts       # Language enum (14 languages)
│   │       ├── pipeline-types.ts  # PipelineContext, PhaseResult
│   │       └── detection.ts       # Language detection helpers
│   │
│   ├── core/                      # Backend: pipeline, parsers, HTTP API, MCP, CLI, storage
│   │   └── src/
│   │       ├── pipeline/          # 6-phase DAG orchestrator + DAG validator
│   │       │   └── phases/        # scan · structure · parse · resolve · cluster · flow
│   │       │
│   │       ├── parsing/           # Tree-sitter AST parsing layer
│   │       │   ├── parser-manager.ts   # Loads + caches tree-sitter parsers
│   │       │   ├── ast-cache.ts        # AST memoization
│   │       │   ├── query-runner.ts     # Executes tree-sitter queries
│   │       │   └── queries/            # Per-language query files (14 languages)
│   │       │
│   │       ├── languages/         # Language registry + per-language extraction modules
│   │       │   ├── registry.ts         # Maps file extension → language module
│   │       │   └── modules/            # ts · js · py · java · go · rs · c · cpp · cs
│   │       │                           # php · kt · rb · swift · dart
│   │       │
│   │       ├── resolver/          # Import resolution (edges between files/symbols)
│   │       │   ├── import-resolver.ts
│   │       │   ├── binding-tracker.ts
│   │       │   └── strategies/    # relative-path · package-lookup · namespace-alias · wildcard-expand
│   │       │
│   │       ├── call-graph/        # Call edge builder + call classifier
│   │       ├── inheritance/       # Heritage builder, MRO walker, override detector
│   │       ├── scope-analysis/    # Scope builder (variable / binding scope trees)
│   │       ├── clustering/        # Directory-based community detection
│   │       ├── flow-detection/    # Entry-point finder + execution flow tracer
│   │       │
│   │       ├── graph/             # In-memory knowledge graph (O(1) node/edge lookup)
│   │       ├── search/            # BM25 text search · vector embedder · vector index (LadybugDB)
│   │       ├── storage/           # LadybugDB graph persistence · repo registry · metadata
│   │       │
│   │       ├── multi-repo/        # Repository groups, contract extraction, cross-repo linking
│   │       │   ├── group-registry.ts   # Load/save group configs + sync results
│   │       │   ├── group-sync.ts       # Extract contracts + match via RRF
│   │       │   ├── group-query.ts      # Cross-repo BM25 search with RRF merge
│   │       │   └── types.ts            # RepoGroup, Contract, ContractLink, GroupSyncResult
│   │       │
│   │       ├── http/              # Express REST API + static web UI serving
│   │       ├── mcp-server/        # MCP stdio transport + all tool/resource handlers
│   │       ├── shared/            # Logger (winston, sensitive-data masking, ~/.code-intel/logs/)
│   │       └── cli/               # Commander CLI (progress bars, spinners)
│   │           ├── main.ts              # All CLI commands
│   │           ├── skill-writer.ts      # Generates .claude/skills/code-intel/ SKILL.md files
│   │           └── context-writer.ts    # Upserts AGENTS.md + CLAUDE.md blocks
│   │
│   └── web/                       # React + Sigma.js frontend
│       └── src/
│           ├── pages/             # ConnectPage · LoadingPage · ExplorerPage
│           ├── components/
│           │   ├── graph/         # GraphView (Sigma.js force-directed canvas)
│           │   ├── panels/        # NodeDetail · SearchBar · SidebarChat · SidebarFiles · SidebarFilters
│           │   └── shared/        # Header · StatusFooter · KeyboardShortcutsModal
│           ├── ai/                # Chat agent with intent parsing + tool calls
│           ├── api/               # ApiClient (search, vector-search, inspect, blast-radius, flows, clusters)
│           ├── graph/             # Node color palette + ForceAtlas2 layout utilities
│           └── state/             # React context + reducer (AppContext, AppState)
│
├── .code-intel/                   # Generated per-repo: graph.db · vector.db · meta.json
└── .codeintelignore               # Optional: directories to exclude (like .gitignore)
```

### Pipeline Phases

| Phase | Description |
|-------|-------------|
| `scan` | Walk filesystem, collect source files (parallel batch I/O, 512 KB limit), ignore `node_modules`, `dist`, `.venv`, etc. |
| `structure` | Create file and directory nodes in the graph |
| `parse` | Read files in parallel batches of 64, extract symbols (functions, classes, etc.), build per-file sorted function index |
| `resolve` | Resolve imports → edges, build call graph (O(log n) binary-search lookup), detect heritage (extends/implements) |
| `cluster` | Directory-based community detection, add cluster nodes |
| `flow` | Detect entry points, trace execution flows |
| `summarize` | _(opt-in)_ Generate 1–2 sentence AI summaries for `function`/`class`/`method`/`interface` nodes via OpenAI, Anthropic, or Ollama; skips unchanged nodes (code-hash cache) |

Each phase streams live progress to the CLI via animated `█░` progress bars:

```
  [parse    ] ████████████████░░░░░░░░░░░░░░  53% (80/151)
```

Post-pipeline steps (DB persist, skill files, context files) show a braille spinner:

```
  ⠹ Persisting graph to DB…
```

---

## 📋 Logging

Logs are written to **`~/.code-intel/logs/`** using daily rotation (powered by [winston](https://github.com/winstonjs/winston)):

| Setting | Default | Override |
|---------|---------|----------|
| Log directory | `~/.code-intel/logs/` | — |
| Log file pattern | `YYYY-MM-DD-code-intel.log` | — |
| Max file size | 20 MB | — |
| Retention | 14 days | — |
| Log level | `info` | `LOG_LEVEL=debug\|info\|warn\|error\|silent` |
| Production mode | Console only | `NODE_ENV=production` |

Sensitive data (passwords, tokens, API keys, emails, credit cards, etc.) is automatically **masked** before writing — only the first and last character are visible.

---

## 🛠️ CLI Commands

### Setup

```bash
code-intel setup                         # Register the MCP server in your editor config (one-time)
```

### Analyze

```bash
code-intel analyze [path]                # Parse source code and build the knowledge graph
code-intel analyze --force               # Discard existing index and perform a full re-analysis
code-intel analyze --skills              # Emit per-cluster SKILL.md files under .claude/skills/code-intel/
code-intel analyze --embeddings          # Build a vector index for semantic (natural-language) search
code-intel analyze --skip-embeddings     # Omit embedding generation for a significantly faster run
code-intel analyze --skip-agents-md      # Preserve any hand-edited content in AGENTS.md / CLAUDE.md
code-intel analyze --skip-git            # Allow analysis of directories that are not Git repositories
code-intel analyze --verbose             # Print every file skipped due to an unsupported parser
```

### Server

```bash
code-intel mcp [path]                    # Launch the MCP stdio server consumed by AI-enabled editors
code-intel serve [path] --port <n>       # Start the HTTP API and serve the interactive web UI (default :4747)
code-intel watch [path] --port <n>       # Start HTTP server + file watcher (auto-reindex on file saves)
```

### Query (GQL)

```bash
code-intel query "<gql>"                 # Run a GQL query (FIND / TRAVERSE / PATH / COUNT GROUP BY)
code-intel query "<gql>" --format table|json|csv   # Output format (default: table)
code-intel query --file <path.gql>       # Load query from file
code-intel query "<gql>" --limit <n>     # Override LIMIT in the query
code-intel query --save <name> "<gql>"   # Save a named query to .code-intel/queries/
code-intel query --run <name>            # Run a saved query by name
code-intel query --list                  # List all saved queries
code-intel query --delete <name>         # Delete a saved query
```

### Health

```bash
code-intel health [path]                 # Show health score + dead code / cycles / god nodes / orphans
code-intel health --dead-code            # List all dead-code symbols
code-intel health --cycles               # List all circular dependency cycles
code-intel health --orphans              # List all orphan files
code-intel health --json                 # Machine-readable JSON output
```

### Registry

```bash
code-intel list                          # Display all repositories that have been indexed
code-intel status [path]                 # Report index freshness, symbol counts, and last-run duration
code-intel clean [path]                  # Remove the .code-intel/ index for the specified repository
code-intel clean --all --force           # Permanently remove all indexed repositories (requires --force)
```

### Exploration

```bash
code-intel search <query>                # Execute a BM25 keyword search across all indexed symbols
code-intel search <query> --limit <n>    # Limit number of results (default: 20)
code-intel inspect <symbol>              # Show callers, callees, import edges, and source location
code-intel impact <symbol>               # Compute the transitive blast radius of a change to a symbol
code-intel impact <symbol> --depth <n>   # Set maximum traversal depth / hops (default: 5)
```

### Groups (multi-repo / monorepo service tracking)

```bash
code-intel group create <name>                                              # Create a named group to track multiple repositories together
code-intel group add <group> <groupPath> <registryName>                    # Enroll an indexed repo in a group under the given hierarchy path
code-intel group remove <group> <groupPath>                                # Remove a repository from a group by its hierarchy path
code-intel group list [name]                                               # List all groups, or print the full membership of one group
code-intel group sync <name>                                               # Extract cross-repo contracts and resolve provider/consumer links
code-intel group contracts <name> [--kind] [--repo] [--min-confidence]    # Inspect extracted contracts and confidence-ranked cross-links
code-intel group query <name> <q>                                          # Run a merged RRF search across every repository in a group
code-intel group status <name>                                             # Audit index freshness and sync staleness for all group members
```

**`group add` parameters:**
- `<group>` — name of the group
- `<groupPath>` — hierarchy path (e.g. `hr/hiring/backend`)
- `<registryName>` — the repo's name as shown by `code-intel list`

**`group contracts` options:**
- `--kind <kind>` — filter by contract kind: `export` | `route` | `schema` | `event`
- `--repo <repo>` — filter by registry name
- `--min-confidence <pct>` — minimum link confidence 0–100 (default: 0)

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
| `POST` | `/api/v1/query` | Execute a GQL query string; returns nodes/edges/groups + executionTimeMs |
| `POST` | `/api/v1/query/explain` | Return query plan without executing |
| `GET`  | `/api/v1/source` | Fetch file content with ±20 lines context; path-traversal protected |
| `POST` | `/api/v1/grep` | Regex search in file content |
| `GET`  | `/api/v1/flows` | List detected flows |
| `GET`  | `/api/v1/clusters` | List clusters |

---

## 🤖 MCP Server Tools

All tools are available to any MCP-capable editor (Claude Desktop, Claude Code, VS Code, Cursor, etc.) after running `code-intel setup`.

### Core Tools

| Tool | Input | Description |
|------|-------|-------------|
| `repos` | _(none)_ | List all indexed repositories with path, indexedAt, and node/edge counts |
| `overview` | _(none)_ | Repository summary: total nodes/edges + full breakdown by kind. **Use this first** to understand the codebase shape. |
| `search` | `query` (string), `limit` (number, default 10) | BM25 / hybrid keyword + semantic search across all symbols |
| `inspect` | `symbol_name` (string) | 360° view of a symbol: definition, callers, callees, imports, heritage (extends/implements), members, cluster, and source preview |
| `blast_radius` | `target` (string), `direction` (`callers`\|`callees`\|`both`), `max_hops` (number, default 2) | Impact analysis: traverse the call/import graph to find all affected symbols. Returns a `riskLevel` (LOW / MEDIUM / HIGH). |
| `file_symbols` | `file_path` (string, partial match), `limit` (number, default 10) | List all symbols defined in a file, ordered by line number. Avoids having to read raw source. |
| `find_path` | `from` (string), `to` (string), `max_hops` (number, default 8) | Find the shortest call/import path between two symbols via BFS. |
| `list_exports` | `kind` (string, optional), `limit` (number, default 10) | List all exported symbols — the public API surface of the codebase. Filter by kind: `function`, `class`, `interface`, etc. |
| `routes` | _(none)_ | List all HTTP route handler mappings detected in the codebase |
| `clusters` | `limit` (number, default 10) | List detected code clusters (directory-based communities) with member counts and top 10 symbols each |
| `flows` | `limit` (number, default 10) | List detected execution flows with entry points, steps, and step counts |
| `query` | `gql` (string), `limit` (number, optional) | Execute a GQL query (`FIND`, `TRAVERSE`, `PATH`, `COUNT GROUP BY`) against the live graph; returns nodes/edges/groups + executionTimeMs |
| `detect_changes` | `base_ref` (string, default `HEAD`), `diff_text` (string, optional) | **Git-diff impact analysis**: maps changed lines to graph symbols and computes combined blast radius. Ideal for PR review or pre-commit checks. |
| `raw_query` | `cypher` (string) | _(deprecated — use `query` instead)_ Simplified Cypher-like graph query: `name='X'` or `:kind` |

### Reasoning Tools

| Tool | Input | Description |
|------|-------|-------------|
| `explain_relationship` | `from` (string), `to` (string) | Explain how two symbols are connected: directed paths, shared imports, and heritage (extends/implements). Returns up to 10 paths with at most 5 hops each. |
| `pr_impact` | `changedFiles` (string[]), `diff` (string, optional), `maxHops` (number, default 2) | Given changed files or a unified diff, compute full blast radius with risk scores (HIGH/MEDIUM/LOW), test coverage gaps, and top files to review. |
| `similar_symbols` | `symbol` (string), `limit` (number, default 10) | Find symbols with similar names or structure using Levenshtein distance and kind matching. Useful for finding related functions, classes, or interfaces. |
| `health_report` | `scope` (string, optional) | Code health signals for a scope: dead code, cycles, god nodes, orphan files, complexity hotspots. |
| `suggest_tests` | `symbol` (string) | Suggest test cases for a symbol: call paths, suggested cases, existing tests, untested callers. |
| `cluster_summary` | `cluster` (string) | Rich summary of a module/cluster: purpose, key symbols, dependencies, dependents, and health score. |

### Security & Quality Tools

| Tool | Input | Description |
|------|-------|-------------|
| `deprecated_usage` | `scope` (string, optional) | Find usages of deprecated APIs (`@deprecated` JSDoc, `@Deprecated` Java, `#[deprecated]` Rust, built-in Node.js) in the codebase. |
| `complexity_hotspots` | `scope` (string, optional), `limit` (number, default 10) | Ranked list of functions/methods by cyclomatic complexity. Useful for identifying refactoring candidates. |
| `coverage_gaps` | `scope` (string, optional), `threshold` (number, optional) | Find exported symbols with no test coverage, ranked by blast radius. Useful for prioritizing test writing. |
| `secrets` | `scope` (string, optional) | Scan the knowledge graph for hardcoded secrets: API keys, passwords, tokens, private keys, high-entropy strings. |
| `vulnerability_scan` | `scope` (string, optional), `severity` (string, optional) | Scan the knowledge graph for OWASP vulnerabilities: SQL injection (CWE-89), XSS (CWE-79), SSRF (CWE-918), path traversal (CWE-22), command injection (CWE-78). |

### Group / Multi-Repo Tools

| Tool | Input | Description |
|------|-------|-------------|
| `group_list` | `name` (string, optional) | List all configured repository groups, or show full membership of one group |
| `group_sync` | `name` (string) | Extract contracts (exports, routes, schemas, events) from all member repos and detect cross-repo provider→consumer links via name matching + RRF scoring |
| `group_contracts` | `name` (string), `kind` (`export`\|`route`\|`schema`\|`event`, optional), `repo` (string, optional), `min_confidence` (number 0–1, optional) | Inspect extracted contracts and confidence-ranked cross-repo links from the last sync |
| `group_query` | `name` (string), `query` (string), `limit` (number, default 10) | BM25 search across all repos in a group, merged via Reciprocal Rank Fusion. Returns unified ranked list + per-repo breakdown. |
| `group_status` | `name` (string) | Check index freshness and sync staleness for all repos in a group. Flags repos as `OK`, `STALE` (>24h), or `NOT_INDEXED`. |

### Resources

MCP resources are readable via `ReadResource` — your editor can pull them as structured context.

| URI | Description |
|-----|-------------|
| `codeintel://repo/<name>/overview` | Repository stats: total nodes, edges, and per-kind node counts |
| `codeintel://repo/<name>/clusters` | All cluster nodes with member counts |
| `codeintel://repo/<name>/flows` | All detected execution flows with entry points and steps |

---

## 💾 Storage

All generated files are stored locally — nothing is sent to external servers.

| Path | Contents |
|------|----------|
| `.code-intel/graph.db` | LadybugDB knowledge graph |
| `.code-intel/vector.db` | LadybugDB vector index |
| `.code-intel/meta.json` | Index metadata (timestamp, stats) |
| `~/.code-intel/registry.json` | Global registry of all indexed repos |
| `~/.code-intel/groups/<name>.json` | Repository group configuration |
| `~/.code-intel/groups/<name>.sync.json` | Last group sync results (contracts + cross-repo links) |
| `~/.code-intel/logs/YYYY-MM-DD-code-intel.log` | Daily-rotating application logs (14-day retention) |

---

## 🧪 Testing

```bash
npm run test
```

46 tests across unit + integration suites covering:
- Knowledge graph operations
- Language detection
- Call classifier
- MRO computation
- Scope analysis
- Text search
- Pipeline integration (parse → resolve)

---

## 📊 Benchmark / Eval

Measure accuracy of the knowledge graph, skill files, MCP tools, and context file generation:

```bash
# Single-language fixture (TypeScript)
npm run eval

# Multi-language fixture (Python + TypeScript)
npm run eval:multi

# Run all fixtures
npm run eval:all

# Save results as JSON
npm run eval:json
```

Results are written to `eval/results/`. Each run scores:

| Phase | What is tested |
|-------|---------------|
| Analysis | Symbol count, edge count, exit code |
| Search | BM25 keyword search accuracy |
| Inspect | Symbol detail retrieval |
| Impact | Blast radius correctness |
| Skill Files | SKILL.md generation, hot symbols, frontmatter |
| Context Files | AGENTS.md / CLAUDE.md upsert + idempotency |
| Status | Index freshness reporting |
| Clean | Index removal |

Current score: **25/25 (100%)** TypeScript · **15/15 (100%)** multi-lang

### Agent Benchmark (Before vs After)

The `bench` command simulates an AI agent answering code questions with and without code-intel:

```bash
npm run bench
```

Latest results on the TypeScript fixture (6 tasks):

| Metric | Baseline (grep + read files) | Enhanced (code-intel tools) | Δ |
|--------|-----------------------------|-----------------------------|---|
| **Accuracy** | 58% | **100%** | +42pp |
| **Tool calls/task** | 2.0 | **1.0** | −50% |
| **Response size** | 1023 chars | **189 chars** | −82% token cost |

### MCP Server Benchmark

Test all MCP tools directly over the JSON-RPC stdio transport:

```bash
npm run bench:mcp
```

Latest results (16 cases, TypeScript fixture):

| Metric | Result |
|--------|--------|
| **Score** | 16/16 (100%) |
| **Avg tool latency** | 39ms/call |

Tools tested: `repos`, `search`, `inspect`, `blast_radius`, `routes`, `raw_query` + `ListTools`, `ListResources`, `ReadResource`

---

## 🔧 Technical Implementation Details

### web-tree-sitter v0.26 API

- `Parser.SyntaxNode` → `Node` (named export)
- `Parser.Language` → `Language` (named export)
- `language.query(src)` → `new Query(language, src)`
- `Parser.Language.load()` → `Language.load()`

### GraphView (Sigma.js)

- Graph built once from data; Sigma `nodeReducer`/`edgeReducer` used for filter/selection/hover changes (no remount)
- `stateRef`/`dispatchRef` pattern to avoid stale closures in event handlers
- `suppressNextStage` guard ensures `clickNode` event wins over `clickStage`
- Camera fly-to uses `renderer.getNodeDisplayData(id)` for normalized coordinates (NOT raw graphology attributes)
- ForceAtlas2 layout applied synchronously after graph build

### Multi-repo Groups

- Contract kinds: `export`, `route`, `schema`, `event`
- Cross-repo matching via Reciprocal Rank Fusion (RRF)
- Confidence scoring for cross-repo links

### Build System

- Core: `tsup` bundler → `dist/cli/main.js` + `dist/index.js`
- Web: Vite + Tailwind CSS v4
- `esbuild` and `vite` must be in root `devDependencies` to be hoisted for monorepo npm workspaces

---

## 🚢 CI/CD

### GitHub Actions Workflows

| Workflow | Trigger | Steps |
|----------|---------|-------|
| **test.yml** | PRs | `npm ci --legacy-peer-deps` + `npm test` |
| **quality.yml** | PRs | Typecheck shared + core + web |
| **publish.yml** | `v*.*.*` tags | Typecheck → Test → npm audit → License gate → Build core → Build web → `npm publish --provenance` → Build + push multi-arch Docker (linux/amd64 + linux/arm64) → Trivy CRITICAL CVE gate → cosign keyless sign → GitHub Release with CycloneDX SBOM → Discord notification |

### Publishing a New Version

```bash
# Bump version in code-intel/core/package.json, then:
git tag v0.1.5
git push origin v0.1.5
```

The publish workflow automatically runs all checks, builds the packages, publishes to npm, and sends a Discord notification (📦 success or ❌ failure).

**Required GitHub Secrets:**

| Secret | Purpose |
|--------|---------|
| `NPM_TOKEN` | npm access token with publish rights |
| `DISCORD_WEBHOOK` | Discord webhook URL for deploy notifications |

### Local CI Simulation

```bash
docker compose -f docker-compose.build.yml build
```

Uses `node:22-bookworm-slim` — the same base image as GitHub Actions.

---

## 📄 License

MIT © 2024
