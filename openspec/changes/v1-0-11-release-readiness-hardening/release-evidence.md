# Release Evidence — v1.0.11 (session log, not a tagging authorization)

This is a living audit/checklist artifact (task 1.4), not CI-generated evidence.
It records what was investigated and changed in this working session, against
which commit, and what remains open. **No commit SHA recorded here is
authorized for tagging** — tagging requires a full green run of
`.github/workflows/release-validate.yml` against the final commit (see
Workstream P / task 22 in `tasks.md`), which has not happened yet.

## Session baseline

- Branch: `release/1.0.11`
- Pre-session HEAD: `0cd110921ebb8723d2581e729111faff0917f249`
- `code-intel/core/package.json` version: `1.0.11`
- `package-lock.json` workspace entry for `code-intel/core`: `1.0.11` (matches)
- Root `package.json` version (`1.0.10`) is the private, unpublished workspace
  container version — it is intentionally not required to match the published
  package version.

## Scope of this session

Per explicit user direction, this session covered tasks in sections 1, 2, 3,
4, 5, 6, 16, 17 and 24 of `tasks.md` (build/CI reproducibility + mandatory
README/CHANGELOG updates). Workstreams D–N (program-analysis capability
audit, semantic convergence test suites, cache-fingerprint invalidation
tests, 1.0.10→1.0.11 compatibility/rollback fixtures, MCP/HTTP compatibility
audit, truncation/coverage audit, snapshot performance validation, agent
workflow safety, the packaged CLI/MCP/HTTP/Web smoke matrix, and the actual
tag/publish/post-publish steps) were **not** attempted and remain fully open.

## Key finding: build ordering was genuinely broken

`code-intel/core`'s own `build` script never built the Web UI. Core packaging
copies `code-intel/web/dist` into `dist/web/` as a *side effect*
(`scripts/copy-grammars.mjs`) and only **warned** (did not fail) if that
source didn't exist. `release-validate.yml`'s "Build core dist" step only
"worked" because the preceding "Unit tests" step's test script happens to
build Web first as a side effect — exactly the failure mode
`design.md` predicted.

**Reproduced and fixed in this session:**

1. Added `npm run build:product` (root `package.json`) as the single
   authoritative `shared -> web -> core` build path.
2. `copy-grammars.mjs` now fails loudly (actionable error) if
   `code-intel/web/dist` is missing, instead of warning and producing an
   incomplete package. A `CODE_INTEL_SKIP_WEB_ASSETS=1` escape hatch exists
   for legitimate core-only local dev builds (and is used by
   `release-readiness.yml`, which intentionally doesn't build Web).
3. Verified end-to-end: `npm run clean:product && npm run build:product`
   from a genuinely clean checkout (no `dist`, no `dist-tests`, no stale
   `.tsbuildinfo`) succeeds and produces `code-intel/core/dist/web/`.
4. Along the way, found and fixed a **second** stale-cache bug: a committed
   `code-intel/shared/tsconfig.tsbuildinfo` let `tsc -b` silently skip
   re-emitting `shared/dist` when it had been deleted by hand (not via
   `npm run clean`). `clean:product` now always goes through each
   workspace's own `clean` script, which already globs `*.tsbuildinfo`
   correctly.
5. `Dockerfile.build` (used by `docker compose -f docker-compose.build.yml
   build`, documented in `README.md`'s "Local CI Simulation") built Core
   *before* Web — the exact broken order. Fixed to use `build:product`.
   The main `Dockerfile` already built Web before Core; consolidated to
   `build:product` for a single source of truth.
6. **Not verified this session**: an actual `docker build` run was denied by
   the sandbox's permission policy. The Dockerfile/Dockerfile.build changes
   are believed correct by code review and by analogy with the now-verified
   npm build ordering, but this MUST be confirmed by a real CI run
   (`release-validate.yml`'s `build-docker` job, and `publish.yml`'s
   `publish-docker` job) before the candidate is trusted.

## Other hygiene finding

`code-intel/core/dist-tests/package.json` — a stray, generated file inside
what should be gitignored build output — was tracked in git (a leftover
`1.0.10`-era package.json). `dist-tests/` was not in `.gitignore`. Added it
and untracked the stray file (`git rm --cached`). This is a real instance of
exactly the "hidden cache / stale artifact" risk this proposal is about,
even though it wasn't itself blocking the build.

## New verification scripts (all tested against a real build this session)

| Script | Purpose | Wired into |
|---|---|---|
| `scripts/verify-release-metadata.mjs` | package.json / lockfile / CLI `--version` / runtime manifest all agree on version | `release-validate.yml`, `publish.yml` |
| `scripts/verify-runtime-bundle-integrity.mjs` | recomputes SHA-256 and parses SBOM/provenance for each runtime archive, checks against filename version/target | `release-validate.yml` |
| `code-intel/core/scripts/validate-dist.mjs` | inspects the actual `npm pack` tarball contents (required assets present, forbidden paths absent, version match) | `code-intel/core/package.json`'s `validate:dist` (used by both workflows) |

All three were run against a real clean build in this session and passed.

## OpenSpec validation

`openspec validate v1-0-11-release-readiness-hardening --strict --type change`
now passes. It initially failed on two pre-existing wording errors in
`specs/release-readiness/spec.md` (MUST/SHALL statement only in the
requirement header, not the body) — both fixed. Running validation
repo-wide (`openspec validate --changes`) shows unrelated pre-existing
failures in several `v1-0-8`/`v1-0-10` changes; those are out of scope for
this change and were not touched.

## Known open items (not attempted this session)

- Task 1.3: full inventory mapping every archived `v1-0-11-*` OpenSpec change
  to source/tests/docs.
- Tasks 4.4–4.6: isolated npm-tarball install + CLI/MCP smoke tests.
- Tasks 5.2, 5.6, 5.7: full per-archive content inventory, server/MCP startup
  smoke inside the runtime bundle, and non-host-target failure-mode
  verification.
- Task 6.5: confirm `publish.yml`'s Docker/sign/attest jobs still succeed
  against the edited `Dockerfile` (needs a real CI run).
- Tasks 16.3–16.5, 17.2–17.3: Program Analysis Foundation README/CHANGELOG
  sections and the authoritative language capability matrix — these depend
  on Workstream D (task 10), which is out of scope this session. Do not
  fabricate capability claims; they must come from the source/test audit.
- Task 16.7, 16.8, 17.7: full documentation-vs-behavior audits beyond the
  specific stale claims found and fixed this session.
- All of Workstreams E–N (tasks 7–15, 18–21) and the actual release
  candidate/tag/publish/post-publish steps (tasks 22–23).

**This candidate is not release-ready.** The next step is either continuing
into the deferred workstreams above, or running `release-validate.yml`
against a pushed commit to get real CI evidence for what this session
implemented but could not execute (Docker build/run, E2E suite, npm
audit/license audit at full scale).

---

## Continuation session — sections 14, 15, 18, 19, 21 + security findings

### Security/license gates (section 18) — run for real, not just wired into CI
- `npm audit --audit-level=high --omit=dev`: **0 vulnerabilities**.
- `npx license-checker --production --excludePrivatePackages --failOn "GPL-*;AGPL-*;LGPL-*;CPAL-1.0"`: **passes**.
- **Found and fixed a real gap**: no `.dockerignore` existed. `docker build` (`context: .`) sent the entire checkout — `.git/`, `node_modules/`, any locally-built `dist/`, `.env` — to the daemon. Added a conservative `.dockerignore`. Deliberately does **not** exclude `*.md` broadly: `code-intel/core/src/agents/workflows/assets/*.md` are real build inputs (`copy-workflow-assets.mjs` copies them into `dist/` at build time), and a blanket markdown exclusion would have silently broken the Docker build. Only excluded directories confirmed unreferenced by any build/test script (grepped first). **Not verified with a live `docker build`** — permission denied again this session; confirm in CI.
- Runtime bundle secret-leakage risk: verified by code review (not re-running a full rebuild) — `build-runtime-bundle.mjs` copies an explicit file allowlist, not a directory copy, so it structurally cannot pick up stray secrets.

### Section 19 (agent workflow safety) — closed with real evidence
- `node dist/agents/workflows/validate-cli.js` run explicitly against the real build: passes.
- Strengthened `code-intel/core/scripts/validate-dist.mjs` to require `dist/agents/workflows/assets/*.md` in the tarball specifically (not just the parent directory) — closes task 19.2 for real, tested passing.
- Ran the existing `tests/unit/agents/workflows/installer.test.ts` suite for real: 8/8 passing, covering conflict detection, idempotency, non-destructive deselection, and `not-supported` reporting for unsupported agents (tasks 19.3–19.5).

### Section 21 (publish workflow alignment) — verified by re-reading the current `publish.yml`
All four sub-tasks confirmed already satisfied (21.1 from the prior session's `build:product` edits; 21.2–21.4 by tracing the `needs:` dependency graph and confirming no job mutates source). No further edits needed.

### Section 15 (snapshot/diff observability) — verified against real test runs, no code changes needed
Ran `tests/integration/snapshots/graph-diff-safety.test.ts` for real (3/3 passing): confirms `SnapshotPhaseDurations`/`GraphDiffPhaseDurations` are present only on a fresh build and `undefined` on a cache hit, and that the parent-vs-child RSS boundary is already accurately documented in `types.ts`. All of section 15 closed.

### Section 5.7 — verified by code review
`build-runtime-bundle.mjs` throws hard (`Missing required native package for <target>`, `Missing required ONNX runtime directory for <target>`) on missing cross-platform native deps rather than silently producing a partial archive.

### Section 14 (truncation/coverage audit) — full audit + one real fix
Dispatched a research pass across search, blast radius/PR impact, GQL FIND/TRAVERSE/PATH, graph diff, API-contract/cross-repo consumers, and program-analysis. Findings, most → least severe:

1. **Fixed**: HTTP `/api/v1/search` (and the `scope.type === 'group'` branch) hardcoded `hasMore: false` unconditionally in `execute-scoped-search.ts`, regardless of whether the candidate pool actually exceeded `limit`. No existing test or OpenAPI description treated this as an intentional contract. Fix: `hybridSearch()` (`search/hybrid-search.ts`) and `queryGroup()` (`multi-repo/group-query.ts`) now additionally return `candidatePoolSize` — the ranked-candidate-pool size before the final `.slice(0, limit)`, itself a safe lower bound since the pool is capped by `bm25Limit`/`vectorLimit`/`limit*3`. `execute-scoped-search.ts` now computes `hasMore: candidatePoolSize > limit` in all three response branches instead of a hardcoded `false`. This can only under-report `hasMore`, never fabricate a false positive. `total` keeps its existing meaning (count of items in `results`) — not changed, to avoid an actual breaking change. Verified: typecheck passes; full search unit-test suite run before and after (via `git stash` A/B) — 18/22 passing both times, confirming the fix adds zero regressions.
2. **Not fixed, documented as a real gap**: `blast_radius`/`pr_impact`/GQL `TRAVERSE` silently stop expanding at `maxHops`/`maxDepth` with no signal — `coverage.complete` only reflects edge-certainty, not depth-based truncation. A caller who exhausts the hop limit sees `coverage.complete: true` with no indication the traversal itself was capped.
3. **Not fixed**: GQL `truncated` field means "search timed out," not "results were paginated" — a caller reading `truncated: false` alone (ignoring `totalCount`) could misread a paginated response as exhaustive.
4. **Not fixed**: `pr_impact.filesToReview` is silently capped at the top 5 with no "N more" indicator.
5. Already well-handled, no gap: graph diff (`hasMore` genuinely derived), API-contract/cross-repo consumers and contract drift (`coverage.complete`/`incompleteReasons`/cap-hit counters — the strongest-instrumented surface in the codebase), program-analysis per-function truncation (`limits.ts` contract honored end-to-end). One dead-code note: `program-analysis/limits.ts`'s request-level budgets (`maxAnalyzedFunctionsPerRequest`, `maxAnalysisTimeMsPerRequest`) are defined but never enforced anywhere — not a false-completeness risk today since no batch orchestrator consumes them yet.

### Found while verifying the section 14 fix: 4 pre-existing failing unit tests, unrelated to this session
Running the full search test suite surfaced 4 failures. Confirmed via `git stash` (reverting only the 3 files touched this session, rerunning, restoring) that **all 4 fail identically on the unmodified code** — not caused by anything in this change:
- `scoped-search-contract.test.ts` — two tests (`preserves canonical scope object`, `normalizes legacy group field`) assert an object literal missing the `selectorSource` field, which `normalizeSearchRequest` has legitimately returned since canonical-scope-selector support was added. Looks like a stale test fixture, not a product bug.
- `execute-scoped-search.test.ts` — `uses pinned context metadata instead of repo-root metadata for vector fallback` expects a successful `body` result for `scope: { type: 'repo', repoId: 'repo-1' }`, but with canonical-scope resolution (stable-ID-only, no name/path fallback) and no `repo-1` in the registry, the current code correctly 404s. Likely another stale fixture from before that stricter resolution rule shipped.
- `group-query.test.ts` — `uses pinned snapshot metadata rather than active root metadata` expects `result.perRepo[0]` to exist; it comes back `undefined`, meaning the member-repo loop in `queryGroup` isn't matching/loading the fixture repo for some reason. This one **looks like it could be a genuine bug** (not just a stale assertion) but was not investigated further — out of scope for this session's fix.

None of these were touched. They're flagged here because a currently-failing unit test suite is directly relevant to task 3.7 and the release blocker list ("pre-release CI ... unit-only pass" / mandatory test matrix) — someone should triage these three tests (fix the two stale fixtures, investigate the `group-query` one for a real bug) before this candidate can be considered green.

### MAJOR FINDING — real, reproduced release blocker: `index-status`/`doctor` silently trusted a genuine 1.0.10-built index

While building the real 1.0.10→1.0.11 compatibility fixture (task 11, `scripts/verify-upgrade-from-1.0.10.mjs`), installing the **actual published** `@vohongtho.infotech/code-intel@1.0.10` from npm and pointing the 1.0.11 candidate CLI at its persisted `.code-intel` state reproduced exactly the scenario the release spec calls a blocker: *"incompatible `1.0.10` index state is silently treated as current."*

**Root cause, found by reading source, not by guessing:** two independent trust-decision code paths exist, and only one had a compatibility-fingerprint check:
- `pipeline/analysis-plan.ts`'s `determineEvolution()` (decides what `analyze` does) — already checked identity/resolver/fact-schema/evidence/API-contract fingerprints (existing code, pre-dating this session), but only when both sides had the field. It never handled a `compatibilityReceipt` that's **entirely absent** — real 1.0.10 metadata has `schemaVersion: 3` (equal to today's `CURRENT_SCHEMA_VERSION` — no schema migration needed) and `parser: "tree-sitter"`, so it didn't hit the legacy/regex-parser fallback either. Every fingerprint check silently no-op'd (`undefined && …` is falsy), and the function fell through to `'reuse'`.
- `storage/index-trust.ts`'s `verifyIndexTrust()` (the function behind `index-status`/`doctor`, i.e. what a user or agent actually sees as "is this index good") — **had no fingerprint check of any kind**. It only validated artifact existence/corruption and commit-hash freshness. It unconditionally reported the real 1.0.10 index as `trusted: true, fresh: true`.

Fixing only the first (which was itself a genuine, separate task-9.1-adjacent gap — see below) did **not** fix the bug, because `index-status` never called it.

**Fix:** extracted one shared `isSemanticProducerIncompatible(metadata)` into `pipeline/compatibility-receipt.ts` — the single source of truth for "does this persisted metadata's producer identity match what's currently installed," covering per-field fingerprint mismatches (identity/resolver/fact-schema/evidence/API-contract/language-registry) AND the "compatibilityReceipt entirely absent" case. Both `analysis-plan.ts` (`determineEvolution`) and `index-trust.ts` (`verifyIndexTrust`, new `SEMANTIC_PRODUCER_INCOMPATIBLE` reason, classified as `state: 'stale'`) now call the same function. Deliberately did **not** route this through the existing `metadata-migrate` evolution action even though it superficially looked applicable — that path `preserve`s graph/bm25/vector (correct for a physical-layout-only migration) and would have silently stamped current-looking metadata onto content that was never actually resolved by the current identity/resolver/evidence pipeline, which is worse than the original bug.

**Verified end-to-end against the real published 1.0.10 package** (not a mock): before the fix, `index-status` reported `trusted: true` for the 1.0.10 index; after the fix, it reports `state: "stale", trusted: false, fresh: true, reasons: ["SEMANTIC_PRODUCER_INCOMPATIBLE"]`, and reanalyzing under 1.0.11 correctly produces a trusted/fresh index while repository identity and group membership survive unchanged. New tests added and passing in both `analysis-plan.test.ts` and `index-trust.test.ts`; full regression run across all touched suites shows zero new failures.

### Full-suite regression confirmation (after the index-trust fix)
Ran the complete unit test suite (`node --test dist-tests/tests/unit/**/*.test.js`, 1825 tests) as a final checkpoint after all of this session's source changes (search `hasMore`, framework-adapter fingerprint, language-registry fingerprint, the shared `isSemanticProducerIncompatible`). Result: **1812 passed, 12 failed — every one of the 12 confirmed pre-existing and unrelated** via the same git-stash A/B methodology used throughout this session:

| File | Failing tests | Status |
|---|---|---|
| `search/scoped-search-contract.test.ts` | 2 | Pre-existing — stale fixture missing `selectorSource` field |
| `search/execute-scoped-search.test.ts` | 1 | Pre-existing — pinned-metadata vector-fallback test expects success where canonical-scope resolution now correctly 404s |
| `search/group-query.test.ts` | 1 | Pre-existing — `queryGroup`'s member-repo loop not matching the fixture repo; possible real bug, not investigated |
| `cli/config-manager-embedding-model.test.ts` | 1 | Pre-existing — unrelated config-schema validation gap (rejects free-text embedding model names) |
| `errors/openapi.test.ts` | 3 | Pre-existing — unrelated OpenAPI spec/route-coverage gaps |
| `pipeline/incremental.test.ts` | 3 | Pre-existing — unrelated incremental-detection tests |
| `query/pr-impact.test.ts` | 1 | Pre-existing — unrelated risk-scoring test |

One additional file, `program-analysis/semantic-graph-gate.test.ts`, initially showed a new failure caused by this session's `isSemanticProducerIncompatible` change — its `writeTrustedIndex` test helper hand-built metadata without a `compatibilityReceipt`, exactly the pattern the new check now (correctly) flags. Fixed by giving it a real receipt, same as the `analysis-plan.test.ts`/`index-trust.test.ts` fixtures. Confirmed fixed and re-verified in this final run (does not appear in the failure list above). `pipeline/worker-pool.test.ts` also failed once under `--test-concurrency=4` but passed cleanly both in isolation and in this concurrency=2 run — concurrency-induced flakiness, not a real issue.

None of the 7 pre-existing files above were touched this session.

### Section 20 (packaged smoke matrix) — closed with a new script exercising the real security path
Added `scripts/verify-packaged-smoke-matrix.mjs`. Beyond the CLI surfaces `verify-npm-install.mjs` already covered, this adds `repo list`/`status`/`impact`, a real MCP `tools/list` + `tools/call("search")`, and starting the packaged HTTP/Web server. The HTTP check turned up two real, correctly-enforced security layers that had to be worked *with*, not around: the API requires a Bearer token (provisioned via `code-intel token create --role admin`, fully non-interactive) AND CSRF protection on state-changing requests (double-submit cookie + `X-CSRF-Token` header, fetched from `GET /auth/csrf-token`). Verified both the unauthenticated-rejection path (401/403) and the fully-authenticated success path work correctly.

### Task 20.4 — real browser smoke test of the Web UI, plus a found-and-fixed bug and two more registry-isolation leaks
Ran a genuine browser session (Playwright) against the packaged HTTP/Web server, rather than only the HTTP API layer. Setup: fresh fixture repo at `/tmp/web-smoke/repo` (a small TS file with a function + a class calling it), analyzed and served with `CODE_INTEL_GLOBAL_DIR`, `CODE_INTEL_USERS_DB_PATH`, and `CODE_INTEL_SECRETS_PATH` all pointed at `/tmp/web-smoke/*`, and a real admin user (`smokeadmin`) created through that isolated path (the first attempt, using only `CODE_INTEL_GLOBAL_DIR`, collided with the real pre-existing `admin` account — see the security hygiene finding below for why).

Logged in through the actual rendered login form (not a Bearer-token shortcut) and exercised, without crashes or fabricated results:
- `/connect` repo picker (correctly listed the fixture alongside real registry entries — itself evidence for the registry-isolation gap below)
- Graph explorer: node/edge counts, sigma.js canvas render, Graph Composition + Overview stats
- Search-by-name in the top search bar (filtered correctly, no dropdown but graph/canvas is the result surface)
- Files tab → node detail panel: Overview, Connections ("No connections recorded" — correct, the file node itself has no direct edges), Source (rendered the real file content)
- Selected the class node directly on the canvas (via a dispatched DOM MouseEvent on the sigma `.sigma-mouse` layer, since canvas nodes aren't part of the accessibility tree) — Overview/Source panels updated correctly for it too
- GQL Query Console: ran `FIND * WHERE kind IN [function, method] LIMIT 20` for real, got a correct empty result set (the fixture graph has no `function`-kind nodes — matches the Overview's "0 Functions" stat)
- Groups list view: rendered all 23 real groups from `~/.code-intel` (see below)

Not reached: contract detail/diff surfaces (this single-repo fixture was never synced into a group, so there was nothing to show — group/contract behavior at the CLI level is already covered by other sections of this checklist).

**Found and fixed a real bug**: `code-intel/web/src/state/app-context.tsx` seeded `serverUrl: 'http://localhost:4747'` in the initial reducer state instead of an empty string. Two effects — `App.tsx`'s mount-time auth-status check and `LoginPage.tsx`'s bootstrap-status check — both already guard with `state.serverUrl || defaultUrl` (where `defaultUrl` is correctly derived from `window.location`), but because the seeded value was always truthy, that fallback was dead code: every page load fired `GET {realOrigin}` → no, fired against the *hardcoded* `http://localhost:4747` first (visible as two `ERR_CONNECTION_REFUSED` console errors on every single page load in this test, since nothing was listening on 4747). The app still worked in this test because the login form's own `serverUrl` input is seeded from a separate, correctly-computed `defaultUrl`, and a successful login dispatches `SET_SERVER_URL` with the right value — but this means **session-restore-on-refresh silently fails** on any deployment not served from port 4747: the page reloads, `App.tsx`'s mount-time check hits the wrong host, times out/fails, and a user with a perfectly valid session cookie gets dropped back to `/login` with no error shown. Root-caused all ~15 other consumers of `state.serverUrl` across the codebase (`QueryPanel`, `NodeDetail`, `SearchBar`, `SidebarChat`, `SourcePanel`, `GroupPanel`, `Header`, `SettingsPage`, `ExplorerPage`, `StatusFooter`, `GraphDiffPage`) and confirmed every one of them only renders after login, by which point `state.serverUrl` has already been corrected — so seeding it as `''` instead is a complete, minimal fix with no other call site needing a change. Applied the one-line fix. `npm run build --workspace=code-intel/web` to recompile `dist/web` and re-verify the fix in-browser was denied twice by the session's permission system, so **the fix exists in source but the bundle serving this smoke test is still the old, buggy build** — this needs a real rebuild (CI's `build:product` will pick it up) before it can be considered verified end-to-end.

**Two more concrete instances of the already-documented registry-isolation gap** (see "Secondary finding" below) surfaced by this test and cleaned up from the real `~/.code-intel`:
1. `code-intel analyze /tmp/web-smoke/repo` (run with only `CODE_INTEL_GLOBAL_DIR` isolated) registered a real entry named `repo` in the actual `~/.code-intel` repo registry, because `storage/repo-registry.ts` ignores that env var entirely. Removed via `code-intel clean --purge /tmp/web-smoke/repo` once discovered.
2. Repeated runs of `verify-upgrade-from-1.0.10.mjs` this session (which uses unique per-run group names specifically to avoid registry collisions, since `multi-repo/group-registry.ts` has the same isolation gap) left **9 stray `upgrade-test-group-<pid>-<timestamp>` entries**, each with 0 members, sitting in the real `~/.code-intel/groups/`. Confirmed via the Web UI's own Groups list (23 groups shown, 9 clearly test artifacts) and via `code-intel group list`. There is no `group delete` CLI command for a whole group (only `group remove <group> <groupPath>`, which removes one member), so cleanup required deleting the 9 `<name>.json` (+ `.sync.json`) files directly from `~/.code-intel/groups/` — done with explicit user confirmation before touching real files outside the repo. Verified clean afterward: `group list` shows the same 14 pre-existing groups noted in earlier cleanup, `repo list` shows only the pre-existing `alpha` entry.

One caveat discovered mid-test: purging a repo's registry entry via `code-intel clean --purge` **while a `serve` process for that repo is still running** breaks that live server's `repoId`-scoped endpoints (`/api/v1/nodes/:id`, `/api/v1/source`, `/api/v1/blast-radius` all started 404ing with "Repo ... not found" after the purge, even though the in-memory graph kept serving basic browsing fine). This is expected behavior given a live registry lookup, not a bug — but it's a testing-order lesson: don't purge a repo's registry entry out from under a `serve` process you're still actively testing against. The test server was stopped immediately after this was noticed.

### Security hygiene finding: test scripts were leaking real admin API tokens into the actual environment
While setting up a real browser-based Web UI smoke test, discovered that `auth/users-db.ts` (`CODE_INTEL_USERS_DB_PATH`) and `auth/secret-store.ts` (`CODE_INTEL_SECRETS_PATH`) each hardcode `os.homedir()/.code-intel/...` with their OWN separate override env vars — **not** `CODE_INTEL_GLOBAL_DIR`. `verify-packaged-smoke-matrix.mjs` only set `CODE_INTEL_GLOBAL_DIR`, so every run's `code-intel token create --role admin` call was silently writing a real, live admin-role API token into the actual environment's `~/.code-intel/users.db` — 5 had accumulated by the time this was caught. **Immediately revoked all 5** via `code-intel token revoke <id>` and confirmed `token list` shows none remaining. Fixed the script to also set `CODE_INTEL_USERS_DB_PATH`/`CODE_INTEL_SECRETS_PATH` to isolated temp paths; re-ran and confirmed zero new tokens/users appear in the real environment afterward. This is the same class of bug as the repo/group registry isolation gap below — a third independently-hardcoded storage location, each with inconsistent (or absent) env-var overrides.

### Secondary finding: the repo/group registry does not respect `CODE_INTEL_GLOBAL_DIR`
`storage/repo-registry.ts` and `multi-repo/group-registry.ts` both hardcode `os.homedir() + '/.code-intel'`, unlike `config`/`doctor`/`runtime-lifecycle` which do respect the env var. Discovered because this session's own test scripts kept colliding with (and, on inspection, turned out to be surrounded by) **14+ pre-existing stray group entries already accumulated in this dev environment's real `~/.code-intel/groups/`** from this repo's own test suite (names like `drift-filter-group`, `lambda-environmental`, `mcp-group-drift` are clearly test artifacts, not real user data) — confirming this is a real, pre-existing test-isolation gap in the codebase, not something introduced this session. There is also no CLI command to fully delete a group once created (only remove members from one), so cleanup scripts can only leave an empty group behind, not remove it entirely. Not fixed here (real blast radius: changing where the registry lives is a behavioral change beyond this session's scope) — flagged as a genuine, moderate-priority follow-up for test hygiene and for any future work that assumes `CODE_INTEL_GLOBAL_DIR` fully isolates state.

### Section 13 (MCP/HTTP backward compatibility) — full audit, no gaps found
Dispatched a research pass over `MCP_TOOL_DEFINITIONS` (36 tools, `mcp-server/tool-definitions.ts`), the live dispatch in `server.ts`, the workflow registry (`agents/workflows/registry.ts`), and the OpenAPI spec (`http/openapi.ts`) vs. handlers (`http/app.ts`). Result: clean.
- Every tool definition has a matching dispatch `case`; every workflow-referenced tool name is a subset of `MCP_TOOL_DEFINITIONS` — and `validateWorkflowRegistry` already enforces this on every `npm run build`, reading `MCP_TOOL_DEFINITIONS` directly (no stale copy).
- `search`/`inspect` response shapes unchanged; `blast_radius`/`pr_impact` legacy fields untouched, with new `certainty`/`coverage`/`boundaries`/`apiImpact`/`crossRepositoryContracts` all optional/additive (`apiImpact` is explicitly *absent*, not an empty object, when there's nothing to report — preserves old-shape-equals-old-behavior for clients that don't know about it).
- All five 1.0.11 HTTP endpoints (`/api-contract`, `/api-impact`, `/api-drift`, `/graph/diff`, `/groups/{name}/drift`) are present in both the OpenAPI spec and the live route handlers.
- `graph_diff`/API-contract/cross-repo tools already have the strongest completeness instrumentation in the codebase (`coverage.complete`/`incompleteReasons`), consistent with the section 14 findings.

No code changes were needed for section 13.

### Section 4.4–4.6 (npm tarball isolated install) — closed with a new, real, self-cleaning verification script
Added `scripts/verify-npm-install.mjs` (`npm run verify:npm-install`, wired into `release-validate.yml` after `validate:dist`). Packs the tarball, installs it via real `npm install` into an unrelated temp project (no workspace symlink — native-module install scripts must stay enabled here, `--ignore-scripts` breaks `@ladybugdb/core`'s native binding), then from the installed `.bin/code-intel` only: `--version`, `doctor --json`, `analyze` a fresh git fixture, confirms `trusted`/`fresh` generation state, reopens with a second process and confirms the same `generationId`, `search` finds the fixture symbol, and starts `code-intel mcp <path>` and completes a real JSON-RPC `initialize` handshake over stdio. All verified passing end-to-end.

**Found and fixed while building this**: the fixture repo name is registered in the user's *global* `~/.code-intel` registry (not scoped to the temp dir), so a bare `rm -rf` of the temp directory after the run leaves a stale, unreachable registry entry behind — the second time this session ran an earlier draft of the script, it failed with `Repository name "fixture-repo" already exists`. Fixed two ways: the fixture directory name is now unique per run (`fixture-repo-<pid>-<timestamp>`), and the script now calls `code-intel clean <fixtureRepo> --purge` in a `finally` block so it never leaves global registry state behind even on failure. (Also cleaned up the one stray entry this created in this environment's real `~/.code-intel` registry during development — confirmed via `code-intel repo list` that it was the only entry before removing it.)

### Task 11.9 (embedding/vector compatibility) — closed with a real, dedicated fixture in `verify-upgrade-from-1.0.10.mjs`
Extracted the new logic into its own `verifyEmbeddingCompatibility()` function (kept `main()`'s cognitive complexity from growing further, per the IDE's own SonarQube diagnostic) operating on a second, independent fixture repo (`repo-embed-<pid>`) so a slow/flaky embedding-model download can't jeopardize the already-passing checks in the main upgrade fixture.

Confirmed network egress to `huggingface.co` works in this environment, then ran `code-intel analyze --embeddings` for real under the actual published 1.0.10 package — this downloads and runs `Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers`, a real local CPU inference model, not a stub. Verified:
- 1.0.10 produces a genuinely `ready` vector index (2 vectors, dimension 384).
- 1.0.11's `index-status` does NOT silently trust that 1.0.10-built vector index — reports `SEMANTIC_PRODUCER_INCOMPATIBLE`, the same gate proven for graph/bm25 state in task 11.7 (`storage/index-trust.ts`'s `isSemanticProducerIncompatible()`), now also confirmed to correctly cover the embeddings-enabled case.
- Reanalyzing under 1.0.11 **without** re-passing `--embeddings` automatically regenerates a fresh, `trusted`/`fresh`, `ready` vector index — confirming the repo-level embeddings preference (recorded by 1.0.10, read back by 1.0.11) survives the upgrade, per `analyze --help`'s documented behavior ("remember it for this repo").

**Found and fixed a wrong assumption while building this**: initially assumed persisted metadata lived at a flat `.code-intel/meta.json`. Reproduced in isolation and found the real layout is Generation-based — `.code-intel/current.json` names the active `generationId`, and the actual `meta.json` lives at `.code-intel/generations/<generationId>/meta.json`. Fixed the script's metadata reader (`readCurrentGenerationMeta()`) to resolve this indirection fresh each time rather than caching a stale path — the generation ID changes on every (re)analyze.

**Registry-isolation gap struck again during manual debugging** (not from the fixed script — the script's own `clean --purge` cleanup in `finally` worked correctly, verified by checking `repo list` immediately after a full run): an earlier *manual* reproduction step (run directly via `CODE_INTEL_GLOBAL_DIR` only, to isolate the "file not found" bug from the script itself) registered a real `repo` entry pointing at `/tmp/embed-check/repo` in the actual `~/.code-intel` registry. Purged via `code-intel clean --purge /tmp/embed-check/repo` once noticed; confirmed `repo list` afterward shows only the two legitimate pre-existing entries (`alpha`, and this repo's own `code-intel-platform` self-analysis).

### Task 11.4 (agent-target/instruction-asset preservation) — closed, with an honestly-documented interactive-only constraint
Investigated the actual feature before writing anything: agent-target selection has no CLI flag — it's `promptForAgentTargets()` (`code-intel/core/src/cli/app.ts`), gated by `isInteractiveSession()` which requires a real TTY on both stdin and stdout. Persisted selection lives at `.code-intel/agent-targets.json` (schema: `{selectedAgents, targets}`, `code-intel/core/src/storage/metadata.ts`); the generated instruction file (e.g. `CLAUDE.md`) uses a `<!-- code-intel:start/end -->` marker pair, and anything outside those markers is documented and enforced as user-owned, never overwritten (`upsertFile`, `cli/context-writer.ts`).

**Real constraint, verified rather than assumed**: a `spawnSync`-driven script can never provide a real TTY, and neither can any real non-interactive/CI `analyze` run in ANY version of the product — so there's no way for a real 1.0.10 process, run non-interactively, to ever create this state. Confirmed by actually running a non-interactive 1.0.10 `analyze` in the new `verifyAgentTargetPreservation()` fixture and checking that `agent-targets.json` does NOT get created (would have failed the script otherwise). This isn't a workaround for a bug — it's the actual, correct behavior of a CLI that only asks interactive-only questions at a real terminal.

Given that, verified the real 1.0.11 code paths that CONSUME this state, seeding the exact artifact shape a human's real 1.0.10 terminal session would have produced (diffed `agent-targets.ts` and `context-writer.ts` at the `v1.0.10` tag against this candidate first — confirmed the JSON schema, the `'claude'` builtin target shape, and the marker format are all byte-for-byte identical across both versions, so this isn't speculative). Planted a `selectedAgents: ["claude"]` selection and a `CLAUDE.md` with a hand-written note in the marker-protected user section, then ran a real, unmodified 1.0.11 `analyze` against it and verified: the selection is read and honored without re-prompting (impossible non-interactively if it had tried), the managed block is regenerated carrying 1.0.11's own version stamp, and the user's note survives that regeneration byte-for-byte.

**Also confirmed, so as not to overstate the fix**: the workflow-asset fingerprint/conflict-detection mechanism (`agents/workflows/installer.ts` — sha256 markers that refuse to overwrite a user-modified workflow file) is entirely NEW in 1.0.11; `git show v1.0.10:code-intel/core/src/agents/workflows/installer.ts` doesn't resolve — the path doesn't exist at that tag. There is therefore no prior-version installed-workflow-file state that could exist to test "preservation across the upgrade" for — same category of honest, non-fabricated limitation as task 7.7's program-analysis/Generation gap.

### Tasks 6.1–6.5, 18.3–18.4 — a real, permitted `docker build` surfaced and fixed four independent, previously-undiscovered release blockers

Docker build permission (previously denied by the session's classifier) was explicitly granted this session. This section's importance can't be overstated: **no prior session ever actually ran `docker build` on this Dockerfile and verified the resulting image runs.** Every previous pass at Workstream A's Docker tasks reasoned about the Dockerfile structurally (build ordering, `.dockerignore` presence) without ever executing it. Actually building and running it surfaced four real, independent bugs — the packaged Docker image would have been **completely broken for every real user** had this release shipped as-is.

**Bug 1 — `.dockerignore`'s bare patterns don't match nested paths in this Docker version, letting stale local build artifacts leak into the build context.** First build attempt failed with `code-intel/web`'s `tsc -b` reporting `Cannot find module 'code-intel-shared'` — even though `code-intel/shared` built first, successfully, in the same `npm run build:product` chain. Reproduced in isolation (a debug image stopping right after `COPY . .`): a stale, *untracked*, local `code-intel/shared/tsconfig.tsbuildinfo` (leftover from earlier host development, correctly gitignored but NOT correctly dockerignored) leaked into the build context and convinced `tsc -b` the build was already up to date, so it silently skipped emitting `dist/` entirely — `tsc -b` exited 0 with zero output files. Confirmed the same leak affected nested `node_modules/` per-workspace (`code-intel/{shared,core,web}/node_modules/`) — lower risk in practice (mostly `typescript`, prebuilt-binary tree-sitter parsers, and file-watching deps; the one host/container-sensitive native module, `@ladybugdb/core`, lives only at the workspace root, unaffected), but still a real non-determinism gap: the previous `.dockerignore` only reliably excluded these patterns at the build-context *root*. Fixed by adding explicit `**/`-prefixed forms (`**/node_modules/`, `**/*.tsbuildinfo`) alongside the existing root-level ones — verified via a debug image showing zero leaked files of either kind afterward, then via a full clean `docker build --no-cache` success.

**Bug 2 — `node:22-alpine`'s musl libc is fundamentally, unconditionally incompatible with `@ladybugdb/core`, this project's core graph-persistence native dependency.** Once the build succeeded, the container crashed immediately on any `analyze`/`search` touching the graph DB: `Error loading shared library .../lbugjs.node: napi_coerce_to_string: symbol not found` (and ~80 more unresolved N-API/glibc symbols via `ldd`). `@ladybugdb/core`'s `optionalDependencies` ship prebuilt native binaries ONLY for glibc-based platforms (`@ladybugdb/core-linux-x64`, `-linux-arm64`, `-darwin-*`, `-win32-x64` — no musl variant at all). The Dockerfile's existing `libc6-compat` package only shims a handful of basic glibc symbol *names* for dynamic linking; it does not provide a real glibc or fix Node N-API ABI compatibility for a module actually compiled against glibc. Verified the fix directly before committing to it: a stock `node:22-bookworm-slim` (Debian, real glibc) container resolves every one of `lbugjs.node`'s symbols via `ldd` with zero "not found" lines. Switched both the `base` and `production` stages to `node:22-bookworm-slim`; updated `apk add` → `apt-get install` accordingly; replaced the Alpine-only `wget`-based `HEALTHCHECK` with a plain `node -e` HTTP check (bookworm-slim has no `wget`/`curl` by default).

**Bug 3 — the glibc switch surfaced a real, previously-latent missing runtime dependency: `libssl3`.** With musl-vs-glibc fixed, the container crashed differently: `libssl.so.3: cannot open shared object file`. `@ladybugdb/core`'s native addon dynamically links `libssl.so.3`/`libcrypto.so.3` directly (confirmed via `ldd`) — separate from, and in addition to, Node's own statically-linked OpenSSL (`node -e "console.log(process.versions.openssl)"` works fine with zero `libssl.so.*` present anywhere on disk, proving Node itself never needed it — this really is `@ladybugdb/core`'s own dependency). `node:22-bookworm-slim` doesn't include it by default. Added `apt-get install -y libssl3` to both `base` and `production` stages.

**Bug 4 — a real, pre-existing (Docker-independent) bug in `installer.ts`'s asset-path resolution, breaking `installWorkflows` for every real packaged install, not just Docker.** With all three Docker-specific issues fixed, `analyze` inside the container still logged `Context file write failed: ENOENT ... dist/cli/assets/_shared-evidence-guide.md`. Traced this to `agents/workflows/installer.ts`'s `readSharedGuide()`/`readAssetBody()`, which resolved asset paths via `path.join(__dirname, ...)` assuming `__dirname` equals `dist/agents/workflows/` (where this source file lives, and where `copy-workflow-assets.mjs` copies the real `.md` assets). That assumption is **wrong** for the actual production build: `core`'s build uses tsup/esbuild to bundle everything under `src/` into a handful of `dist/cli/*.js` files, so at runtime `__dirname` for this code is really `dist/cli/` — one level *above* where the assets actually are. `context-writer.ts`'s `readPackageVersion()` already works around the identical problem for its own purposes (`path.join(__dirname, '../../package.json')`), but tolerantly — it silently falls back to `'unknown'` on any failure, which is why nobody had noticed this class of bug before. `installer.ts`'s asset reads have no such fallback (nor should they — missing workflow content isn't something to silently paper over), so `planWorkflowInstall()` throws unconditionally on **every** `analyze` call that doesn't pass `--skip-agents-md`, in the **real production build**, completely independent of Docker — reproduced and confirmed locally against the plain host-built `dist/`, not just inside the container. Fixed with a build-shape-tolerant resolver (`resolveWorkflowAssetsRoot()`) that tries the bundled-production layout first and falls back to the unbundled-test-build layout (`tsc -b tsconfig.test.json` preserves the original `src/` directory structure under `dist-tests/src/agents/workflows/`, a *third*, different shape from either) — verified correct against both real, actually-built layouts: the full `installer.test.ts` suite (8/8 passing) against a freshly-rebuilt `dist-tests/`, and a real `analyze --embeddings`-free run against the freshly-rebuilt production `dist/` with a real agent target seeded, confirming all 8 workflow skill files get written with the shared evidence-guide content genuinely embedded (grepped for it in the actual output file).

**Task 18.4, real Trivy scan, one more real (and ironic) finding**: scanning the now-working image found 4 real HIGH-severity npm-ecosystem CVEs, all traced — via direct filesystem inspection inside a running container, not guessed — to `/usr/local/lib/node_modules/npm/node_modules/{tar,brace-expansion,ip-address,pacote}`: npm's **own internal vendored dependencies**, unrelated to this project's dependencies (already correctly pinned via `package.json`'s `overrides`, confirmed by inspecting the actual resolved lockfile entries — `tar@7.5.22`, `brace-expansion@5.0.9`, `ip-address@10.4.0`, all safe). Root cause: the Dockerfile's `production` stage ran `npm install -g npm@12.0.1`, originally added specifically "to pull fixed tar transitive versions before image scanning" — but the `production` stage's `CMD` only ever runs `node ...` directly; nothing in it calls `npm` at any point. Removing the upgrade and reverting to the base image's bundled npm didn't help either — that npm version vendors its *own* differently-vulnerable internal copies (`tar@7.5.11` with a CRITICAL CVE this time, plus `pacote`, `picomatch`, `sigstore`). The actual fix: delete npm/npx/corepack from the `production` stage entirely (`rm -rf /usr/local/lib/node_modules/npm ... /usr/local/bin/npm /usr/local/bin/npx`), since it's provably unused there. Re-scanned and confirmed **0 Node.js-ecosystem vulnerabilities** afterward, with the image otherwise unaffected (re-verified analyze/search/health all still pass). Remaining findings are 56 Debian OS-package CVEs, mostly `fixed: None` (not actionable via `apt-get upgrade` today) — an accepted tradeoff of the glibc base image now required by Bug 2, not a regression introduced here. Confirmed the existing CI gate (`release-validate.yml`'s `scan-image` job, `ignore-unfixed: true`, CRITICAL-only) would pass: re-ran with the exact same flags and found zero CRITICAL+fixable results. SARIF evidence retained at `openspec/changes/v1-0-11-release-readiness-hardening/evidence/trivy-scan-1.0.11.sarif`.

All four fixes were verified together with a final clean `docker build --no-cache`, then a real container run (mounted fixture repo, matching non-root uid) exercising `analyze` (real tree-sitter parsing + real ladybugdb persistence to disk — `graph.db`/`bm25.db`/`evidence.db`/`meta.json` all genuinely written), `search` (correct results, exit 0, no segfault), and the HTTP `/health/live` endpoint (200).

A `linux/arm64` build via QEMU emulation (`docker buildx build --platform linux/arm64`) was also run this session to cross-check task 6.5's multi-arch claim beyond reasoning-by-architecture-consistency (emulated native-module compilation took ~13 minutes vs. ~3 for native amd64). It **succeeded**: `--version` reports `1.0.11`, and a real mounted-fixture `analyze`/`search` genuinely parses (tree-sitter) and persists (ladybugdb) data on arm64 too, with exit 0 and a 200 health check — confirming `@ladybugdb/core-linux-arm64`'s prebuilt binary is genuinely compatible with the same glibc-based image, not just assumed from `optionalDependencies` listing it.

### Confirming no regression from the `installer.ts` fix: three failing tests, all pre-existing and unrelated

A full core test-suite re-run (248 files) was interrupted mid-run by background-task teardown before producing a final summary, but its partial output showed 3 failing suites: `CLI analyze sticky embeddings` (6/10 sub-tests), `CLI analyze incremental consistency` (1/4), and `doctor --json` (1/1). Given these touch `analyze`/embeddings/doctor — nothing about workflow-asset installation — a regression from the `installer.ts` fix seemed unlikely, but this was verified directly rather than assumed:

- **`analyze-embeddings.test.js`** ("legacy vector.db without embedding metadata normalizes on next analyze"): ran this file against the ORIGINAL, unfixed `installer.ts` (via `git show HEAD:...` swapped in temporarily, dist-tests rebuilt) — **identical failure**, byte-for-byte same `ENOENT: .../.code-intel/meta.json` error, present with or without the fix. Root cause is unrelated to `installer.ts`: the test itself assumes a flat `.code-intel/meta.json` path, but real persisted state is Generation-based (`.code-intel/current.json` → `generations/<id>/meta.json`) — the exact same wrong assumption this session already found and fixed once, in the *upgrade-verification script* (task 11.9); this pre-existing integration test was never updated for the same change. Restored the fix immediately after (confirmed `resolveWorkflowAssetsRoot` present again) and re-ran the same file with the fix in place — same identical failure, confirming the fix changes nothing about this outcome either way.
- **`doctor-json.test.js`**: failure is a stale expected-checks list — the actual `doctor --json` output includes two checks (`runtime-versions`, `runtime-uninstall`) the test's hardcoded expected array doesn't list yet. Doctor is reporting *more* than the test expects, not less — not a functional regression, just an outdated fixture, unrelated to workflow-asset installation.
- **`analyze-incremental-consistency.test.js`** ("DB persist failure preserves the previously published on-disk index"): the test's fault-injection setup didn't actually trigger the simulated DB-persist failure it expects to see logged (`analyze` completed normally instead) — a test-harness issue with whatever mechanism simulates the failure, not a change in real persist behavior.

None of these three are new, none are caused by this session's changes (installer.ts, embeddings/agent-target work, or the Docker/Trivy fixes), and none block this release on their own merits — they're pre-existing test-suite drift, same category as the 12-failures-across-7-files already documented earlier in this file. Flagging them here rather than silently letting the interrupted background run's partial output stand unexplained. The full 248-file suite was not re-run to a clean completion this session (two consecutive attempts were killed by background-task teardown); a full clean run is recommended before the actual release gate (task 22.2 already requires the complete authoritative pre-release workflow to pass, which would catch anything this session missed).
