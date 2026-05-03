# Changelog

All notable changes to this project are documented in this file.

---

## [0.8.0] — 2026-06-03 — Security & Quality Scanning

> **Theme:** Enterprise-grade security awareness and code quality signals

### 🔐 Hardcoded Secret Detection

- **`SecretScanner`** (`src/security/secret-scanner.ts`): scans string literals from tree-sitter AST for API keys (`sk-…`, `pk_live_…`, `AKIA…`, `xoxb-…`), variables named `*_SECRET / *_PASSWORD / *_TOKEN / *_KEY / *_API_KEY` with non-empty literals, DB URLs, private key headers, and high-entropy strings (Shannon > 4.5 bits/char in sensitive variable names)
- **`metadata.security.secretRisk: boolean`** + `metadata.security.secretPattern: string` tagged on affected nodes
- **`code-intel secrets [path]`** CLI: table of findings (file, line, variable, pattern); `--format table|json`; `--fail-on` exits 1 on any finding; `--fix-hint` suggests env-var migration
- **`secrets` MCP tool**: `{ scope?, includeTestFiles? }` → `{ findings, total }`; test files excluded by default

### 🛡️ OWASP Vulnerability Detection

- **Five detectors** covering SQL Injection (string concat in `db.query` / `knex.raw` / `sequelize.query`), XSS (`innerHTML`, `outerHTML`, `document.write`), SSRF (`fetch`, `axios`, `http.request`), Path Traversal (`fs.readFile`, `path.join`), Command Injection (`exec`, `execSync`, `eval`)
- **`vulnerability` node kind** + **`has_vulnerability` edge kind** added to graph schema; one vulnerability node per finding linked to the affected symbol
- **`code-intel scan [path]`** CLI: runs all detectors; `--type secrets|sql|xss|ssrf|path|cmd`; `--severity high|medium|low`; `--format table|json|sarif`; `--fail-on high|medium`
- **`vulnerability_scan` MCP tool**: `{ scope?, types?, severity? }` → `{ findings: [{ type, severity, file, line, symbol, description, cweId }], total }`; CWE IDs included (SQL=CWE-89, XSS=CWE-79, SSRF=CWE-918, PathTraversal=CWE-22, CmdInjection=CWE-78)

### 📊 Complexity Metrics

- **Cyclomatic complexity**: `1 + (if + else if + for + while + do + case + && + || + ?: + catch)`; stored as `metadata.complexity.cyclomatic`; severity LOW (1–5) / MEDIUM (6–10) / HIGH (11–20) / CRITICAL (>20)
- **Cognitive complexity** (Sonar method): increments for nesting structures with nesting-level penalty; stored as `metadata.complexity.cognitive`
- **`code-intel complexity [path]`** CLI: ranked table with `--top <n>` (default: 20), `--threshold <n>`, `--format table|json`
- **`complexity_hotspots` MCP tool**: `{ scope?, limit? }` → top complex functions

### 🧪 Test Coverage Integration

- **Test file tagging**: `*.test.ts/js`, `*.spec.ts/js`, `*_test.go`, `*_test.py`, `Test*.java` tagged `file.metadata.isTestFile: true`; test functions tagged `metadata.isTestFunction: true`
- **`tested_by` edge kind**: heuristic mapping `users.test.ts` → `users.ts`, test function `test_getUser` → `getUser`, import-based linking; creates `subject → test function` edges
- **`code-intel coverage [path]`** CLI: untested exported symbols sorted by blast radius; coverage % (`tested_exported / total_exported`); `--threshold <pct>` exits 1 below threshold
- **`coverage_gaps` MCP tool**: `{ scope?, limit? }` → untested symbols by risk level

### 🚫 Deprecated API Detection

- **Detection**: `@deprecated` JSDoc (TS/JS), `@Deprecated` Java annotation, `#[deprecated]` Rust attribute, built-in deprecated Node.js APIs (`url.parse`, `fs.exists`, `crypto.createCipher`)
- **`deprecated_use` edge kind** added to graph schema; `metadata.deprecated: true` + `metadata.deprecationMessage: string`
- **`code-intel deprecated [path]`** CLI: report all deprecated usages with caller context
- **`deprecated_usage` MCP tool**: usages with caller context

---

## [0.7.0] — 2026-05-27 — Multi-Repo & Monorepo

> **Theme:** First-class support for large-scale repo structures

### 🗂️ Workspace Auto-Discovery

- **`detectWorkspaceType(root)`**: detects npm/yarn (`workspaces` in `package.json`), pnpm (`pnpm-workspace.yaml`), Nx (`nx.json`), Turborepo (`turbo.json`)
- **`code-intel group init-workspace [path]`**: auto-discovers all packages, prints confirmation list, creates group, analyzes each package, registers all in group; `--name`, `--no-analyze`, `--yes`, `--parallel <n>` (default: 2) flags; progress `[3/8] Analyzing packages/api…` + final summary table

### 🔗 Type-Aware Contract Matching

- **Enriched contracts**: `{ name, kind, parameters: [{name, type}], returnType, exported, filePath }` stored in `~/.code-intel/groups/<name>.sync.json`
- **New scoring formula**: `0.4 × nameSim + 0.3 × paramTypeSim + 0.2 × returnTypeSim + 0.1 × paramCountSim`; Jaccard similarity on normalized type names; `min(1.0, score × 1.2)` confidence boost when name + types match
- `group contracts` output now includes type information

### 📄 API Schema Contract Extraction

- **OpenAPI / Swagger**: scans for `openapi.yaml/json`, `swagger.yaml/json`; extracts all `paths` entries as `ContractKind.schema` with method, path, requestSchema, responseSchema
- **GraphQL**: scans `*.graphql`, `*.gql`, `schema.graphql` via `graphql-js`; extracts `Query` + `Mutation` fields and custom types
- **Protobuf**: scans `*.proto` via `protobufjs`; extracts services, RPC methods, message types as `kind: "grpc"` contracts

### 🔄 Auto-Sync on Analyze

- After `analyzeWorkspace` completes: auto-triggers `group sync` for every group containing the repo; shown as `⠹ Syncing group 'backend-services'…` in analyze output
- `--no-group-sync` flag opts out; group sync failure warns + continues without failing analysis

### 🌐 Cross-Repo Web UI

- `GET /api/v1/groups` and `GET /api/v1/groups/:name/topology` endpoints
- **`GroupPanel`** sidebar section (visible when groups configured): topology graph with repos as nodes and contract edges; edge color by confidence — green (≥0.8), yellow (0.5–0.8), red (<0.5)
- Click edge → contract detail panel; click repo node → switch main graph to that repo

### 🤖 CI/CD Integration

- **`code-intel pr-impact`** CLI: `--base main --head HEAD`; gets changed files via `git diff --name-only`; `--fail-on HIGH|MEDIUM` exits 1 on matching severity; `--format sarif` outputs SARIF 2.1.0 for GitHub Security tab
- **GitHub Action** (`.github/actions/code-intel/action.yml`): analyze → pr-impact → post PR comment with HIGH-risk symbol table → upload SARIF → exit code

---

## [0.6.0] — 2026-05-20 — Smarter AI Tooling

> **Theme:** MCP tools that reason, not just retrieve

### 🧠 New MCP Reasoning Tools

- **`explain_relationship`**: finds all directed paths (max 5 hops, max 10 paths) from `from` → `to`, shared imports, heritage (extends/implements), and generates a natural-language summary; unknown symbol returns name suggestions
- **`pr_impact`**: accepts `{ changedFiles }` or `{ diff }` (parses unified diff); risk scoring per symbol — HIGH (blast radius > 50 or imported by > 10 files), MEDIUM (10–50), LOW (< 10); test coverage check; top 5 files to review; cross-repo impact when in a group
- **`similar_symbols`**: combined score `0.5 × vector + 0.3 × structural + 0.2 × name`; Jaro-Winkler name distance; Jaccard parameter-type similarity; fallback to structural + name when no embeddings
- **`health_report`**: all health signals (dead code, cycles, god nodes, orphan files, complexity hotspots) filtered by `scope` prefix; `scope = "."` for whole-repo; same health score formula as `code-intel health`
- **`suggest_tests`**: finds all call paths through symbol, identifies parameter/return types for boundary suggestions, finds existing test files, identifies untested callers
- **`cluster_summary`**: key symbols (top 5 by caller count), cluster dependencies + dependents, health signals scoped to cluster, symbol counts per kind, AI-derived purpose

### 📄 Pagination for All List Tools

- Added `offset?: number` + `limit?: number` (default: 50; max: 500) to `search`, `clusters`, `flows`, `list_exports`, `file_symbols`
- Response shape: `{ nodes, total, offset, limit, hasMore }`; limit > 500 clamped

### 🔗 Tool-Chaining Hints

- `suggested_next_tools: [{ tool, reason, input }]` in responses for `search`, `blast_radius`, `inspect`, `pr_impact`; input pre-filled with relevant context (e.g. top result name)
- Controlled by `mcp.suggestNextTools: true` (default: true)

---

## [0.5.0] — 2026-05-13 — Query & Exploration

> **Theme:** Let users ask arbitrary questions about their code

### 🔍 Graph Query Language (GQL)

- **GQL parser**: lexer + recursive-descent parser → `QueryAST`; four statement types: `FIND`, `TRAVERSE`, `PATH`, `COUNT … GROUP BY`; WHERE clause with `=`, `!=`, `CONTAINS`, `STARTS_WITH`, `IN`; descriptive parse errors with position info
- **GQL executor**: FIND (filter nodes + LIMIT/OFFSET), TRAVERSE (BFS/DFS with DEPTH), PATH (BFS shortest path), COUNT GROUP BY; 10s timeout returns partial results with `{ truncated: true }`; FIND on 10k-node graph < 100ms
- **`code-intel query "<gql>"`** CLI: `--file <path>`, `--format table|json|csv`, `--limit <n>`, exit code 1 on parse/execution error
- **Saved queries**: `--save <name>`, `--run <name>`, `--list`, `--delete` persisted to `.code-intel/queries/<name>.gql`
- **`POST /api/v1/query`** endpoint: `{ gql, format? }` → GQLResult with `executionTimeMs`, `truncated`, `totalCount`; `POST /api/v1/query/explain` → query plan; requires `viewer` role
- **`query` MCP tool**: `{ gql, limit? }` → `{ nodes, edges?, groups?, executionTimeMs, truncated }`; `raw_query` deprecated with warning

### 👁️ Web UI: Source Code Preview

- **`GET /api/v1/source`** endpoint: `?file=<path>&startLine=<n>&endLine=<n>`; ±20 lines context; path-traversal guard; `viewer` role + repo access required
- **`SourcePanel`** React component: syntax highlighting via `highlight.js` (lazy-loaded per language); symbol's `startLine..endLine` highlighted; "Open in editor" button (`vscode://file/<path>:<line>`); "Copy path" button; resizable, size persisted in localStorage; loading skeleton

### 🖥️ Web UI: Query Console

- **`QueryPanel`** React component: multi-line monospace GQL editor with keyword highlighting; `Ctrl+Enter` shortcut; sortable results table; click result row → select node in graph; query history (last 20 in localStorage); 5 pre-built example queries dropdown

---

## [0.4.0] — 2026-05-06 — Intelligence Layer

> **Theme:** Understand not just structure, but meaning

### 🤖 AI-Generated Symbol Summaries

- **`summarize` phase** (opt-in): runs after `flow` phase with `--summarize` flag or `analysis.summarizeOnAnalyze: true`; targets `function`, `class`, `method`, `interface` nodes only; skips nodes with unchanged code hash (cache)
- **LLM provider backends**: abstract `LLMProvider` interface; **OpenAI** (`openai` package, `$OPENAI_API_KEY`), **Anthropic** (`@anthropic-ai/sdk`, `$ANTHROPIC_API_KEY`), **Ollama** (local HTTP at `localhost:11434`); configured via `llm.provider` in config
- **Rate limiting**: `llm.batchSize` concurrent calls (default: 20); exponential backoff on 429; circuit breaker — 5 consecutive failures → pause 60s; `llm.maxNodesPerRun` cost guard
- **Persisted fields**: `metadata.summary`, `metadata.summaryModel`, `metadata.summaryAt`, `metadata.codeHash`
- **AI governance log**: `~/.code-intel/logs/ai-calls.log` — nodeId + promptLength only, no raw source code

### 🔎 Hybrid Search (BM25 + Vector RRF)

- **Richer embeddings**: input changed to `"[{kind}] {name}\n{signature}\n{summary}"` (fallback to code snippet); `metadata.embeddingSource: 'summary' | 'code'`; re-embeds when summary changes
- **`hybridSearch(query, limit)`** in `SearchService`: runs BM25 + vector search in parallel; Reciprocal Rank Fusion (`score = Σ 1 / (60 + rank_i)`); fallback to BM25-only when `vector.db` absent; `searchMode: 'bm25' | 'vector' | 'hybrid'` in response metadata
- `GET /api/v1/search` and MCP `search` tool updated to use hybrid search

### 👀 File Watcher & Auto-Reindex

- **`FileWatcher`** class (`chokidar`): watches workspace root; respects `.codeintelignore`; debounce 300ms; `watching: true` + `lastWatchEvent` in `/api/v1/health`
- **`IncrementalIndexer.patchGraph(changedFiles[])`**: removes stale nodes/edges, re-runs parse + resolve for changed files, merges new nodes/edges, upserts to DB; does not block HTTP API reads
- **`code-intel watch [path]`** CLI command: alias for serve + forced file watcher
- **WebSocket push**: `ws` package; `ws://localhost:PORT/ws`; session token required; broadcasts `{ type: "graph:updated", indexVersion, stats, changedFiles }` on patch; Web UI shows "Graph updated" toast + green "Live" dot; auto-reconnect with 3s + jitter backoff

### 🏥 Code Health Signals

- **Dead code detection**: exported symbol + zero callers + zero importers → `metadata.health.deadCode: boolean`; excludes entry points, test files, `@deprecated` symbols
- **Circular dependency detection**: Tarjan's SCC on import graph; SCC size > 1 = cycle; `metadata.health.inCycle: boolean` + `metadata.health.cycleId: string`; < 100ms on 10k-node graph
- **God node detection**: > 20 methods OR > 50 callers → `metadata.health.isGodNode: boolean` + `metadata.health.godReason: string` (thresholds configurable)
- **Orphan file detection**: no imports + no importers → `file.metadata.health.orphan: boolean`; excludes config files, test fixtures, `*.d.ts`
- **`code-intel health [path]`** CLI: summary table (dead code count, cycle count, god classes, orphan files, health score); `--dead-code`, `--cycles`, `--orphans` detail flags; `--json`; health score formula `100 − (deadCode×0.5 + cycles×5 + godNodes×2 + orphans×1)`; exit code 1 when score < threshold (configurable)
- `health` field added to MCP `overview` tool response

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
