# Changelog

All notable changes to this project are documented in this file.

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
