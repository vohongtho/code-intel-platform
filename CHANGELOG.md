# Changelog

All notable changes to this project are documented in this file.

---

## [0.9.0] — 2026-05-03 — Developer Experience

> **Theme:** Zero-friction setup, great errors, IDE integration

### 🧙 Epic 1 — Interactive `code-intel init` Wizard

- **`code-intel init`** — interactive 5-step wizard that creates `~/.code-intel/config.json`
  - Step 1: Editor detection (VS Code, Cursor, Windsurf, Zed) → offer MCP registration
  - Step 2: LLM provider (OpenAI / Anthropic / Ollama / skip)
  - Step 3: Embeddings (enable vector search?)
  - Step 4: Auth mode (local only / OIDC)
  - Step 5: Default port + open browser on serve
- **`code-intel init --reset`** — wipe and re-run wizard
- **`code-intel init --yes`** — non-interactive: accept all defaults (CI / scripted installs)
- **First-run hint** — if no config exists, startup prints `ℹ  No config found. Run \`code-intel init\`…`

### ⚙️ Epic 2 — Config Management CLI

- **`code-intel config get <key>`** — print single config value (dot-path notation)
- **`code-intel config set <key> <value>`** — update value, validate, and save
- **`code-intel config list`** — print full config as formatted JSON (sensitive values masked with `***`)
- **`code-intel config validate`** — validate against JSON Schema; prints errors with hints
- **`code-intel config reset`** — reset to defaults (with confirmation prompt or `-y` flag)
- **JSON Schema** — all fields, types, allowed values, and defaults for `~/.code-intel/config.json`
- **`$ENV_VAR` syntax** — expand environment variables in string config values
- **Startup validation** — invalid config → clear error with field path and fix hint

### 🚨 Epic 3 — Better Error Messages

- **Custom error classes** — `AuthError`, `AnalysisError`, `ConfigError`, `DBError`, `NetworkError`
- **CI-XXXX error codes** — every error carries a structured code, hint, and docs URL
  - `CI-1000` Not authenticated · `CI-1004` Repo not indexed · `CI-1042` DB corrupted
  - `CI-2000` Config invalid · `CI-3000` Analysis failed · `CI-5000` Network error
- **Stack traces suppressed by default** — clean one-liner errors in normal use
- **`--debug` flag** — reveals full stack trace for any command
- **Startup prerequisite checks** — Node.js ≥ 22, git in PATH, disk space > 500 MB
- **Global uncaught error handler** — formats and exits cleanly on unexpected errors

### 🐚 Epic 4 — Shell Completion

- **`code-intel completion bash`** — generates a valid bash completion script
- **`code-intel completion zsh`** — generates a valid zsh completion script
- **`code-intel completion fish`** — generates a fish completion script
- **`code-intel setup --completion`** — auto-installs completion for the detected shell
- **Dynamic completion** — repo paths from `~/.code-intel/registry.json`, group names from `~/.code-intel/groups/`, all subcommand flags

### 🧩 Epic 5 — VS Code Extension

- **New package** `vscode-code-intel` in `extensions/vscode/`
- **Symbol hover provider** — hover over any function/class → fetch summary + callers/callees from graph API
- **Symbol Explorer panel** — tree view of symbols in the active file (kind icons)
- **Status bar indicator** — `$(graph) Code Intel: indexed Xh ago` → click → re-analyze
- **"Open in Graph" command** — right-click symbol → open Web UI centered on that node
- **Command palette** — `Code Intel: Search`, `Code Intel: Analyze`, `Code Intel: Health`
- **Go-to-definition from graph** — URI handler (`vscode://…/jump?file=…&line=…`) jumps editor to source
- **Settings** — `codeIntel.serverUrl`, `codeIntel.token`, `codeIntel.enableHover`, `codeIntel.autoAnalyze`
- **GitHub Actions workflow** — `.github/workflows/publish-vscode.yml` publishes `.vsix` to VS Code Marketplace + Open VSX on every version tag

### 🔄 Epic 6 — `code-intel update` Self-Update

- **`code-intel update`** — checks npm registry; prompts `New version X.Y.Z available. Update now? [y/N]`
- **`code-intel update --yes`** — non-interactive update
- **Background version check** — non-blocking startup check (fire-and-forget); prints notice if outdated
- **`--no-update-check`** flag + `UPDATE_CHECK_DISABLED=1` env var to suppress
- **`UPDATE_CHECK_INTERVAL`** env var (default: 24h)
- **Caches** last-check timestamp + latest version in `~/.code-intel/update-meta.json`

### 🔍 Epic 7 — `--dry-run` Flag

- **`code-intel analyze --dry-run`** — shows file count + estimated time; no DB write
- **`code-intel clean --dry-run`** — shows what would be deleted + sizes; no deletion
- **`code-intel group sync --dry-run`** — shows which members would be synced; no execution

### 🩺 Epic 8 — `code-intel doctor` Diagnostics

- **`code-intel doctor`** — full diagnostic report:
  - ✅/⚠️  Node.js version (≥ 22 required)
  - ✅/⚠️  git availability
  - ✅/❌  `~/.code-intel/config.json` validation
  - ✅  Registry: N repos indexed
  - ✅/⚠️/❌  Per-repo: DB integrity (better-sqlite3 read test), stale index (> 7 days)
  - ✅/⚠️  npm registry reachability
- **Exit code** 0 if all ✅, 1 if any ❌

---

## [0.8.0] — 2026-05-03 — Security & Quality Scanning

> **Theme:** Enterprise-grade security awareness and code quality signals.

### 🔐 Epic 1 — Hardcoded Secret Detection

- **`SecretScanner`** (`src/security/secret-scanner.ts`): scans string literals from tree-sitter AST for API keys (`sk-...`, `pk_live_...`, `AKIA...`, `xoxb-...`), DB URLs with credentials, RSA private keys, and high-entropy strings in sensitive variable names
- `.codeintelignore` patterns respected during secret scanning (`ignorePatterns` option)
- **`code-intel secrets [path]`** CLI: prints findings table (file, line, variable, pattern); `--format table|json`, `--fail-on`, `--fix-hint`, `--include-tests`
- **`secrets` MCP tool**: `{ scope?, includeTestFiles? }` → `{ findings: [...], total }`

### 🛡️ Epic 2 — OWASP Vulnerability Detection

- **`VulnerabilityDetector`** (`src/security/vulnerability-detector.ts`): detects SQL Injection (CWE-89), XSS (CWE-79), SSRF (CWE-918), Path Traversal (CWE-22), Command Injection (CWE-78)
- `VulnerabilityType` exported type for use in CLI and MCP server
- `vulnerability` NodeKind and `has_vulnerability` EdgeKind added to graph model
- **`code-intel scan [path]`** CLI: `--type`, `--severity`, `--format table|json|sarif`, `--fail-on`, `--exclude`
- **`vulnerability_scan` MCP tool**: findings with CWE IDs

### 📊 Epic 3 — Complexity Metrics

- Cyclomatic + cognitive complexity computed for all functions/methods; stored in `metadata.complexity`
- **`code-intel complexity [path] --top N`** CLI and `complexity_hotspots` MCP tool

### 🧪 Epic 4 — Test Coverage Integration

- Test file detection for all major languages; `tested_by` EdgeKind added
- **`code-intel coverage [path]`** CLI and `coverage_gaps` MCP tool: untested exported symbols ranked by blast radius
- `--threshold <pct>` → exit 1 if coverage below target

### 🚫 Epic 5 — Deprecated API Detection

- Detects `@deprecated` JSDoc (TS/JS), `@Deprecated` (Java), `#[deprecated]` (Rust), built-in Node.js deprecated APIs
- `deprecated_use` EdgeKind added; `code-intel deprecated [path]` CLI and `deprecated_usage` MCP tool

### 🤖 AI Agent Context — Multi-Agent Support

- **`writeContextFiles()`** now writes to 5 locations on every `code-intel analyze`:
  - `AGENTS.md` (Amp, Codex, OpenCode, Aider, Factory, Trae, Hermes, Pi, Antigravity, OpenClaw)
  - `CLAUDE.md` (Claude Code)
  - `.github/copilot-instructions.md` (GitHub Copilot / VS Code Copilot Chat)
  - `.cursor/rules/code-intel.mdc` (Cursor IDE)
  - `.kiro/steering/code-intel.md` (Kiro IDE/CLI)
- Context block includes: **Mandatory Rules**, **Development Workflow** (implement, fix, study, review, refactor), **When to Load a Skill** (per-subsystem), and full **CLI Quick Reference** with all working commands

### 🔧 Bug Fixes & Infrastructure

- Added `anymatch`, `braces`, `glob-parent`, `is-binary-path`, `is-glob`, `normalize-path`, `readdirp` as explicit dependencies to fix `Cannot find module` errors in CI (Node 20 environments)
- Fixed GitHub Action (`action.yml`): shell syntax error near `$(...)` — use temp file for JSON output instead of piping through `$GITHUB_OUTPUT`
- Fixed `EdgeKind` type: added `deprecated_use` and `tested_by` (were missing, causing TS2367 errors)
- Merged `main` → `release/0.8.0`

---



> **Theme:** First-class support for large-scale repo structures.

### 🗂️ Workspace Auto-Discovery

- **`detectWorkspace()`** (`src/multi-repo/workspace-detector.ts`): detects npm/yarn/Bun (`workspaces` field), pnpm (`pnpm-workspace.yaml`), Nx (`nx.json`), and Turborepo (`turbo.json`) monorepo types; expands glob patterns into `Array<{ name, path }>`
- **`code-intel group init-workspace`** CLI command: discovers all packages, creates a group, analyzes each package (with `--parallel <n>`, default 2), and runs `group sync`; `--no-analyze`, `--yes`, progress indicators, and final summary table

### 🔬 Type-Aware Contract Matching

- Contracts now include `parameters: [{name, type}]` + `returnType` from node metadata
- New scoring formula: `0.4 * nameSim + 0.3 * paramTypeSim + 0.2 * returnTypeSim + 0.1 * paramCountSim`
- Confidence boost (`×1.2`, capped at 1.0) when both name and types match
- `group contracts` output shows type information

### 📄 API Schema Contract Extraction

- **OpenAPI/Swagger parser** (`src/multi-repo/schema-parsers/openapi-parser.ts`): scans for `openapi.yaml/json`, `swagger.yaml/json`; extracts all path + method entries with request/response schemas
- **GraphQL schema parser** (`src/multi-repo/schema-parsers/graphql-parser.ts`): scans `*.graphql`, `*.gql`; extracts Query/Mutation fields and custom types
- **Protobuf parser** (`src/multi-repo/schema-parsers/proto-parser.ts`): scans `*.proto`; extracts services, RPC methods, and message types

### 🔄 Auto-Sync on Analyze

- After `analyzeWorkspace` completes, auto-triggers `group sync` for all groups containing the repo
- `--no-group-sync` flag to opt out; sync failure → warning only, analysis continues

### 🖥️ Cross-Repo Web UI

- `GET /api/v1/groups` and `GET /api/v1/groups/:name/topology` endpoints
- **`GroupPanel`** sidebar section: group topology graph with repos as nodes and contract edges
- Edge confidence color coding: green (≥0.8), yellow (0.5–0.8), red (<0.5)
- Click edge → contract detail panel; click repo node → switch main graph

### 🔧 CI/CD Integration

- **`code-intel pr-impact`** CLI command: `--base <ref>`, `--head <ref>`, `--fail-on HIGH|MEDIUM`, `--format sarif|json`
- **GitHub Action** (`.github/actions/code-intel/action.yml`): analyze → pr-impact → post PR comment → upload SARIF → exit code
- SARIF 2.1.0 output via `src/cli/sarif-builder.ts`

### 🐛 Bug Fixes

- **Role hierarchy**: `requireRole('viewer')` now correctly permits `analyst` and `admin` users (uses rank-based comparison instead of exact match)
- **Source file path resolution**: `GET /api/v1/source` now resolves relative file paths against `workspaceRoot` before checking repo access — fixes "File path must be within an indexed repository" when the web UI passes relative paths
- **Deprecated packages**: added `overrides` in root `package.json` to upgrade `onnxruntime-node` → `^1.25.1` (drops `global-agent@3`/`boolean@3.2.0`), `node-domexception` → `^2.0.2`, and `global-agent` → `^4.1.3`

---

## [0.6.0] — 2026-05-02 — Smarter AI Tooling

> **Theme:** MCP tools that reason, not just retrieve.

### 🧠 New MCP Reasoning Tools

- **`explain_relationship`** (`src/query/explain-relationship.ts`): explains how two symbols connect — directed paths (max 5 hops, 10 paths), shared imports, heritage (extends/implements), and a natural language summary; unknown symbol returns error + name suggestions
- **`pr_impact`** (`src/query/pr-impact.ts`): given `changedFiles` or a unified `diff`, computes blast radius with risk scoring (HIGH/MEDIUM/LOW), test coverage gaps, and top 5 files to review; supports cross-repo impact when repo is in a group
- **`similar_symbols`** (`src/query/similar-symbols.ts`): finds symbols with similar name (Levenshtein/Jaro-Winkler) and structural similarity (same parameter count + return type); combined score with fallback when no embeddings
- **`health_report`** (`src/query/health-report.ts`): code health signals (dead code, cycles, god nodes, orphan files, complexity hotspots) scoped to a directory prefix; `scope: "."` returns whole-repo health; health score matches `code-intel health` CLI
- **`suggest_tests`** (`src/query/suggest-tests.ts`): suggests test cases for a symbol — call paths, parameter/return-type boundary cases, existing test files importing the symbol, and untested callers
- **`cluster_summary`** (`src/query/cluster-summary.ts`): rich summary of a module — purpose, top 5 key symbols by caller count, dependencies, dependents, health signals, and symbol counts per kind

### 📄 Pagination for All List Tools

- `search`, `clusters`, `flows`, `list_exports`, `file_symbols` all now accept `offset` and `limit` parameters
- Response shape: `{ nodes, total, offset, limit, hasMore }`
- Default limit: 50; max: 500 (clamped)

### 🔗 Tool-Chaining Hints

- `suggested_next_tools: [{ tool, reason, input }]` added to `search`, `blast_radius`, `inspect`, and `pr_impact` responses
- Input context pre-filled with the most relevant symbol from the current result
- Controlled via `CODE_INTEL_SUGGEST_NEXT_TOOLS=false` env flag (default: enabled)

### 🔒 Security Module

- **`SecretScanner`** (`src/security/secret-scanner.ts`): scans graph nodes for hardcoded secrets — OpenAI keys, Stripe keys, AWS access keys, Slack tokens, DB URLs with credentials, RSA private keys, and sensitive-name variables with literal values; scope and test-file filters; tags node metadata with `security.secretRisk`
- **`VulnerabilityDetector`** (`src/security/vulnerability-detector.ts`): detects SQL injection (CWE-89), XSS (CWE-79), SSRF (CWE-918), path traversal (CWE-22), and command injection (CWE-78) from graph structure; scope and type filters; tags nodes and creates `vulnerability` nodes with `has_vulnerability` edges

---

## [0.5.0] — 2026-05-02 — Query & Exploration

> **Theme:** Let users ask arbitrary questions about their code — a native graph query language, source code preview, and a visual query console.

### 🔎 Graph Query Language (GQL)

- **GQL Parser** (`src/query/gql-parser.ts`): recursive-descent lexer/parser supporting four statement types: `FIND`, `TRAVERSE`, `PATH`, `COUNT ... GROUP BY`; WHERE clause with `=`, `!=`, `CONTAINS`, `STARTS_WITH`, `IN` operators; descriptive parse errors with position info
- **GQL Executor** (`src/query/gql-executor.ts`): executes all four statement types against the live graph; 10s execution timeout returns partial results with `{ truncated: true }`; LIMIT/OFFSET pagination
- **`POST /api/v1/query`**: executes a GQL string; returns `{ nodes, edges, groups, executionTimeMs, truncated, totalCount }`; 422 on parse error, 408 on timeout with partial results; requires `viewer` role minimum
- **`POST /api/v1/query/explain`**: returns a human-readable query plan without executing
- **MCP `query` tool**: `{ gql, limit? }` → full GQLResult; replaces `raw_query` (kept with deprecation warning)
- **Saved queries** (`src/query/saved-queries.ts`): `--save`, `--run`, `--list`, `--delete` flags; persisted to `.code-intel/queries/`
- **`code-intel query` CLI command**: `--format table|json|csv`, `--file <path>`, `--limit <n>`, `--save/--run/--list/--delete`; exit code 1 on parse/execution error

### 👁️ Web UI: Source Code Preview

- **`GET /api/v1/source`**: serves file content with ±20 lines of context; path-traversal protection; requires `viewer` role + repo access
- **`SourcePanel`** React component: syntax highlighting via `highlight.js` (lazy-loaded per language); highlights symbol's `startLine..endLine`; click node in graph → panel opens at that symbol; "Open in editor" (`vscode://file/…`) + "Copy path" buttons; resizable with localStorage persistence

### 🖥️ Web UI: Query Console

- **`QueryPanel`** React component: multi-line monospace GQL editor with keyword highlighting; "Run" button + `Ctrl+Enter` shortcut; sortable results table; click result row → selects node in graph; last 20 queries in localStorage; 5 built-in example queries dropdown

### 🔧 Bug Fixes & CI

- **`POST /api/v1/query`**: timeout response now correctly returns HTTP 408 with partial results
- **SBOM generation**: added `continue-on-error: true` + `NPM_CONFIG_LEGACY_PEER_DEPS=true` to CycloneDX workflow step to handle optional platform-specific packages (`@ladybugdb/core-darwin-x64`, `tree-sitter-kotlin`, `tree-sitter-swift`) on Linux CI runners

---

## [0.4.0] — 2026-05-02 — Intelligence Layer

> **Theme:** Understand not just structure, but meaning — AI summaries, hybrid search, live file watcher, and code health signals.

### 🤖 AI-Generated Symbol Summaries

- **`SummarizePhase`** (`src/pipeline/phases/summarize-phase.ts`): optional post-analysis phase triggered by `--summarize` flag or `analysis.summarizeOnAnalyze: true`; targets `function`, `class`, `method`, `interface` nodes only
- **LLM Provider backends** (`src/llm/providers/`): OpenAI (`$OPENAI_API_KEY`), Anthropic (`$ANTHROPIC_API_KEY`), and Ollama (local `http://localhost:11434`) — configurable via `llm.provider`
- **Circuit breaker + retry** (`src/llm/retry.ts`): exponential backoff on 429 responses; circuit opens after 5 consecutive failures (60s pause)
- **Cost guard**: `llm.maxNodesPerRun` stops summarization after N nodes
- **Summary persistence**: `metadata.summary`, `metadata.summaryModel`, `metadata.summaryAt`, `metadata.codeHash` — unchanged nodes are skipped on re-analysis
- **AI governance log**: `~/.code-intel/logs/ai-calls.log` — records nodeId + promptLength only (no raw code content)

### 🔍 Hybrid Search (BM25 + Vector RRF)

- **Richer embeddings**: embedding input enriched to `"[{kind}] {name}\n{signature}\n{summary}"` with code-snippet fallback; `metadata.embeddingSource: 'summary' | 'code'` tracked per node
- **`hybridSearch()`** (`src/search/hybrid-search.ts`): runs BM25 + vector search in parallel, fuses via Reciprocal Rank Fusion (`score = Σ 1 / (60 + rank_i)`)
- **Graceful fallback**: BM25-only when no vector DB present; `searchMode: 'bm25' | 'vector' | 'hybrid'` included in response metadata
- **`GET /api/v1/search`** and MCP `search` tool updated to use hybrid search

### 👁️ File Watcher & Auto-Reindex

- **`FileWatcher`** (`src/pipeline/file-watcher.ts`): chokidar-based watcher on workspace root; respects `.codeintelignore`; 300ms debounce for rapid saves
- **`IncrementalIndexer.patchGraph()`** (`src/pipeline/incremental-indexer.ts`): removes stale nodes/edges, re-parses changed files, merges and upserts — non-blocking for HTTP API reads
- **`code-intel watch`** CLI command: starts HTTP server + file watcher; auto-reindexes on any file save
- **`WsServer`** (`src/http/websocket-server.ts`): WebSocket server at `ws://localhost:PORT/ws`; broadcasts `{ type: "graph:updated", indexVersion, stats, changedFiles }` after each patch; requires valid session token; client auto-reconnects with 3s + jitter backoff
- **Web UI**: "Live" green dot indicator, "Graph updated" toast, and auto-reconnect on WebSocket disconnect
- **`/api/v1/health`**: `watching: true` + `lastWatchEvent` fields added

### 🏥 Code Health Signals

- **Dead code detection** (`src/health/dead-code.ts`): exported symbol with zero callers and zero importers → `metadata.health.deadCode: boolean`; excludes entry points, test files, `@deprecated`
- **Circular dependency detection** (`src/health/circular-deps.ts`): Tarjan's SCC on import graph (< 100ms for 10k nodes); `metadata.health.inCycle: boolean` + `metadata.health.cycleId: string`
- **God node detection** (`src/health/god-nodes.ts`): > 20 methods or > 50 callers → `metadata.health.isGodNode: boolean` + `metadata.health.godReason: string` (thresholds configurable)
- **Orphan file detection** (`src/health/orphan-files.ts`): no imports and no importers → `file.metadata.health.orphan: boolean`; excludes config files, test fixtures, `*.d.ts`
- **`code-intel health`** CLI command: summary table with dead code, cycles, god nodes, orphan files, and a 0–100 health score; `--dead-code`, `--cycles`, `--orphans` for detail lists; `--json` for machine output; exit code 1 when score < configurable threshold
- **Health score formula**: `100 - (deadCode×0.5 + cycles×5 + godNodes×2 + orphans×1)`
- **MCP `overview` tool**: now includes `health` field with score and signal counts

### 🔧 Bug Fixes

- **Express 5 unmatched routes**: silent 404 JSON response replaces noisy `Unhandled error: Not Found` log
- **tsup build**: `@anthropic-ai/sdk` and `openai` marked as external — resolved `Could not resolve` build errors

---

## [0.3.0] — 2026-04-29 — Tree-Sitter AST Parser + Performance

> **Theme:** Replace regex line-by-line parsing with accurate AST extraction; add incremental + parallel analysis; ship a self-contained npm package with bundled web UI.

### 🌳 Tree-Sitter AST Parsing (Epic 1)

- **AST parser** replaces regex line-by-line parsing across 11 languages: TypeScript, JavaScript, Python, Java, Go, C, C++, C#, Rust, PHP, Ruby
- **`ParserManager`** (`src/parsing/parser-manager.ts`): loads and caches tree-sitter WASM grammars per language; idempotent `Parser.init()` guard
- **Per-language query files** (`src/parsing/queries/`): dedicated tree-sitter S-expression queries for all 11 languages
- **Parameter extraction**: `metadata.parameters[]` for TS, JS, Python, Go, Java, Rust
- **Return-type extraction**: `metadata.returnType` for TS, JS, Python, Go, Java, Rust
- **JSDoc / docstring extraction**: `metadata.doc` for TS/JS, Python, Go, Rust, Java
- **Decorator / annotation extraction**: `metadata.decorators[]` for TS, Python, Java, Rust
- **Accurate line ranges**: `startLine`/`endLine` from `node.startPosition.row` / `node.endPosition.row`
- **Graceful regex fallback**: languages without a WASM grammar transparently fall back to the previous regex parser; `parserUsed: 'tree-sitter' | 'regex'` recorded in `meta.json`
- **`serve` auto-upgrade**: if an existing index was built with the regex parser, `code-intel serve` triggers a full re-analysis automatically
- **`runQueryMatches()`** added to `query-runner.ts` for match-level capture correlation; exported from public API
- **Parser corpus tests**: `tests/parser-corpus/` with fixture source files + JSON golden files for 8 languages (Go, Rust, Java, C, C++, C#, PHP, Ruby); CI gate prevents recall regression; 100% recall on all 10 language fixtures

### 🦅 Swift, Kotlin & Dart Support

- **WASM grammars** for Swift, Kotlin, and Dart (dylink.0 format, compatible with web-tree-sitter 0.26.x) stored in `code-intel/core/wasm/` and bundled into `dist/wasm/` at build time
- **`scripts/copy-grammars.mjs`**: copies the three optional WASM grammars into `dist/wasm/` during build; warns gracefully when optional packages are absent
- **`findBundledWasmDir()`** in `parser-manager.ts`: resolves `dist/wasm/` correctly from either `dist/index.js` or `dist/cli/main.js` entry points
- **Swift queries** (`src/parsing/queries/swift.ts`): `class_declaration` with keyword anchors for struct/class/enum; `protocol_declaration` for interfaces
- **Kotlin queries** (`src/parsing/queries/kotlin.ts`): `identifier` (not `type_identifier`) for declarations; `object_declaration` for companion objects/singletons
- **Dart queries** (`src/parsing/queries/dart.ts`): `class_definition`, `function_signature`, `enum_declaration`; wired into `parse-phase.ts`, `parse-phase-parallel.ts`, `queries/index.ts`
- All three languages now parse with tree-sitter — 0 regex fallbacks for Swift/Kotlin/Dart

### ⚡ Performance — 18× Speedup (10k-file repos)

- **Query compilation cache** (`query-runner.ts`): `WeakMap<Language, Map<querySource, Query>>` ensures each `(language, querySource)` pair is compiled once per process lifetime; eliminates ~200s of query compilation overhead on 10k-file repos
- **CSV newline escaping** (`csv-writer.ts`): `escapeNewlines()` converts `\n`→`\\n`, `\r`→`\\r` in content fields; fixes a LadybugDB parallel-reader bug that caused `class_nodes` to fall back to thousands of individual Cypher CREATE statements
- **Hoist `source.split('\n')`** out of per-match loop in `parse-phase.ts` / `parse-worker.ts` — single split per file
- **Result**: 10k-file full analysis improved from ~5 min → ~16 s (18× speedup); incremental 3-changed-file run: 288ms (target < 500ms ✅)

### 🔁 Incremental & Parallel Analysis

- **`--incremental` flag**: only re-parses files changed since last analysis (git diff + mtime-based); re-inserts updated nodes into DB for changed files only; 10k-file repo with 3 changes: **288ms**
- **`--parallel` flag**: parse and resolve phases run on worker threads (`WorkerPool`); leverages all CPU cores for large repos
- **DAG no-op scan phase**: incremental pipeline injects a lightweight no-op `scan` phase to satisfy the DAG validator (`structurePhase` depends on `scan`) without re-scanning the filesystem

### 📦 Self-Contained npm Package

- **Web UI bundled**: `scripts/copy-grammars.mjs` also copies `code-intel/web/dist → dist/web/` at build time; `npm install -g @vohongtho.infotech/code-intel && code-intel serve` works with the full web UI — no monorepo needed
- **`WEB_DIST` resolution** (`src/http/app.ts`): prefers `dist/web/` (global install); falls back to `code-intel/web/dist` (monorepo dev)
- **Package name**: `@vohongtho.infotech/code-intel` (scoped package due to npm name-similarity policy); `bin: { "code-intel": ... }` provides the `code-intel` CLI command after global install

### 🔧 Bug Fixes

- **`fix(storage): PARALLEL=FALSE`** — using LadybugDB's parallel CSV reader with multi-line quoted fields caused a ~60s process-exit hang; `PARALLEL=FALSE` fixes sequential CSV reading and restores clean shutdown
- **`fix(cli): no-op scan phase`** — incremental pipeline DAG validator threw `Phase "structure" depends on missing phase "scan"` when the scan phase was omitted; fixed by injecting a lightweight no-op phase
- **`fix: PhaseResult shape`** — `noopScanPhase.execute()` was returning `{ success, nodesAdded, edgesAdded }` (old shape) instead of the required `{ status, duration }` (`PhaseResult`) shape; TypeScript type error resolved
- **`revert: remove stderr tool logging`** — VS Code labels all MCP server stderr as `[warning]`; removed the 18-tool startup log to keep the MCP log panel clean

### 🛠️ Setup Command

- `code-intel setup` now outputs both Claude Desktop config and VS Code / Cursor `.vscode/mcp.json` snippet
- VS Code config uses `type: "stdio"` with `command: "npx"` + `args: ["@vohongtho.infotech/code-intel", "mcp", "."]`
- Verification hint added: "MCP: List Servers" in VS Code command palette

---

## [0.2.0] — 2026-04-28 — Platform Foundations

> **Theme:** Make the platform safe, operable, and governable.  
> All networked deployments require this release or later.

### 🔐 Security & Authentication

#### Authentication
- **Local account system** (`~/.code-intel/users.db`): `code-intel user create/list/delete/reset-password/set-role`
- **Session management**: HTTP-only cookies, configurable TTL (default 8h), refresh token rotation, CSRF double-submit cookie protection
- **First-run bootstrap**: prompts to create admin if no users exist; `autoLoginOnLocalhost` dev shortcut
- **API tokens**: SHA-256 hashed, `--expires`, `--repos`, `--tools` scoping; revocation takes effect immediately; `CODE_INTEL_TOKEN` env var for MCP
- **OIDC / OAuth2**: `openid-client` integration; supports GitHub, GitLab, Google, Okta, Azure AD; PKCE, auto-provisioning, device flow CLI (`code-intel auth login`), refresh rotation, fallback to local accounts
- **RBAC**: roles `admin | analyst | viewer | repo-owner`; `requireRole`, `requireRepoAccess`, `requireToolScope` Express middleware; audit log on every auth check

#### Transport Security
- `helmet`: CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- CORS: configurable `CODE_INTEL_CORS_ORIGINS` (no `*` in production)
- CSRF: `csrf-csrf` middleware on all state-changing routes
- WebSocket: session token required in handshake
- Payload cap: `express.json({ limit: '1mb' })` → 413 on oversize
- Rate limiting: per-IP (100 req/15min) + per-token (1000 req/15min) via `express-rate-limit`
- TLS reverse proxy guidance: `docs/tls-guidance.md` (nginx + Caddy examples)

#### Secrets & Encryption
- Config validation: rejects plaintext secrets; requires `$ENV_VAR` syntax
- `keytar` OS keychain integration for CLI token storage; graceful fallback to AES-256-GCM encrypted file (`src/auth/secret-store.ts`, scrypt KDF)
- `code-intel auth rotate-token` with 24h grace period
- `chmod 700 .code-intel/` + `chmod 600 *.db` enforced at startup
- Sensitive-data masking extended to stack traces and OTel spans
- Encryption-at-rest guidance: `docs/encryption-at-rest.md` (LUKS, fscrypt, APFS, BitLocker, S3 SSE, SQLCipher roadmap)

---

### 📊 Observability

- **Prometheus metrics** (`/metrics`): counters `http_requests_total`, `pipeline_analyses_total`, `mcp_tool_calls_total`; histograms `http_request_duration_seconds`, `pipeline_phase_duration_seconds`; gauges `pipeline_nodes_total`, `job_queue_depth`, `process_heap_bytes`
- **Grafana dashboard**: `docs/grafana-dashboard.json`
- **Alert rules**: `docs/alert-rules.yml` — HighHTTPErrorRate, HighHeapUsage, CriticalHeapUsage, StaleIndex, HighAuthFailureRate, HighRateLimitHits, GraphSizeDrop
- **OpenTelemetry tracing**: `@opentelemetry/sdk-node` + auto-instrumentation; OTLP exporter; `withSpan` wrapping all HTTP requests, pipeline phases, MCP tool calls; `sanitizeAttrs` strips secrets from span attributes; opt-in via `CODE_INTEL_OTEL_ENABLED=true`
- **Log correlation**: every log line includes `traceId` + `spanId` from active OTel span; `X-Request-ID` header on every response
- **Health endpoints**: `/health/live`, `/health/ready` (503 when index not ready), `/health/startup`, `/api/v1/health` (detailed: nodes, edges, memory, timestamp)
- **Audit log**: every authenticated request written to `users.db` (userId, resource, action, outcome, IP); `/health/*` and `/metrics` excluded

---

### 💾 Backup & Recovery

- `BackupService`: AES-256-GCM encrypted archives of `graph.db`, `vector.db`, `meta.json`, registry, `users.db`; SHA-256 manifest per backup
- `code-intel backup create / list / restore <id>`
- S3 upload support (`CODE_INTEL_BACKUP_S3_*` env vars)
- Automated schedule via cron config (default: daily 2am, `CODE_INTEL_BACKUP_SCHEDULE_*`)
- Retention policy: 7 daily, 4 weekly, 12 monthly
- Data deletion: `code-intel clean` — 30-day soft-delete to `.code-intel-trash-{date}/`; `--purge` for hard-delete
- AI governance: opt-in LLM call log (`CODE_INTEL_GOVERNANCE_LOGGING=true`); no raw source code recorded — model, userId, purpose, token counts only
- DR runbook: `docs/runbooks/disaster-recovery.md` (RTO < 30 min)

---

### 🔁 Reliability

- **Atomic index swap**: writes to `graph.db.new` → renames on success; failed analysis leaves existing DB untouched; `indexVersion` UUID in `meta.json` + `X-Index-Version` response header
- **Durable job model** (`jobs.db`): state machine `pending → running → success | failed | cancelled`; survives process restart; exponential backoff retries (3 attempts: 5s/30s/120s); dead-letter queue; idempotent submission; stuck-job detection (> 30min → auto-fail); `GET /api/v1/jobs`, `DELETE /api/v1/jobs/:id`
- **Schema versioning**: `schemaVersion` in `meta.json`; ordered idempotent `up()/down()` migration runner; auto-backup before every migration; `code-intel migrate --dry-run / --status / --rollback`

---

### 🔌 API Stability & Error Model

- All routes renamed to `/api/v1/...`; old `/api/...` → 301 redirect
- OpenAPI 3.1 spec at `GET /api/v1/openapi.json`; Swagger UI at `/api/v1/docs` (dev only)
- `CI-XXXX` error code registry: CI-1000 (Unauthorized), CI-1001 (Forbidden), CI-1002 (Not found), CI-1042 (DB corrupt), CI-1100 (Rate limit)
- `AppError` class: `{ code, message, hint, requestId, timestamp, docs }`
- Global error handler: all errors → `AppError` JSON; no stack traces in API responses

---

### 🧪 Testing

- Unit test coverage ≥ 80% (`c8`); auth module 100% path coverage
- Parser regression corpus: `tests/parser-corpus/` with TypeScript + Python golden files; CI gate prevents recall regression
- Integration tests: all HTTP routes and auth paths
- **End-to-end test suite**: `tests/integration/e2e/e2e.test.ts` — full lifecycle in-process: analyze → serve → query → backup → restore
- Security tests: OWASP Top 10 automated — auth bypass, path traversal, XSS, regex injection, query injection, payload size, CORS, CSRF, sensitive data leak
- `npm audit --audit-level=high --omit=dev` gate enforced in CI; 0 vulnerabilities

---

### 🚀 Deployment & CI/CD

- `Dockerfile`: Node 22 Alpine, multi-stage, non-root user (uid=1001), `HEALTHCHECK` via `wget`
- `docker-compose.yml`: self-hosted setup with volume mounts, env vars, `no-new-privileges`
- **Multi-arch image**: `linux/amd64` + `linux/arm64`
- **Published to GHCR**: `ghcr.io/vohongtho/code-intel`
- **Image scanning**: Trivy CRITICAL CVE gate; SARIF results uploaded to GitHub Security tab
- **Image signing**: keyless cosign signing via Sigstore OIDC on every release
- **CI/CD pipeline**: typecheck → unit tests → npm audit → license gate → publish npm (with provenance) → build + push multi-arch image → Trivy scan → cosign sign → GitHub Release with CycloneDX SBOM + auto-generated release notes
- **Dependabot**: weekly npm + GitHub Actions dependency updates
- **License gate**: blocks GPL/AGPL/LGPL/CPAL dependencies in CI

---

### 📚 Operational Runbooks

All runbooks in `docs/runbooks/`:

- `disaster-recovery.md` — full data loss recovery; RTO < 30 min
- `stale-wal-cleanup.md` — SQLite WAL growth; safe + forced cleanup procedures
- `index-drift.md` — stale index detection; incremental and forced re-index; Prometheus alert rule
- `llm-outage.md` — embedding failures; automatic BM25 text-search fallback; offline model cache
- `memory-exhaustion.md` — OOM diagnosis; heap tuning; `.codeintelignore` mitigation
- `stuck-job.md` — long-running jobs; cancellation via API and database; root-cause reference table
- `bad-release-rollback.md` — rollback to a previous npm version + schema; target < 15 min
- `auth-provider-outage.md` — corrupted users database; session loss; token recreation; break-glass access

---

### 🔧 Other Changes

- **`.env.example`** — all `CODE_INTEL_*` environment variables documented with defaults, generation commands, and security guidance
- **Dependency upgrades**: `bcrypt` 5→6, `uuid` <14→14 — resolves 3 high CVEs (tar path traversal) and 1 moderate CVE (buffer bounds); `npm audit` clean
- **Docker fix**: changed `codeuser` to uid/gid 1001 to avoid conflict with the built-in `node` user in `node:22-alpine`

---

## [Unreleased] — 2026-04-27

### 🐛 Bug Fixes

#### `fix: wipe stale .wal/.shm DB files before write to prevent corruption`
- `analyzeWorkspace --force`: proactively wipes both `graph.db` and `vector.db` stale files (`.wal`, `.shm`, `-wal`, `-shm` variants) upfront before any write
- `analyze` (non-force): also clears `graph.db` stale journal files before writing
- `analyze --embeddings`: also clears `vector.db` stale journal files before writing
- Fixes `Corrupted wal file. Read out invalid WAL record type` error when running `code-intel analyze --force` after an incomplete or interrupted previous run

#### `fix: remove stale LadybugDB files before re-indexing`
- Removes `.code-intel/graph.db` and related files before writing a new index to prevent `not a valid Lbug database` error on repeated runs

---

### ✨ New Features

#### `feat: serve and mcp load from existing index, skip re-analysis`
- `code-intel serve`: if `.code-intel/graph.db` already exists, loads the persisted graph directly and starts the HTTP server immediately — no re-analysis
- `code-intel mcp`: same — loads persisted graph from DB if index exists, skips pipeline
- Add `--force` flag to `code-intel serve` to force a full re-analysis even when an index exists
- `code-intel serve --force` still runs the full pipeline and overwrites the index

#### `feat: write logs to ~/.code-intel/logs/ with daily rotation`
- Logger always writes to console
- In non-production environments: also writes daily-rotating log files to `~/.code-intel/logs/`
  - File pattern: `YYYY-MM-DD-code-intel.log`
  - Max size: 20 MB per file
  - Retention: 14 days
  - Directory auto-created on first use; gracefully degrades to console-only if directory is unwritable
- Logger is eagerly initialized on import so the log directory is created even in short-running commands
- Structured `Logger.info()` calls added throughout `analyzeWorkspace`: started, DB persisted, embeddings built, skills generated, context files written, completed

#### `feat: add Logger utility and replace console.* with Logger in core modules`
- Add `src/shared/logger.ts` — lightweight singleton logger with sensitive-data masking and no external dependencies (later upgraded to winston)
- Replace `console.*` calls in:
  - `pipeline/phases/parse-phase.ts` — `console.log` → `Logger.info`
  - `multi-repo/group-sync.ts` — `console.warn/log` → `Logger.warn/info`
  - `http/app.ts` — `console.log/warn` → `Logger.info/warn`
  - `cli/main.ts` — internal `console.warn` → `Logger.warn` (intentional CLI UI `console.log` left unchanged)

#### `feat: add progress bars and spinners to all CLI pipeline phases`
- Add `onPhaseProgress` callback to `PipelineContext` for per-item progress reporting
- Each pipeline phase now emits progress:
  - `scan`: after file walk completes
  - `structure`: per file node created
  - `parse:read`: per parallel file-read batch
  - `parse`: per file symbol extraction
  - `resolve`: per file processed
  - `cluster`: per directory cluster
  - `flow`: per entry point traced
- CLI renders animated `█░` progress bars for all pipeline phases:
  ```
    [parse    ] ████████████████░░░░░░░░░░░░░░  53% (80/151)
  ```
- Post-pipeline steps (DB persist, skill generation, context file writing) show a braille spinner:
  ```
    ⠹ Persisting graph to DB…
  ```
- Replace flat `Done in Xms` summary with compact `✅` one-liner:
  ```
    ✅  Done in 431ms  —  705 nodes · 1395 edges · 152 files
  ```

#### `feat: multi-repo aware Web UI and HTTP API`
- Web UI: group panel visible when groups are configured
- HTTP API: group-aware endpoints
- `ConnectPage`: improved connection UX

---

### ♻️ Refactors

#### `refactor: migrate Logger to winston + winston-daily-rotate-file`
- Replace custom console-based logger with [winston](https://github.com/winstonjs/winston)
- Development: daily-rotating file logs (`./logs/%DATE%-code-intel.log`, 20 MB max, 14-day retention) + console
- Production (`NODE_ENV=production`): console transport only
- Log level controlled via `LOG_LEVEL` env var (default: `info`)
- Sensitive-data masking fully preserved
- Timestamp format: ISO 8601 via `winston.format.timestamp()`
- Add `winston` and `winston-daily-rotate-file` to `core/package.json` dependencies

---

### 📖 Documentation

#### `docs: update README with progress bars, logging, and architecture changes` (core README)
- Pipeline phases table updated with performance notes (parallel I/O, O(log n) lookup)
- New **CLI Progress Display** section with example output
- New **📋 Logging** section: log directory, file pattern, size/retention, `LOG_LEVEL` env var, production mode, sensitive-data masking
- Architecture tree updated: added `shared/` Logger entry, updated `cli/` description

#### `docs: update root and shared README with progress bars, logging, storage, and architecture`
- Root `README.md`:
  - Features list: updated CLI feature description; added Structured Logging and Performance bullet points
  - Architecture tree: added `shared/` (Logger) and `multi-repo/` entries; updated `cli/` description
  - Pipeline Phases table: updated with parallel I/O and O(log n) notes; added progress bar example
  - New **CLI Progress Display** section
  - New **📋 Logging** section
  - Storage table: added `~/.code-intel/logs/` row
- `code-intel/shared/README.md`:
  - Fixed repository URL (was `your-username`, now `vohongtho`)
  - Expanded all type definitions with full member lists
  - Fixed npm package name (`code-intel-shared`)

---

### 🔧 Performance (from prior session — included for context)

These improvements were made before commit `d46fee6` and are recorded here for completeness:

- **Parallel file I/O** in parse phase: reads all files in parallel batches of 64 using `Promise.all` + `fs.promises.readFile` instead of sequential sync reads
- **Shared file cache**: parse phase stores all file contents in `context.fileCache`; resolve phase reuses it — eliminates all double disk I/O
- **O(log n) enclosing-function lookup**: replaced O(n²) linear scan with binary search on a sorted per-file function index (`context.fileFunctionIndex`)
- **Expanded scan ignore list**: added `.venv`, `venv`, `.env`, `env`, `__snapshots__`, `.nyc_output`, `storybook-static`
- **File size limit**: skip files larger than 512 KB (generated/minified assets)
- **Ignored file suffixes**: `.d.ts`, `.js.map`, `.d.ts.map`, `.min.js`, `.min.css`
- **O(1) call keyword check**: `CALL_KEYWORDS` changed from `Array.includes()` to `Set.has()`
