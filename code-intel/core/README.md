# Code Intelligence Platform

A static code analysis platform that builds a **Knowledge Graph** from your source code and makes it explorable through a Web UI, HTTP API, CLI, and MCP server.

![Code Intelligence Platform](screenshots/explorer-overview.png)

---

## ✨ Features

- **Knowledge Graph** — parses 14+ languages into nodes (functions, classes, files, etc.) and edges (calls, imports, extends, etc.)
- **Force-directed Graph Explorer** — interactive Sigma.js visualization with color-coded node types, hover highlighting, and filters
- **Hybrid Search (BM25 + Vector RRF)** — embeddings via `all-MiniLM-L6-v2` + BM25 keyword search merged with Reciprocal Rank Fusion; `searchMode: 'bm25' | 'vector' | 'hybrid'` in responses
- **Graph Query Language (GQL)** — `FIND`, `TRAVERSE`, `PATH`, `COUNT … GROUP BY` statements; CLI `code-intel query`; `POST /api/v1/query`; `query` MCP tool
- **Code AI Chat** — grounded assistant that cites source files in every answer
- **LadybugDB Persistence** — graph and vector index stored as embedded graph database
- **HTTP API** — REST endpoints for graph, search, inspect, blast radius, flows, source preview, GQL query
- **MCP Server** — Model Context Protocol integration for LLM tooling; reasoning tools (`explain_relationship`, `pr_impact`, `similar_symbols`, `health_report`, `suggest_tests`, `cluster_summary`); tool-chaining hints
- **CLI** — analyze, serve, query, health, scan, secrets, complexity, coverage, deprecated, pr-impact commands with animated `█░` progress bars and braille spinners
- **Multi-language** — TypeScript, JavaScript, Python, Java, Go, C, C++, C#, Rust, PHP, Ruby, Swift, Kotlin, Dart (14 languages via tree-sitter AST)
- **Incremental Analysis** — `--incremental` re-parses only changed files; 10k-file repo / 3 changes: 288ms
- **Parallel Analysis** — `--parallel` runs parse + resolve phases on worker threads for large repos
- **AI-Generated Summaries** — opt-in `--summarize` phase via OpenAI, Anthropic, or Ollama; cached by code hash; AI governance log
- **File Watcher & Auto-Reindex** — `code-intel watch`; chokidar-based debounced reindex; WebSocket push to Web UI
- **Code Health** — dead code, circular dependency (Tarjan SCC), god node, orphan file detection; `code-intel health` with score 0–100
- **Security Scanning** — hardcoded secret detection; OWASP vulnerability detection (SQL injection, XSS, SSRF, path traversal, command injection) with CWE IDs and SARIF output
- **Complexity Metrics** — cyclomatic + cognitive complexity; `code-intel complexity --top N`
- **Test Coverage** — `tested_by` edges; `code-intel coverage` sorted by blast radius
- **Deprecated API Detection** — `@deprecated` JSDoc/annotations + built-in Node.js deprecated APIs; `deprecated_use` edges
- **Repository Groups & Monorepo** — workspace auto-discovery (npm, pnpm, Nx, Turborepo); type-aware contract matching; OpenAPI/GraphQL/Protobuf schema extraction; cross-repo topology Web UI; CI/CD `pr-impact` + GitHub Action
- **Structured Logging** — winston-based logger with daily-rotating log files, sensitive-data masking, and configurable log levels

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
code-intel analyze --summarize     # Generate AI summaries (OpenAI / Anthropic / Ollama)
code-intel analyze --skills        # Emit per-cluster SKILL.md files
code-intel serve [path] -p 4747    # Analyze + start HTTP server
code-intel watch [path]            # Serve + auto-reindex on file changes (WebSocket push)
code-intel mcp [path]              # Start MCP server (stdio)
code-intel setup                   # Register MCP server in editor config (one-time)
code-intel search <query> [path]   # Hybrid text search
code-intel inspect <symbol>        # Inspect a symbol
code-intel impact <symbol>         # Blast radius analysis
code-intel query "<gql>"           # Execute GQL (FIND / TRAVERSE / PATH / COUNT)
code-intel query --save <name>     # Save a named query
code-intel query --run <name>      # Run a saved query
code-intel health [path]           # Code health report (dead code, cycles, god nodes, score)
code-intel scan [path]             # OWASP vulnerability scan (SQL, XSS, SSRF, path, cmd)
code-intel secrets [path]          # Hardcoded secret detection
code-intel complexity [path]       # Cyclomatic + cognitive complexity hotspots
code-intel coverage [path]         # Untested exported symbols sorted by blast radius
code-intel deprecated [path]       # Deprecated API usage report
code-intel pr-impact               # PR blast radius with risk scores + SARIF output
code-intel group init-workspace    # Auto-discover monorepo packages and create a group
code-intel list                    # List indexed repos
code-intel status [path]           # Show index status
code-intel clean [path]            # Remove index data
```

---

## 🌐 HTTP API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/v1/health` | Server status + graph size + `watching` + `lastWatchEvent` |
| `GET`  | `/api/v1/repos` | List indexed repos |
| `GET`  | `/api/v1/graph/:repo` | Full graph (nodes + edges) |
| `POST` | `/api/v1/search` | Hybrid BM25 + vector search (RRF); `searchMode` in response |
| `POST` | `/api/v1/vector-search` | Semantic vector search |
| `GET`  | `/api/v1/vector-status` | Vector index ready/building status |
| `GET`  | `/api/v1/nodes/:id` | Node detail (callers, callees, imports, etc.) |
| `POST` | `/api/v1/blast-radius` | Impact analysis |
| `POST` | `/api/v1/cypher` | Cypher query (routed to LadybugDB) |
| `POST` | `/api/v1/grep` | Regex search in file content |
| `GET`  | `/api/v1/flows` | List detected flows |
| `GET`  | `/api/v1/clusters` | List clusters |
| `GET`  | `/api/v1/source` | Source code preview (`?file=&startLine=&endLine=`); path-traversal guarded |
| `POST` | `/api/v1/query` | Execute GQL query (`{ gql, format? }`); returns `executionTimeMs`, `truncated`, `totalCount` |
| `POST` | `/api/v1/query/explain` | GQL query plan |
| `GET`  | `/api/v1/groups` | List repository groups |
| `GET`  | `/api/v1/groups/:name/topology` | Cross-repo topology (repos as nodes, contract edges) |
| `GET`  | `/api/v1/openapi.json` | OpenAPI 3.1 spec |

---

## 🤖 MCP Server Tools

| Tool | Description |
|------|-------------|
| `repos` | List all indexed repositories |
| `overview` | Repository summary: total nodes/edges + full breakdown by kind + `health` field |
| `search` | Hybrid BM25 + vector search; `searchMode` + `suggested_next_tools` in response |
| `inspect` | 360° view of a symbol: definition, callers, callees, imports, heritage, members, cluster |
| `blast_radius` | Impact analysis: traverse call/import graph; `riskLevel` + `suggested_next_tools` |
| `file_symbols` | List all symbols defined in a file, ordered by line number |
| `find_path` | Shortest call/import path between two symbols via BFS |
| `list_exports` | List all exported symbols — the public API surface of the codebase |
| `routes` | List all HTTP route handler mappings detected in the codebase |
| `clusters` | List detected code clusters with member counts and top symbols |
| `flows` | List detected execution flows with entry points and steps |
| `detect_changes` | Git-diff impact analysis: maps changed lines to graph symbols |
| `query` | Execute a GQL query (`FIND`, `TRAVERSE`, `PATH`, `COUNT … GROUP BY`) |
| `raw_query` | ⚠️ Deprecated — use `query` instead |
| `explain_relationship` | All directed paths, shared imports, heritage, and natural-language summary between two symbols |
| `pr_impact` | Full blast radius with HIGH/MEDIUM/LOW risk scoring, coverage gaps, top files to review |
| `similar_symbols` | Vector + structural + name similarity scoring |
| `health_report` | Health signals (dead code, cycles, god nodes, orphan files) filtered by scope; score 0–100 |
| `suggest_tests` | Call paths, boundary test suggestions, existing tests, untested callers |
| `cluster_summary` | Key symbols, cluster dependencies/dependents, health signals, symbol counts |
| `secrets` | Hardcoded secret findings (API keys, tokens, DB URLs, high-entropy strings) |
| `vulnerability_scan` | OWASP findings with CWE IDs (SQL, XSS, SSRF, path traversal, command injection) |
| `complexity_hotspots` | Top complex functions by cyclomatic + cognitive complexity |
| `coverage_gaps` | Untested exported symbols sorted by blast radius |
| `deprecated_usage` | All deprecated API usages with caller context |
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
