# Code Intelligence Platform

A static code analysis platform that builds a **Knowledge Graph** from your source code and makes it explorable through a Web UI, HTTP API, CLI, and MCP server.

![Code Intelligence Platform](screenshots/explorer-overview.png)

---

## ✨ Features

- **Knowledge Graph** — parses 14+ languages into nodes (functions, classes, files, etc.) and edges (calls, imports, extends, etc.)
- **Force-directed Graph Explorer** — interactive Sigma.js visualization with color-coded node types, hover highlighting, and filters
- **Semantic Vector Search** — embeddings via `all-MiniLM-L6-v2` stored in LadybugDB vector index for natural-language code search
- **BM25 Text Search** — keyword-based search with reciprocal rank fusion
- **Code AI Chat** — grounded assistant that cites source files in every answer
- **LadybugDB Persistence** — graph and vector index stored as embedded graph database
- **HTTP API** — REST endpoints for graph, search, inspect, blast radius, flows
- **MCP Server** — Model Context Protocol integration for LLM tooling
- **CLI** — analyze, serve, search, inspect, impact commands
- **Multi-language** — TypeScript, JavaScript, Python, Java, Go, C, C++, C#, Rust, PHP, Kotlin, Ruby, Swift, Dart

---

## 🚀 Quick Start

### Install

```bash
npm install
npm run build
```

### Analyze & Serve

```bash
# Analyze current directory and start the server
node code-intel/core/dist/cli/main.js serve

# Or specify a path and port
node code-intel/core/dist/cli/main.js serve ./my-project --port 4747
```

Then open **http://localhost:4747** in your browser — the Web UI auto-connects and loads the graph.

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
│   │       └── cli/           # Commander CLI
│   └── web/          # React + Sigma.js frontend
│       └── src/
│           ├── components/    # GraphView, NodeDetail, SidebarChat, SidebarFiles, Filters
│           ├── ai/            # Agent with intent parsing + tool calls
│           ├── api/           # ApiClient (search, vector-search, inspect, blast-radius)
│           ├── graph/         # Colors palette, layout utilities
│           └── state/         # React context + reducer
└── .code-intel/      # Generated: graph.db, vector.db, meta.json
```

### Pipeline Phases

| Phase | Description |
|-------|-------------|
| `scan` | Walk filesystem, collect source files, ignore `node_modules`, `dist`, etc. |
| `structure` | Create file and directory nodes in the graph |
| `parse` | Parse files with web-tree-sitter, extract symbols (functions, classes, etc.) |
| `resolve` | Resolve imports → edges, build call graph, detect heritage (extends/implements) |
| `cluster` | Directory-based community detection, add cluster nodes |
| `flow` | Detect entry points, trace execution flows |

---

## 🛠️ CLI Commands

```bash
code-intel analyze [path]          # Analyze and persist graph
code-intel serve [path] -p 4747    # Analyze + start HTTP server
code-intel mcp [path]              # Start MCP server (stdio)
code-intel search <query> [path]   # Text search
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
| `GET`  | `/api/health` | Server status + graph size |
| `GET`  | `/api/repos` | List indexed repos |
| `GET`  | `/api/graph/:repo` | Full graph (nodes + edges) |
| `POST` | `/api/search` | BM25 text search |
| `POST` | `/api/vector-search` | Semantic vector search |
| `GET`  | `/api/vector-status` | Vector index ready/building status |
| `GET`  | `/api/nodes/:id` | Node detail (callers, callees, imports, etc.) |
| `POST` | `/api/blast-radius` | Impact analysis |
| `POST` | `/api/cypher` | Cypher query (routed to LadybugDB) |
| `POST` | `/api/grep` | Regex search in file content |
| `GET`  | `/api/flows` | List detected flows |
| `GET`  | `/api/clusters` | List clusters |

---

## 🤖 MCP Server Tools

| Tool | Description |
|------|-------------|
| `list_repos` | List indexed repositories |
| `search_code` | Search for symbols by name |
| `inspect_node` | Get detailed info about a symbol |
| `blast_radius` | Impact analysis for a symbol |
| `trace_routes` | Trace execution paths from entry points |
| `raw_query` | Execute Cypher queries |

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

46 tests across unit + integration suites covering:
- Knowledge graph operations
- Language detection
- Call classifier
- MRO computation
- Scope analysis
- Text search
- Pipeline integration (parse → resolve)

---

## 📋 Requirements

- **Node.js** 22+
- **npm** 10+

---

## 📄 License

MIT © 2024
