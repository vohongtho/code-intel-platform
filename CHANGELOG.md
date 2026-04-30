# Changelog

All notable changes to this project are documented in this file.

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
