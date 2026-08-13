# Changelog

All notable changes to this project are documented in this file.

---

## [1.0.10] - 2026-08-03

### 🗃️ Generation V2

- Added a true no-op analysis plan that preserves the active generation when source and index state are unchanged.
- Added repository-level analysis locking, selective artifact seeding, reflink-first cloning, pinned index snapshots, and stale staging cleanup.
- Changed known source updates to rebuild graph/BM25 while cloning only the healthy vector database required for incremental vector mutation.
- Updated index trust verification to read graph, BM25, vector, and metadata from one pinned generation snapshot.
- Stabilized published-generation ownership: `code-intel serve` now treats published vector artifacts as read-only, degrades to BM25 when vectors are missing/stale/incompatible/corrupt, and reports guidance to run `code-intel analyze --embeddings` instead of rebuilding in place.
- Hardened staging cleanup so lock-owned, remote-host, recent, or otherwise uncertain `.staging-*` directories are preserved and delete-time ownership is revalidated before removal.
- Replaced stale analyze-lock `read + rmSync` recovery with an ownership-safe atomic claim protocol; release and manual unlock now remove only the claimed lock instance and fail closed when ownership cannot be proven.
- Enforced fail-closed explicit scope validation across HTTP, MCP, and query-explain paths: malformed `scope` now returns 400, unknown explicit repo/group targets preserve 404, and malformed MCP scope no longer widens to the default repository.
- Fixed `code-intel setup [path]` to emit MCP configuration for the resolved selected repository root, not ambient `.`.
- Fixed true no-op analyze flows so explicit `--name` validation and relink/rename reconciliation still run before exit.

### 🤖 Agent-aware setup

- `code-intel setup` now reads `.code-intel/agent-targets.json` and installs only selected-agent global integrations.
- Setup no longer creates project-scoped `.cursor`, `.github`, `.kilocode`, `.agents`, `.clinerules`, `.windsurfrules`, or `AGENTS.md` files.
- Added `setup [path]`, `--mcp-only`, `--all-agents`, and `--dry-run` behavior.
- `code-intel mcp` no longer auto-analyzes unindexed repositories on startup; it now keeps the MCP connection open and graph-backed tools tell users to run `code-intel analyze` first.
- After a later explicit `code-intel analyze`, the next graph-backed MCP tool call auto-reloads without requiring reconnect.
- Recommended MCP first-run sequence is now `code-intel analyze && code-intel setup`.

### 🧠 Embedding model selector

- Added backend embedding model registry with canonical `Xenova/all-MiniLM-L6-v2` default, legacy short-ID normalization, and availability reporting without triggering model downloads.
- Added authenticated `GET /api/v1/embeddings/models` plus Web client catalog loading and structured malformed-response handling.
- Replaced the Settings Embeddings Model free-text input with a disabled-aware selector that shows canonical model metadata and unsupported legacy values.
- Config validation now rejects unknown or unavailable embedding models when embeddings are enabled and persists the canonical ID.
- Embedding runtime, fingerprint metadata, and vector-index rebuild decisions now derive model ID and dimension from the selected descriptor.

---

## [1.0.9] - 2026-07-31

### 🧠 Incremental vector update correctness

- Decoupled vector update scope from graph execution mode.
- One-file source changes still use a correctness-first full graph rebuild, but now delete/upsert embeddings only for changed files.
- Deleted files remove only their own vectors; unchanged vectors are preserved.
- Zero-change runs preserve the vector database without writes.
- Full vector rebuilds are limited to first use, `--force`, missing vector storage, stale/incompatible metadata, or unknown change scope.
- Added exhaustive planner unit tests and CLI regression coverage.

---

## [1.0.8] - 2026-07-31

### 🧭 Correctness-first incremental analysis

- Detects committed, staged, unstaged, untracked, mtime-changed, and deleted paths together.
- Prevents partial incremental publication from losing cross-file `calls`, `imports`, `extends`, `implements`, clusters, flows, or generated metadata.
- Keeps the zero-change fast path; any non-empty changed/deleted set performs a clean full graph rebuild in v1.0.8.
- Adds unchanged caller/importer/inheritor regression coverage and canonical graph equivalence against a forced clean rebuild.

### 🧩 Parser metadata migration

- Fixed v1.0.7 → v1.0.8 migration/zero-change analysis metadata so a tree-sitter index is not incorrectly rewritten as `parser: regex`; `code-intel serve` now accepts the rebuilt index without requesting another analysis.
- Legacy indexes that genuinely have `parser: regex` or no parser provenance remain blocked until a real tree-sitter rebuild succeeds.

### 🔍 Truthful vector fallback reporting

- Hybrid search records vector status as `unavailable`, `failed`, `empty`, or `success`.
- Missing, unbuilt, or empty vector execution maps to `VECTOR_INDEX_UNAVAILABLE`.
- Vector execution exceptions map to `VECTOR_QUERY_FAILED`.
- Adds fallback contract regression tests.

### 🗃️ Atomic index and release safety

- Adds atomic graph/BM25/vector/metadata generation publication with rollback safety.
- Adds index trust/freshness diagnostics, strict whole-document token budgeting, and Change Context Pack transports.
- Release Readiness validates package metadata, distributable build, npm pack, CLI version, atomic publication, trusted index state, dirty-tree handling, canonical graph equivalence, and security audit.

---

## [1.0.7] - 2026-07-29

### 🧭 Incremental analyze state consistency

- Fixed incremental `code-intel analyze` so plain auto-incremental and explicit `--incremental` runs preserve full-repository graph state instead of persisting changed-file-only or zero-node results.
- Added deletion-aware incremental decision output in `code-intel/core/src/pipeline/incremental.ts` (`decideIncremental`) and fresh full-workspace `lastAnalyzedMtimes` publication, so removed paths no longer linger in metadata.
- Updated `code-intel/core/src/cli/app.ts` (`analyzeWorkspace`) to load the previously published graph before patching, skip graph/BM25 rebuilds on zero-change incremental runs, keep `code-intel status` counters truthful for the full repository, and preserve an existing healthy `vector.db` on repeated no-change `code-intel analyze --embeddings` runs instead of rebuilding vectors.
- Extended `code-intel/core/src/pipeline/incremental-indexer.ts` (`IncrementalIndexer.patchGraph`) and `code-intel/core/src/search/bm25-index.ts` (`Bm25Index.updateNodes`) so changed files and deleted paths share one removal/update contract across graph DB and BM25 state.
- Added CLI regression coverage in `code-intel/core/tests/integration/cli/analyze-incremental-consistency.test.ts` and `code-intel/core/tests/integration/cli/analyze-embeddings.test.ts` for no-change preservation, deletion-safe fallback cleanup, repeated `--embeddings` zero-change preservation, and zero-change remembered-embeddings behavior.
- Security check: `code-intel scan --severity high --format json` still reports pre-existing HIGH findings (24 current total, including the long-standing git-shell use in `incremental.ts`); no new HIGH finding was introduced by this change's touched persistence paths.

### 🔍 MCP search mode + context tool

- Added MCP `search.mode` support with `auto | bm25 | vector`, preserving existing default behavior when omitted while allowing callers to force BM25-only search or prefer vector search with BM25 fallback.
- Routed MCP `search` through the same shared scoped-search executor used by HTTP by extracting `code-intel/core/src/search/execute-scoped-search.ts` and wiring both `code-intel/core/src/http/app.ts` and `code-intel/core/src/mcp-server/server.ts` to it, closing the MCP gap left after scoped-search unification.
- Added MCP `context` tool as a thin wrapper around `code-intel/core/src/context/builder.ts`, exposing structured `summary`, `logic`, `relation`, `focusCode`, and `truncated` fields for one or more resolved seed symbols with `intent` and `max_tokens` controls.
- Added MCP regression coverage in `code-intel/core/tests/unit/mcp-server/search-tool.test.ts` and `code-intel/core/tests/unit/mcp-server/context-tool.test.ts` for explicit search modes, default-mode parity, partial/total unresolved context seeds, explicit intent, and token-budget clamping.
- Affected files and symbols include `code-intel/core/src/search/execute-scoped-search.ts` (`executeSearchRequest`, `normalizeSearchRequest`), `code-intel/core/src/http/app.ts` (`createApp` scoped search handlers), `code-intel/core/src/mcp-server/server.ts` (`createMcpServer`, `dispatchTool`, MCP `search`, MCP `context`), `code-intel/core/src/context/builder.ts` (`build`, `detectQueryIntent`), `code-intel/core/tests/unit/mcp-server/search-tool.test.ts`, and `code-intel/core/tests/unit/mcp-server/context-tool.test.ts`.

## [1.0.6] - 2026-07-27

### 🔎 Scoped search unification

- Added canonical scoped search contract around `POST /api/v1/search`, centered on explicit `scope` plus `mode` metadata.
- Kept `POST /api/v1/vector-search` and `POST /api/v1/groups/:name/search` as compatibility adapters during migration, with deprecation metadata and normalized scope/mode reporting.
- Normalized legacy flat `repo` / `group` request shapes into explicit scope, and rejected ambiguous mixed request shapes.
- Extended group search execution to support deterministic RRF-merged vector/hybrid behavior with per-repo attribution and graceful BM25 fallback when vector indexes are unavailable.
- Updated affected search symbols and files including `code-intel/core/src/http/app.ts`, `code-intel/core/src/multi-repo/group-query.ts`, `code-intel/core/src/mcp-server/server.ts`, `code-intel/core/src/http/openapi.ts`, `code-intel/web/src/api/client.ts`, `code-intel/web/src/components/shared/Header.tsx`, `code-intel/web/src/components/panels/SearchBar.tsx`, `code-intel/web/src/components/panels/SidebarChat.tsx`, and `code-intel/web/src/ai/agent.ts`.


### 🐳 Docker publish arm64 build validation

- Bumped `code-intel/core/package.json` from `@ladybugdb/core@^0.15.4` to `^0.18.3`, and refreshed `package-lock.json`, so Docker `npm ci` can resolve the published `@ladybugdb/core-linux-arm64` prebuilt package instead of falling back to the failing source-build path.
- Added `scripts/verify-docker-publish.mjs` plus root `package.json` script `verify:docker-publish` to validate the Docker publish build path for `linux/amd64` and `linux/arm64`.
- Updated `.github/workflows/publish.yml` validate job to run Docker publish verification before release publishing.
- Updated `.github/workflows/release-validate.yml` to add Docker build validation and Trivy image scanning, including SARIF upload and CRITICAL-CVE gating.
- Updated `Dockerfile` base and production stages to install `npm@12.0.1`, removing the vulnerable bundled npm `tar@7.5.11` that Trivy still detected in the Node 22 Alpine base image.
- Preserved the runtime container contract in `Dockerfile`: `USER codeuser`, `EXPOSE 4747`, and `node /app/code-intel/core/dist/cli/main.js serve /data --port 4747`.

### 🐛 Fixed SPA routing: /explore and other routes now work on reload

**Problem**: Reloading any SPA route (`/explore`, `/settings`, `/login`, etc.) in the browser returned a `CI-1002: Not found` error instead of serving the React application. Users could navigate to these routes within the app, but direct access via URL or browser reload failed.

**Root Cause**: A regression introduced in commit 2104435 (April 26, 2026) changed the Express catch-all route from valid syntax `app.get('*', ...)` to invalid syntax `app.get('/{*path}', ...)`. This hybrid pattern doesn't exist in Express.js, so the route was never registered. Requests fell through to the 404 error handler. Additionally, the catch-all was positioned before `/admin` routes, which would have broken admin API calls if the syntax had been valid.

**Changes**:
- Fixed Express catch-all route syntax: `'/{*path}'` → `'*'` (valid Express wildcard)
- Moved SPA catch-all to correct position: after all API/admin routes, before error handlers
- Added comprehensive documentation comments explaining route order requirements
- Added E2E test suite (`tests/e2e/spa-routing.test.ts`) with coverage for:
  - All 7 SPA routes return HTML on direct access
  - API routes continue returning JSON (unaffected by catch-all)
  - Admin routes continue returning JSON
  - Error handling (API 404 vs SPA catch-all)
- Added production smoke test script (`scripts/smoke-test.sh`) for post-deployment verification
- Added npm scripts: `test:e2e`, `test:all`, `test:e2e:watch`

**Impact**: This bug existed for 3 months (April 26 - July 26, 2026) and affected all users attempting to:
- Reload any SPA route in the browser
- Access SPA routes via direct URL
- Bookmark SPA routes
- Share deep links to the application

**Why It Wasn't Caught**:
- Express silently ignores invalid route patterns (no error thrown)
- Development mode (Vite dev server) has built-in SPA fallback that masked the issue
- Production testing was insufficient (no E2E tests for SPA route reloading)
- The syntax change was buried in a massive 4,500+ line commit focused on multi-repo features

**Testing**: All SPA routes now have E2E coverage. Run `npm run test:e2e` to verify. Deploy verification: `./scripts/smoke-test.sh <server-url>`

**Files Modified**:
- `code-intel/core/src/http/app.ts` - Fixed route syntax and positioning
- `code-intel/core/tests/e2e/spa-routing.test.ts` - New E2E test suite
- `code-intel/core/package.json` - Added test:e2e scripts
- `scripts/smoke-test.sh` - New production verification script

**Related**: User report 2026-07-26T01:10:38.389Z, OpenSpec change `fix-spa-routing-reload`

---

## [1.0.5] - 2026-07-24

### 🎯 `code-intel scan` false-positive reduction

Fixed three confirmed false-positive mechanisms in the security-signal detectors (`code-intel/core/src/pipeline/security-signals.ts`, `code-intel/core/src/security/vulnerability-detector.ts`), found by dogfooding `code-intel scan` against this repo:

- **`buildFlags` — sibling-argument taint bleed.** `hasUserInput` was computed over the sink's full joined argument list instead of just the tainted argument, so any `fetch(url, { body: ... })`-shaped call matched on an unrelated options-object key (`body`/`params`/`query`) regardless of the URL's actual content. Now scoped to the tainted argument alone. Fixed all 15 SSRF false positives in `code-intel/web/src/api/client.ts` plus several previously-undocumented ones elsewhere (`backup-service.ts`, `extensions/vscode/src/extension.ts`, `llm/providers/custom.ts`, `db-manager.ts`, `scripts/add-shebang.mjs`).
- **`extractJsSecuritySignals`'s generic SQL fallback — non-relational receiver blind spot.** The unconditional `\w+\.query`/`\w+\.execute` regex matched on method name alone, with no signal about the receiver's actual engine, so `DbManager.query()` (wrapping the embedded graph/Cypher engine `@ladybugdb/core`) was flagged as SQL injection. Now gated behind a new same-file `hasNonRelationalQueryImport()` check (denylist: `@ladybugdb/core`, `kuzu`, `neo4j-driver`, `gremlin`, `arangojs`) plus a SQL-keyword-shape check on the resolved query text.
- **`isDynamic` — no resolution for same-file enumerated parameters.** A template-interpolated identifier was always treated as dynamic even when it was provably drawn from a hardcoded, same-file array via `.some`/`.map`/`.forEach`/`.filter`/`.every`. Added `buildEnumeratedParams()` to resolve this shape; fixed the `commandExists(bin)` command-injection false positive in `code-intel/core/src/cli/init-wizard.ts` (`bin` is only ever drawn from the hardcoded `EDITORS` array).
- Added fixture/regression coverage for all three false-positive shapes plus their corresponding true-positive counterparts in `security-signals.test.ts` and `vulnerability-detector.test.ts`.

**Known residual false positives (out of scope for this fix, tracked as follow-ups):**
- `code-intel/core/src/http/app.ts:1061` (`dbm.query(q)`, SQL_INJECTION) — the non-relational-import check is same-file only; `app.ts` imports `DbManager` from a wrapper module (`storage/index.js`) rather than directly from `@ladybugdb/core`, so the gate can't see the import. Fixing this would require cross-file resolution, which is out of scope (see `design.md` non-goals for this change).
- `code-intel/web/src/api/client.ts:315` and `:402` (SSRF) — a different, previously-masked false-positive mechanism: a generic taint keyword (`params`, `query`) appears inside the *tainted argument itself* (a local `URLSearchParams` variable name, and a literal REST path segment) rather than in a sibling argument. This fix only addressed cross-argument bleed.


### 🖥️ Routed portal settings screen

- Added authenticated Web UI settings routes under `/settings/:section` for global server configuration, with browser back/forward support and router-managed section navigation instead of `#fragment` anchors.
- Added a profile-menu `Settings` entry above `Sign Out` in the portal header.
- Added masked config read and validated config update HTTP endpoints at `/api/v1/config`.
- Added portal config editing for LLM, embeddings, analysis, server, authentication, updates, and telemetry settings.
- Global config reads are available to authenticated viewers; updates require the admin role.
- Logout now clears cached portal settings state so revisiting routed settings URLs redirects cleanly through auth.
- Affected files and symbols include `code-intel/web/src/components/shared/Header.tsx` (`handleLogout` + settings navigation), `code-intel/web/src/App.tsx` (`AppContent` route table), `code-intel/web/src/api/client.ts` (`ApiClient.getConfig` / `ApiClient.saveConfig`), `code-intel/core/src/http/app.ts` (`createApp` + `/api/v1/config`), `code-intel/core/src/cli/init-wizard.ts` (`loadConfig` / `saveConfig` via configurable global config path), `code-intel/core/src/cli/config-manager.ts` (`maskConfig` / `validateConfig`), `code-intel/web/src/pages/SettingsPage.tsx`, and `code-intel/web/src/routing.ts`.

### ⚡ Plain analyze auto-incremental

- Plain `code-intel analyze` now auto-attempts incremental graph reindexing when valid prior `.code-intel/meta.json` exists and the existing safety checks pass.
- Explicit `--incremental` and `--force` semantics are unchanged.
- CLI output now distinguishes auto-incremental mode from full-analysis fallback and reports fallback reasons when plain analyze cannot safely increment.
- Remembered embeddings now follow plain analyze's chosen graph mode, so changed-file-only graph refresh also keeps changed-file-only vector upkeep when safe.

### 🧠 Sticky embeddings on analyze

- `code-intel analyze --embeddings` now remembers semantic-search preference per repository in `.code-intel/meta.json`.
- Later plain `code-intel analyze`, `code-intel analyze --incremental`, and `code-intel analyze --force` runs now auto-enable embeddings for remembered repositories unless `--skip-embeddings` is passed.
- Persisted embedding metadata now records enablement, readiness/staleness, provider, model, and vector dimension so the CLI can detect stale or incompatible vector state.
- Repositories with legacy `vector.db` but no embedding metadata now normalize automatically on the next analyze; no manual migration command is required.
- Missing, stale, corrupted, or fingerprint-mismatched vector indexes now rebuild from `code-intel analyze` without requiring users to remember `--embeddings`.
- `--skip-embeddings` is now documented as a one-run override that preserves remembered preference and leaves embeddings marked stale until refreshed.
- `code-intel doctor` now reports remembered embedding readiness/staleness and recovery guidance uses `code-intel analyze` for rebuilds.
- Updated README and CLI guide text for sticky embeddings behavior and mixed-version compatibility expectations.

### 🗂️ Stable repository identity and unique names

- Added stable repository `id` fields to persisted registry entries while keeping user-facing unique `name` values and mutable `path` values.
- Added automatic migration for legacy registry entries that lacked IDs.
- Added deterministic duplicate-name repair during migration, with warnings when old basename-derived names collide.
- `code-intel analyze` now accepts `--name <name>` and enforces explicit create vs rename vs relink semantics.
- Added `code-intel repo list|show|rename|relink` for repository identity management.
- MCP and HTTP repo resolution now accept stable IDs in addition to names and paths.
- Group membership persistence now stores `repoId` so repository renames do not break group resolution.
- `/api/v1/repos` now includes repository IDs in responses.
- Updated CLI help and README guidance for repository naming, duplicate validation, rename, and relink workflows.


### 🛡️ Vulnerability scan generic-tier precision

- Forced `@hono/node-server` to `2.0.11` in the owned workspace dependency graph to remove the moderate npm audit finding inherited through `@modelcontextprotocol/sdk`; validation confirmed `npm test` still passes after the override.
- Vulnerability scanning for non-JS/Python languages (Go, Java, C, C++, C#, Rust, PHP, Kotlin, Ruby, Swift, Dart) now uses case-insensitive sink matching, fixing silent misses on lowercase or case-variant function names (e.g., PHP's `readfile()`).
- SQL injection detection for generic-tier languages now recognizes ORM raw-query methods (`whereRaw`, `selectRaw`, `orderByRaw`, `havingRaw`, `updateRaw`) in addition to generic `query`/`execute` patterns.
- XSS detection for generic-tier languages no longer flags bare output statements (`echo`, `print`, `printf`, `write`) that are not inherently HTML-rendering; detection remains active for unambiguous HTML sinks (`innerHTML`, `Html.Raw`, `template.HTML`, `html_safe`, `Response.Write`, `respondText`).
- Vulnerability findings now include a `tier` field (`fixture-tested` or `generic-heuristic`) in their evidence, and generic-heuristic findings report scaled-down confidence values relative to fixture-tested findings with equivalent flags.
- These are intended precision and recall corrections to the always-on generic extraction tier. Existing tool interfaces are unchanged, but `vulnerability_scan` may return different findings (more true positives from case-insensitive matching and ORM sinks, fewer false positives from generic output statements) on the same repository.

### 🛡️ Analyzer accuracy fixes

- Secret scanning now flags common bare and camelCase sensitive names such as `password`, `token`, `secret`, `apiKey`, and `dbPassword` in addition to existing SNAKE_CASE suffix matches.
- Secret scanning now runs high-entropy detection independently of sensitive-name matching, fixing cases where high-entropy literals under non-sensitive names were silently missed.
- Coverage gap detection now recognizes PHPUnit `*Test.php`, Python `test_*.py` and `*_test.py`, and Ruby `*_spec.rb` test-file conventions, preventing misleading `0%` coverage on repos that already have tests.
- Flow tracing now excludes test and fixture targets when tracing from production entry points, avoiding production flows that terminate in unrelated test stubs.
- Health scoring is now normalized by repository size and exposes normalization metadata, so equal absolute issue counts do not penalize large and small repositories identically.
- These are intended output corrections. Existing tool interfaces are unchanged, but `secrets`, `coverage_gaps`, `flows`, and `health_report` may now return different values on the same repository.


### 🐛 CLI output fixes

- Fixed Windows `code-intel --version` noise where CMD could print `The system cannot find the path specified.` before the version.
- Replaced the POSIX-only startup disk-space probe with a safer cross-platform path that skips shell-only checks on Windows.
- Added an early version-only fast path so `code-intel --version` and `code-intel -V` print only the package version without startup hints, prerequisite checks, or update-check side effects.
- Added a lightweight CLI bootstrap that handles version flags before importing the full app module, reducing version-command startup cost.
- Added regression coverage for quiet version-command output, bootstrap-vs-app startup behavior, and the Windows-specific startup-check failure mode.

### 🌐 HTML parser support

- Added HTML as a detected source language in shared and core extension detection.
- Added `tree-sitter-html` to bundled and development WASM grammar resolution paths.
- Added build-time copying of `tree-sitter-html.wasm` for packaged installs.
- Added coverage for HTML language detection, grammar validation wiring, and language-registry support.

### 🔎 Search relevance and performance

- Natural-language symbol search now filters low-value query words and applies deterministic reranking across symbol names, paths, kinds, content, and multi-term coverage.
- Search candidate work is bounded, reducing cost on large repositories while preserving exact-name ranking.
- Added graph-generation-scoped query caching with automatic invalidation when graph node or edge counts change.
- Added deterministic tie-breaking for stable result order across repeated searches.
- Added a 10,003-symbol relevance/performance benchmark with cold `<250ms` and warm cached `<25ms` budgets.

### 🎯 Qualified symbol selection

- Search output now includes copyable qualified selectors for exact follow-up with `inspect` and `impact`.
- Selectors use `<kind>:<percent-encoded-name>@<path>[:line]`; path separators remain readable, for example `method:login@code-intel/web/src/api/client.ts:84`.
- `inspect` and `impact` now share deterministic qualified-selector parsing and resolution.
- Reserved selector characters remain percent-encoded while repository paths stay human-readable.

### ⚠️ Ambiguous symbol handling

- `inspect <symbol>` no longer silently selects the first match when duplicate symbol names exist.
- Ambiguous results now list ranked candidates with kind, name, repository-relative location, and copyable selector.
- Ambiguous non-interactive inspection exits with status `2`.
- Added `--json` output for `search` and `inspect`, including structured ambiguity candidates and selectors.
- Added unit and CLI integration coverage for natural-language ranking, deterministic ordering, cache invalidation, selector escaping, ambiguous inspection, qualified inspection, and qualified impact analysis.

### 🎯 Multi-Layer Exclusion System

- Added `--skip-folders` and `--skip-files` CLI options to `code-intel analyze` for transient per-run exclusions without modifying tracked files.
- CLI flags support both comma-separated values (`--skip-folders tests,examples`) and repeatable invocations (`--skip-folders tests --skip-folders examples`).
- Added `.codeintelignore.local` support for personal developer preferences (automatically gitignored, not tracked in version control).
- Enhanced `.codeintelignore` to support file patterns in addition to directory patterns (e.g., `*.generated.ts`, `config.gen.ts`).
- Implemented smart pattern matching with auto-detection:
  - **Basename match**: `tests` matches any file or folder named "tests" at any depth
  - **Path match**: `src/legacy` matches that specific path from workspace root
  - **Glob match**: `**/*.test.ts` matches all test files recursively
- All exclusion layers combine additively: hard-coded defaults → `.codeintelignore` → `.codeintelignore.local` → CLI flags.
- Hard-coded file suffix exclusions (`.d.ts`, `.js.map`, `.min.js`) now integrated into unified pattern system as glob patterns.
- Pattern compilation and caching optimizes performance: glob patterns compiled once and reused across file checks.
- Added verbose logging (`--verbose`) showing which patterns matched excluded entries and which layer triggered exclusion.
- Updated `ensureGitignore()` to automatically add `.codeintelignore.local` to `.gitignore` during analyze.
- 100% backward compatible: existing `.codeintelignore` files with simple directory names continue to work unchanged.
- Updated README with comprehensive exclusion documentation, pattern type examples, and CLI flag usage.
- Updated analyze command help text with `--skip-folders` and `--skip-files` examples.

---

## [1.0.4] — 2026-07-14 — MCP Freshness, Agent Targeting & Security Scan Expansion

### 🔄 MCP graph freshness

- `code-intel analyze` now publishes `meta.json` only after graph, BM25, and vector index writes complete, preventing MCP reloads from seeing half-written indexes.
- `meta.json` now includes `schemaVersion` and a computed `indexVersion` derived from published index files.
- Metadata writes now use temp-file plus atomic rename.
- MCP graph-backed tools now resolve repo state through a per-repo lazy cache and reload when `meta.json#indexVersion` changes.
- MCP `search(repo: ...)` now uses the selected repo graph, BM25 index, and vector path instead of the startup repo stores.

### 🎯 Agent-targeted context generation

- `code-intel analyze` can persist repo-local coding-agent targets in `.code-intel/agent-targets.json`.
- Interactive first analyze run now uses an OpenSpec-style searchable multi-select for coding agents (`type to filter`, `↑↓`, `Space`, `Enter`).
- Non-interactive runs skip prompts and, when no repo-local selection exists yet, skip agent-targeted context generation.
- `writeContextFiles()` now writes only selected agent outputs and supports custom repo-relative targets.
- JSON target files are supported via a managed `code-intel` key.
- Added builtin target mapping for verified agent files plus custom path/format follow-up prompts for unknown agents.

### 🛡️ Vulnerability scan coverage

- Added language-aware security signal extraction during parsing/resolution for SQL injection, XSS, SSRF, path traversal, and command injection.
- Vulnerability findings now include signal evidence, language, confidence, and severity upgrades for user-controlled flows.
- Added expanded SAST tests, including integration coverage for vulnerability scan behavior.

### ⚙️ Reliability and performance

- `WorkerPool` now supports per-task timeouts, worker termination, replacement, and retry for hung tasks.
- BM25 search now has an in-memory LRU query cache and clears it on rebuild/load/incremental updates.
- LadybugDB node upserts are serialized per connection to avoid single-writer races.
- Added grammar validation coverage and npm package bin target coverage.

### 📦 Dependencies and build

- Bumped package version to `1.0.4`.
- Updated TypeScript, ESLint, Prettier, Vite, LadybugDB, OpenTelemetry, `ws`, and transitive security overrides.
- Added TypeScript 6 DTS compatibility via `ignoreDeprecations: '6.0'` in the core build.

---

## [1.0.3] — 2026-07-13 — Security Dependency Updates

### 🔒 Dependency security fixes

- Resolved 32 npm security vulnerabilities via dependency and lockfile updates.
- Bumped root package dependencies for `@vohongtho.infotech/code-intel` from `^1.0.0` to `^1.0.2`.
- Updated dev tooling patch versions: `@typescript-eslint/*`, Prettier, and Vite.
- Added security overrides for `protobufjs` and OpenTelemetry OTLP transformer protobuf usage.
- Updated `package-lock.json` to capture the remediated dependency tree.

---

## [1.0.2] — 2026-05-10 — Agent Hook System

> **Theme:** Automatic command interception across every major AI coding agent — grep/cat/rg silently rewritten to `code-intel search/inspect` before the LLM ever sees the output

### 🪝 PreToolUse Hook System — Tier 1 (Programmatic, auto-rewrite)

- **`code-intel-hook` binary** — new standalone binary (`dist/cli/hook.js`, ~10KB); starts in ~50ms (vs 850ms for `main.js`); registered as `code-intel-hook` in `package.json` `bin`
- **`hook-rewriter.ts`** — single source of truth for all rewrite rules; four rules:
  - `grep <symbol>` / `rg <symbol>` → `code-intel search "<symbol>"` (rejects regex meta-chars, passthrough flags `-c/-v/-l/-L/-o/-Z`, compound commands, rg structural flags)
  - `cat <source-file>` → `code-intel inspect <stem>` (source extensions only; stdin `-` and write redirects pass through)
  - `head/tail <source-file>` → `code-intel inspect <stem>` (common `-n N`, `--lines=N` flags; `tail -f` passes through)
  - idempotency guard: `code-intel …` prefix never rewrites again; compound `&&`/`||`/`;`/`|` always passes through
- **Claude Code** — installs `PreToolUse` hook in `~/.claude/settings.json`; prepended first so it runs before RTK; format: `hookSpecificOutput + permissionDecision:allow + updatedInput`
- **Cursor** — installs `preToolUse` hook in `~/.cursor/hooks.json`; format: `{ permission: "allow", updated_input: { command } }` or `{}` for no-match
- **Gemini CLI** — installs `BeforeTool` hook in `~/.gemini/settings.json`; format: `{ decision: "allow", hookSpecificOutput: { tool_input: { command } } }`
- **GitHub Copilot** — installs `.github/hooks/code-intel-rewrite.json` (project-scoped); VS Code Chat: `updatedInput` transparent rewrite; Copilot CLI: `deny-with-suggestion` (camelCase `toolName`/`toolArgs` format)
- All hooks: **always exit 0** — non-blocking guarantee; agent command execution is never blocked on any error path

### 🔌 Plugin System — Tier 2 (Plugin API)

- **OpenCode** — installs `~/.config/opencode/plugins/code-intel.ts`; plugin content inlined in binary (no external file dependency after `npm install`); API: `tool.execute.before` + `code-intel rewrite` subprocess
- **OpenClaw** — installs `~/.openclaw/extensions/code-intel/index.ts`; API: `api.on("before_tool_call", handler, { priority: 10 })`; content inlined in binary

### 📝 Rules Files — Tier 3 (Prompt-level, auto-written by `analyze`)

- **Cline / Roo Code** → `.clinerules` (project root)
- **Windsurf** → `.windsurfrules` (project root)
- **Kilo Code** → `.kilocode/rules/code-intel-rules.md`
- **Google Antigravity** → `.agents/rules/code-intel-rules.md`
- **Codex CLI** → appended to `AGENTS.md` (already written by `context-writer.ts`)
- All files written by `writeContextFiles()` on every `code-intel analyze`; idempotent (markers-based upsert, never overwrites custom content)

### ⚙️ `code-intel setup` — Full Agent Registration

- Now installs hooks for **all 9 agents** in a single command: Claude Code, Cursor, Gemini CLI, GitHub Copilot, OpenCode, OpenClaw, Cline, Windsurf, Kilo Code, Antigravity, Codex
- All installs are idempotent (reports `already present` on re-run)
- Backup + atomic write (`tmp → rename`) for all JSON config files
- Graceful skip with informative message for agents not installed (no directory found)

### 🏗️ Build

- `tsup.config.ts` — added `cli/hook` build target: `external: [/^node:/]` only; keeps binary tiny (~10KB); no OTel, no DB, no graph
- `scripts/add-shebang.mjs` — adds shebang to both `dist/cli/main.js` and `dist/cli/hook.js`
- `package.json` — added `"code-intel-hook": "dist/cli/hook.js"` bin entry

---

## [1.0.1] — 2026-05-03 — Token Efficiency

> **Theme:** ~63% fewer tokens per AI session — faster, cheaper, smarter LLM interactions

### 🪶 Part A — MCP Server Token Reduction

- **Compact JSON responses** — `null`/`undefined` fields stripped; no pretty-print; ~25–35% fewer tokens per response
- **`suggested_next_tools` opt-in** — disabled by default (was opt-out); re-enable with `CODE_INTEL_SUGGEST_NEXT_TOOLS=true`; saves ~80–120 tokens/call
- **Lower default limits** — `search`, `file_symbols`, `list_exports`, `clusters`, `flows` default to **10 results** (was 50); ~60–80% fewer tokens for typical lookups; max still 500
- **Lower default hops** — `blast_radius` and `pr_impact` default to **2 hops** (was 5); ~40–60% fewer tokens for impact analysis; max still 10
- **Schema descriptions updated** — all affected tools reflect new defaults (e.g. `"default: 10, max: 500"`, `"default: 2, max: 10"`)
- **Tests** — `tests/unit/mcp/pagination.test.ts` covers compact JSON, null stripping, limit defaults, hops defaults, suggest opt-in

### 🧩 Part B — Context Builder (`src/context/`)

- **`builder.ts`** — new module; builds a structured `ContextDocument` from seed symbols in ≤50% of v1.0.0 token baseline
  - **B.1 SUMMARY block** — one-line format: `{name} [{kind}] {path}:{line} {badges} — {1-sentence summary}`; ⚠ god-node badge, 👻 orphan badge; cluster grouping when ≥3 symbols share a directory
  - **B.2 LOGIC block** — ≤5 callees → single inline line (`A → b, c, d`); shared callees (≥3 nodes) collapsed to `(all above → Logger, DB)`; call pairs tracked for cross-block dedup
  - **B.3 RELATION block** — callers capped to top 3 + `(+N more — use blast_radius for full list)`; ⚡ prefix for high blast radius (≥5 callers); logic↔relation duplicates skipped
  - **B.4 FOCUS CODE block** — adaptive snippet: ≤10 meaningful lines → full; 11–25 → 25 raw lines; >25 → 40 raw lines; short symbols already referenced in LOGIC are skipped; `refinedScore < 0.3` → signature-only (`// (low relevance)`)
  - **B.5 Dynamic budget rebalancing** — unused tokens from SUMMARY/LOGIC/RELATION roll forward to FOCUS CODE; query-intent presets: `code` (5,000 tok focus), `callers` (2,500 tok relation), `architecture` (1,200 tok summary), `auto` (balanced default)
  - **B.6 DedupeRegistry** — full info on first symbol mention; name-only on repeats; tracks call pairs, file paths, and logic references across all blocks
- **`token-counter.ts`** — `estimateTokens()` (±10% of GPT tokenizer for code+prose mix); `measureBlocks()` returns per-block counts
- **`code-intel context <symbols...>`** CLI — `--show-context` prints per-block token breakdown; `--intent code|callers|architecture|auto`; `--max-tokens <n>`
- **Tests** — `tests/unit/context/builder.test.ts`, `tests/unit/context/token-counter.test.ts`; CI benchmark gate `tests/integration/context/token-benchmark.test.ts` (4 scenarios: simple ≤1,000 tok, blast radius ≤2,000 tok, code review ≤3,000 tok, architecture ≤3,500 tok ✅)

### ✍️ Context Files — Enforced Tool Policy

- **`context-writer.ts`** — `buildBlock()` now inserts a `TOOL POLICY: ENFORCED` block at the top of every managed section in all 5 generated files
  - `FORBIDDEN: grep, rg, find, cat, sed, ls` for symbol/code discovery
  - Required workflow before any code action: `code-intel search "<concept>"` → `code-intel inspect <symbol>` → `code-intel impact <symbol>`
- **"Never Do" section strengthened** — explicit waste estimate added: _"STOP — do not call grep, rg, find, cat, sed, or read a file cold. Violating this wastes ~3,000 tokens per lookup and degrades session quality."_
- Applies on every `code-intel analyze` to all 5 files: `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `.cursor/rules/code-intel.mdc`, `.kiro/steering/code-intel.md`

### 🔧 Bug Fixes & Quality-of-Life

- **Auto-update `.gitignore`** — `code-intel analyze` now automatically appends `.code-intel/` to the project's `.gitignore` if not already present; creates the file if it doesn't exist; idempotent (skips if `.code-intel` or `.code-intel/` already listed); errors caught and logged as warnings, never abort analysis
- **"Remember Me" on login screen** — new checkbox below the Password field; when checked, the session cookie is set to **12 hours** (`Max-Age`) so re-opening the browser tab within that window keeps the user signed in; unchecked uses the normal session TTL (default 8 h, `CODE_INTEL_SESSION_TTL_HOURS`); sliding-window renewal uses the original TTL of the session; `POST /auth/login` now accepts optional `rememberMe: boolean` in the request body
- **Password visibility toggles on auth forms** — login and first-run bootstrap password fields now provide accessible eye-icon toggles to show or hide the current value without affecting validation or submit behavior; username placeholders in the login and bootstrap UI now read `User Name`

### 📊 Token Savings Summary

| Operation | v1.0.0 | v1.0.1 | Saving |
|-----------|--------|--------|--------|
| `search` (default results 50 → 10) | ~1,000 tok | ~180 tok | **−82%** |
| `blast_radius` (default hops 5 → 2) | ~1,500 tok | ~300 tok | **−80%** |
| `inspect` (null fields stripped) | ~500 tok | ~200 tok | **−60%** |
| `suggested_next_tools` (now off) | ~100 tok | ~0 tok | **−100%** |
| Context builder `[SUMMARY]` | ~800 tok | ~400 tok | **−50%** |
| Context builder `[LOGIC]` | ~1,500 tok | ~600 tok | **−60%** |
| Context builder `[FOCUS CODE]` | ~2,500 tok | ~1,500 tok | **−40%** |
| **Typical 5-tool AI session** | **~12,000 tok** | **~4,500 tok** | **−63%** |

---

## [1.0.0] — 2026-05-03 — Scalability & Production Stability

> **Theme:** Production-ready for 100k-file repos at enterprise scale

### 🚀 Epic 1 — Lazy Graph Loading for Serve

- **`LazyKnowledgeGraph`** — nodes not loaded into memory on startup; fetched from DB on demand with LRU cache
- **LRU cache** — keeps last N nodes in memory (default: 5,000; `GRAPH_CACHE_SIZE` env var)
- **Background warm** — pre-loads top-N highest-blast-radius nodes on startup
- **Paginated graph API** — `GET /api/v1/graph/:repoId/nodes?limit=100&offset=0`; single-node fetch without full graph load
- **Web UI progressive loading** — loads visible nodes first; fetches neighbors on pan/zoom
- **Serve startup** — only loads `meta.json` + node/edge counts on startup; no full graph load

### 🔎 Epic 2 — Pre-Built BM25 Index

- **Inverted index** — built at analysis time and stored in `bm25.db` (SQLite); replaces O(n) linear scan
- **On-startup load** — BM25 index loaded into memory on `serve` startup
- **Incremental updates** — only terms for changed nodes are rewritten on re-index
- **LIMIT pushdown** — applies limit before full score sort
- **LRU query cache** — repeated normalized BM25 queries served from a 128-entry LRU cache; clears on build/load/incremental update
- **TypeScript 6 DTS compatibility** — `ignoreDeprecations: '6.0'` scoped to `tsup` DTS build so TS 5.9 test builds keep working
- **Throughput** — 2,000+ queries/s on 1k-node graphs (target: 1,000 q/s ✅)

### 🧠 Epic 3 — Memory-Efficient Graph Representation

- **`CompactKnowledgeGraph`** — `Int32Array`-packed adjacency, `Float32Array` for edge weights
- **Symbol interning** — deduplicates repeated filePaths and kinds; ≥30% memory reduction verified
- **Numeric IDs internally** — mapped to string IDs for API; no breaking change
- **`--max-memory <MB>` flag** — limits graph memory; spills node content to DB when exceeded

### 📊 Epic 4 — Pipeline Profiling & Telemetry

- **`code-intel analyze --profile`** — writes `.code-intel/profile.json` with per-phase timing and memory data
- **Memory per phase** — `process.memoryUsage().heapUsed` captured before/after each phase
- **Bottleneck detection** — warns if any phase > 50% of total time
- **Verbose phase timing table** — printed in `--verbose` mode: phase name, duration, memory delta

### 🏋️ Epic 5 — Load & Soak Tests

- **1k-file load test** — analyze < 500ms; serve startup < 2ms; heap < 100 MB ✅
- **BM25 throughput** — 2,000+ q/s verified against 1k-node graph ✅
- **100 concurrent HTTP requests** — p95 < 100ms; error rate 0% ✅
- **Memory-stability soak** — 10 analysis cycles; total heap growth < 10 MB ✅
- **Watcher throughput soak** — 30 saves; p95 re-index < 15ms ✅
- **`tests/perf/baseline.json`** — performance targets committed to repo
- **`tests/perf/load-test.mjs`** — nightly CI load test with regression gate (>20% → fail)
- **`tests/perf/soak-test.mjs`** — weekly CI soak tests (memory-stability, watcher-throughput)
- **`.github/workflows/nightly.yml`** — 1k + 10k fixture load tests on every nightly build
- **`.github/workflows/weekly.yml`** — soak tests every Saturday

### 🛡️ Epic 6 — Graceful Degradation

- **DB unavailable → stale graph** — `X-Stale: true` + `X-Stale-Since: <ISO>` headers on all responses when meta.json is unreadable
- **DB reconnect** — stale headers cleared automatically when meta.json becomes readable again
- **LLM API unavailable** — summarize phase skips gracefully; logs warning; analysis still completes
- **MCP tool timeout** — tools exceeding 30s return `{ truncated: true, partialResults: [] }` instead of crashing the MCP session (configurable via `CODE_INTEL_MCP_TIMEOUT_MS`)
- **File watcher crash** — patchGraph errors caught and logged; watcher continues; server unaffected
- **Worker thread crash** — WorkerPool restarts worker and re-queues work; analysis continues

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

#### `fix: normalize GQL aggregate results and prevent Query Console crashes`
- Normalized every successful GQL response to a stable transport contract: `{ kind, nodes, edges, groups, path, executionTimeMs, truncated, totalCount }`
- Added `GQLResultKind` with `nodes`, `traversal`, `path`, and `aggregate` variants
- Updated executor paths so `FIND`, `TRAVERSE`, `PATH`, and `COUNT` all return complete collection fields
- Preserved aggregate semantics: grouped counts remain descending; missing group values still bucket under `(none)`
- Added HTTP validation for successful query results before serialization; malformed internal results now return structured `500` responses without stack traces
- Kept `400` for missing `gql`, `422` for parse errors, and current `408` truncated-result behavior
- Updated OpenAPI and README docs to document the normalized contract
- Added Web runtime normalization so legacy aggregate responses that omit `nodes`, `edges`, `path`, and `kind` still render safely
- Query Console now renders by `result.kind`, shows explicit empty states, keeps metadata visible, and contains render-time failures locally instead of crashing the UI
- Added regression coverage for grouped COUNT, plain COUNT, FIND/TRAVERSE/PATH result shapes, malformed internal `500` responses, legacy aggregate normalization, non-JSON API failures, and Query Panel aggregate/traversal/path rendering


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
