# v1.0.12 Release Evidence

Recorded 2026-11-03 on `release/1.0.12` @ `364cdfc`; §4–§9 updated and §11 added 2026-11-12 after safe-refactoring was archived. Re-run the commands in each section before tagging; this file records the state at the time it was written.

## 1. Baseline (task 1.1)

| Fact | Planned | Verified |
|---|---|---|
| Baseline SHA | `20e46e8a251eaf52772388a5ef67b4fa290f934f` | Exists; it is the 2026-09-21 merge of `release/1.0.11` (PR #50) and an ancestor of `HEAD` |
| Latest released tag | `v1.0.11` | `git describe --tags --abbrev=0` → `v1.0.11`; ancestor of the baseline |
| Package versions | 1.0.11 | root and `code-intel/core` = `1.0.11`; `shared`/`web` = `0.1.0` (unversioned workspaces). Bump to 1.0.12 is a release-integration step. |
| Commits since baseline | — | 31 |
| F01–F22 map | proposal.md | Every v1.0.11 "baseline" claim matches the owner paths in design.md §3 (all exist). v1.0.12 deltas are recorded in §5 below. |

## 2. Planning-file alignment (task 1.2)

- `openspec/config.yaml`: release target v1.0.12, baseline SHA and branch match §1.
- `openspec/project.md`: v1.0.12 title, baseline SHA/date, eight programs, and definition of done match the proposal.
- `openspec/AGENTS.md`: intentionally removed in `3802ad7c` ("Remove openspec/AGENTS.md"). Its no-duplicate, compatibility and license rules are carried by `config.yaml` engineering constraints and this change's design. No file to align.

## 3. OpenSpec validation (task 1.3)

| Item | Command | Result |
|---|---|---|
| `v1-0-12-release-program` | `openspec validate <id> --strict` | valid |
| `v1-0-12-runtime-trust-and-offline-install` | same | valid |
| `v1-0-12-safe-refactoring-and-architecture-guards` | same | valid |
| six archived v1.0.12 changes | `openspec validate <capability> --type spec --strict` on the synced main spec | all six valid |

`openspec validate --all --strict` reports 17 failures. None belong to v1.0.12: ten are main specs last modified on or before 2026-09-07 (placeholder Purpose sections, a missing Purpose, one SHALL/MUST wording issue in `semantic-graph-diff`), and seven are unarchived v1.0.8/v1.0.10 changes without deltas. This is pre-baseline spec debt, tracked separately from the release gate.

## 4. Identifier resolution (task 1.4)

| Identifier | Location |
|---|---|
| `v1-0-12-adaptive-agent-exploration` | `archive/2026-10-01-v1-0-12-adaptive-agent-exploration` |
| `v1-0-12-change-risk-and-test-intelligence` | `archive/2026-10-01-v1-0-12-change-risk-and-test-intelligence` |
| `v1-0-12-agentic-cross-repo-change-workflows` | `archive/2026-10-28-v1-0-12-agentic-cross-repo-change-workflows` |
| `v1-0-12-api-protocol-contract-intelligence` | `archive/2026-10-28-v1-0-12-api-protocol-contract-intelligence` |
| `v1-0-12-extensible-taint-and-dispatch` | `archive/2026-10-29-v1-0-12-extensible-taint-and-dispatch` |
| `v1-0-12-ref-aware-portable-indexes` | `archive/2026-11-03-v1-0-12-ref-aware-portable-indexes` |
| `v1-0-12-runtime-trust-and-offline-install` | `archive/2026-11-12-v1-0-12-runtime-trust-and-offline-install` |
| `v1-0-12-safe-refactoring-and-architecture-guards` | `archive/2026-11-12-v1-0-12-safe-refactoring-and-architecture-guards` |

All eight resolve. Archived identifiers carry a date prefix.

## 5. Baseline vs v1.0.12 delta per feature (tasks 1.5, 2.3)

"Baseline" is behavior already present at `20e46e8` and is not counted as v1.0.12 work. "Delta evidence" lists source files added since the baseline.

| ID | Baseline (not v1.0.12 work) | v1.0.12 delta evidence | Status |
|---|---|---|---|
| F01 | adaptive snippets, hard budgets, trust ranking, session delivery | `context/render-policy.ts`, `context/skeletonizer.ts`, `context/source-hydration.ts` | delivered |
| F02 | checksums, SBOM, provenance sidecars, cosign-signed Docker | `cli/runtime-trust.ts`, `cli/runtime-bundle-index.ts`, `scripts/distribution/build-runtime-index.mjs`; `upgrade --bundle-dir`, `verify-install` | delivered |
| F03 | search/context/inspect/impact tools; `explore` workflow asset | `query/explore.ts`; CLI `explore` | delivered |
| F04 | semantic snapshots and ref graph diff | `storage/index-view*.ts` (shared read view, ref selection) | delivered |
| F05 | none (CLI `repo rename` renames a registry entry, not a symbol) | `refactoring/{rename-plan,edit-spans,apply,verify,contracts}.ts`; CLI `refactor rename`; MCP `rename_plan` | delivered (apply for TS/JS module scope only; other languages preview-only) |
| F06 | `suggest_tests`, `coverage_gaps`, PR impact | `query/test-selection.ts` | delivered |
| F07 | eight graph-backed workflow assets | `agents/workflows/session-*.ts`, `verification.ts`, `baseline.ts`, `conditions.ts`; CLI `workflow checkpoint/verify`; `http/workflow-routes.ts` | delivered |
| F08 | CFG/dataflow/PDG/taint engine, not wired to PR impact | `program-analysis/change-slice.ts`, `program-analysis/source-map.ts` | delivered; `auto` precision stays `graph` (see §8) |
| F09 | fetch/Axios/Angular response-key extraction and compatibility | `semantic/api-contracts/shape-check.ts`, `consumers/access-paths.ts`; CLI `api-shape-check` | delivered |
| F10 | snapshot cache only | `snapshots/export-import.ts`, `portable-format.ts`, `privacy.ts`; CLI `export`/`import` | delivered |
| F11 | directory-heuristic clusters | `analysis/architecture-layers.ts` (advisory), `governance/policy-schema.ts` (explicit `.code-intel/architecture-policy.json`) | delivered |
| F12 | SARIF builder | `governance/structural-check.ts`, `governance/service.ts`, `cli/governance-commands.ts`; CLI `check`; MCP `structural_check` | delivered |
| F13 | program-analysis unit fixtures | `eval/run-pdg-mutation-bench.mjs`, `eval/fixtures/pdg-mutations/*` | delivered |
| F14 | built-in bounded taint | `program-analysis/taint/model-{schema,loader,registry}.ts`, `builtin-models.ts`, `matching.ts` | delivered |
| F15 | flow IDs not diffable; graph diff reports flow delta unsupported | `flow-detection/identity.ts` | delivered |
| F16 | GraphQL extraction hooks; group drift unknown | `semantic/protocol-contracts/graphql-*.ts`, `multi-repo/schema-parsers/graphql-model.ts`, `contract-drift/graphql-comparator.ts` | delivered |
| F17 | protobuf/gRPC extraction hooks; group drift unknown | `semantic/protocol-contracts/grpc-*.ts`, `multi-repo/schema-parsers/proto-model.ts`, `contract-drift/grpc-comparator.ts` | delivered |
| F18 | BM25/vector RRF | `search/graph-reranker.ts` (graph-aware rerank); learned reranker deferred per P2 | delivered |
| F19 | local archive install | `upgrade --bundle-dir <dir> --offline` (all network primitives denied for the transaction), `cli/runtime-archive-preflight.ts` | delivered |
| F20 | CLI/MCP/HTTP graph diff and Web `/diff` page (`GraphDiffPage.tsx`) | +66 lines to the existing page and `graph-diff-types.ts`: `IndexViewSummary`, compared-index card, `flowIdentityFingerprint`. No second page or diff engine. | delivered |
| F21 | evidence-aware resolution with heuristic dispatch | `resolution/receiver-types.ts`, `resolution/dispatch.ts` | delivered |
| F22 | contract drift links repositories, no stitched flows | `multi-repo/system-flows/*` | delivered |

Count: 22 delivered, 0 pending.

## 6. Implementation order and dependency status (task 2.1)

| # | Detailed change | Depends on | Dependency handling | Status |
|---|---|---|---|---|
| 1 | change-risk-and-test-intelligence | existing PDG | — | archived 2026-10-01 (33/33) |
| 2 | adaptive-agent-exploration | existing context/search | — | archived 2026-10-01 (24/24) |
| 3 | agentic-cross-repo-change-workflows | stable flow identity (required); Explore, ref-aware views, protocol contracts, PDG/test (optional) | required dep archived first; ref-aware views and protocol contracts were optional and degrade to an explicit reduced-guarantee boundary (proposal §14) | archived 2026-10-28 (43/43) |
| 4 | api-protocol-contract-intelligence | existing api-contracts, multi-repo | `graphql` dependency audited (`dependency-audit.md`) | archived 2026-10-28 (38/38) |
| 5 | extensible-taint-and-dispatch | existing taint, resolution | interprocedural work behind `gateInterproceduralAnalysis` | archived 2026-10-29 (34/34) |
| 6 | ref-aware-portable-indexes | existing snapshots, Generation V2 | — | archived 2026-11-03 (22/22) |
| 7 | runtime-trust-and-offline-install | existing runtime lifecycle | independent track; authenticity gated on verifier audit (`@sigstore/verify@3.1.1`, passed) | archived 2026-11-12 (20/20); main spec synced |
| 8 | safe-refactoring-and-architecture-guards | stable identity, resolution | rename verification reuses API drift and structural check | archived 2026-11-12 (24/24); main spec synced |

## 7. Delivery checkpoints (task 2.2)

| # | Checkpoint | Status | Evidence |
|---|---|---|---|
| 1 | Planning repair, strict validation | done | §3 |
| 2 | Flow identity, shared read view, snapshot read pins, safe archive extraction | done | `flow-detection/identity.ts` (10-01), `storage/index-view.ts` (10-30), `cli/runtime-archive-preflight.ts` (11-12) |
| 3 | HTTP shape check, Explore + render policy, declarative taint loading | done | `shape-check.ts` (10-28), `explore.ts`, `model-loader.ts` (10-30) |
| 4 | PDG/test intelligence, portable import/export | done | `change-slice.ts`, `test-selection.ts`, `export-import.ts` |
| 5 | GraphQL and protobuf schema compatibility | done | `graphql-comparator.ts`, `grpc-comparator.ts` (10-28) |
| 6 | Rename, architecture checks, receiver dispatch, interprocedural taint | done | `dispatch.ts`, `taint/interprocedural.ts` (10-30); `refactoring/*`, `governance/*` (11-12) |
| 7 | Workflow sessions, exact cross-repo system flows | done | `session-store.ts`, `system-flows/stitcher.ts` (10-27) |

## 8. Capability/coverage boundaries per change (task 2.4)

| Change | Boundary requirement(s) |
|---|---|
| adaptive-agent-exploration | omission receipts on budget exhaustion; language-capability-gated skeletonization (`skeletonCapabilityMatrix` in the bench result) |
| change-risk-and-test-intelligence | requested vs actual precision per function; budget hit returns a partial lower-bound result; missing-test finding requires the central coverage gate |
| agentic-cross-repo-change-workflows | missing optional capability recorded as a reduced-guarantee boundary; system flows invalid on fingerprint mismatch |
| api-protocol-contract-intelligence | coverage reported partial/unknown; compatibility stays `unknown` with a legacy-schema boundary when persisted data lacks comparator fields |
| extensible-taint-and-dispatch | candidate certainty for dispatch targets; interprocedural certainty no stronger than the crossing call edge |
| ref-aware-portable-indexes | `IndexViewBoundaryKind` (`unknown-ref`, `snapshot-not-built`, `snapshot-unsupported`, `missing-*`, …) in every selected-index response |
| runtime-trust-and-offline-install (spec) | "Legacy installations remain truthful" and "Trust status is diagnosable" requirements |
| safe-refactoring-and-architecture-guards (spec) | candidates never auto-edited; preview-only language refuses apply and reports the capability boundary; findings carry coverage/trust metadata |

All eight main specs contain the boundary requirements above.

## 9. Release-readiness matrix (task 3.1)

"Change gate" is the focused gate the detailed change recorded as passing when it was archived. "Final RC" is the re-run on the release candidate (task 3.2); see §11.

| Change | Focused gate | Change gate | Final RC |
|---|---|---|---|
| adaptive-agent-exploration | `eval/run-explore-bench.mjs`: median token reduction ≥ 25 %, correctness regression ≤ 2 pp | pass: 33 %, 0 pp, no tool errors (5 runs, synthetic fixture) | open |
| change-risk-and-test-intelligence | `eval/run-pdg-mutation-bench.mjs`: PDG relative precision gain ≥ 10 % with ≤ 2 pp recall regression enables `auto → pdg` | gate **not passed** (graph = pdg precision 0.33, recall 1.0); `auto` correctly stays `graph`. Deterministic. Not a release blocker because `pdg` is opt-in, but F08 must be described as opt-in in release notes. | open |
| agentic-cross-repo-change-workflows | session reopen tests; expected-vs-actual verification; workflow/multi-repo/core/Web/e2e/package gates | pass (task list complete) | open |
| api-protocol-contract-intelligence | parser/matcher scaling bench; core/multi-repo/API/Web/e2e/package gates; `graphql` dependency audit | pass | open |
| extensible-taint-and-dispatch | index-counter guard against per-call-site scans; dispatch precision/recall; taint TP/FP fixtures; resource-limit/cache tests | pass | open |
| ref-aware-portable-indexes | cached-ref vs current read overhead; export/import scaling; snapshot/storage/search/Web/e2e/package gates | pass | open |
| runtime-trust-and-offline-install | verifier audit gate; zero-network offline fixture; npm/license/security/build/package gates | pass: real Sigstore bundle verifies with all network primitives denied; 64 focused tests; 4-target bundle integrity; clean-machine distribution; audit gates green after dependency remediation (`dependency-audit.md`) | open |
| safe-refactoring-and-architecture-guards | rename plan bench on high-reference symbols; dry-run default; exact-only edits | pass: `rename-plan-scaling` 1600 consumers / 9601 edits planned in 346 ms; capability-matrix doc test | open |
| Release-wide | build, typecheck, core tests, Web tests, e2e, packaging, runtime distribution, security/license, OpenSpec | — | pass (§11) |

## 10. Release-wide gate run, 2026-11-12 (partial, superseded by §11)

Recorded on `release/1.0.12` @ `364cdfc` plus the uncommitted runtime-trust and dependency-remediation work. This run is not the final candidate: safe-refactoring is still pending.

| Gate | Result |
|---|---|
| Core typecheck/build, Web build | pass |
| Core tests (full serial run) | 2834 tests: 2830 pass, 3 fail, 1 skip. Failures: `integration/cli/mcp-startup` ×2 (passes 4/4 alone; fails under full-suite load because of its 1.2 s spawn timeout) and `integration/http/persistent-session-restart` (revoked cookie returns 200, expected 401; reproduces alone; pre-existing, recorded 2026-10-30; the file also hangs the runner). |
| Web tests | 52/52 (vitest 4) |
| `npm audit --audit-level=high --omit=dev` | 0 vulnerabilities. This gate failed `release-validate.yml` on `364cdfc`. |
| `npm audit --audit-level=high` | 0 high/critical (11 moderate) |
| License | 468 production packages; only LGPL is `@img/sharp-libvips-*` (`LGPL-3.0-or-later`, optional native dependency of `sharp`, present since v1.0.11, whose license gate passed) |
| Packaging (`validate:dist`), runtime bundle integrity ×4 targets, clean-machine distribution | pass |
| e2e, OpenSpec `--all` | not run in this pass |

Open before tagging: fix or quarantine `persistent-session-restart` (a real revocation-after-restart bug, not a flake), and widen the `mcp-startup` spawn timeout.

## 11. Final candidate gate run, 2026-11-12 (task 3.2)

Candidate: `release/1.0.12` @ `364cdfc` plus the uncommitted runtime-trust, safe-refactoring and release-integration changes, with package version bumped to 1.0.12 (root and core `package.json`, lockfile). Node v24.12.0, WSL2.

Changes made during this run:

- `POST /auth/logout` revokes the server-side session (`http/app.ts`). It previously cleared only the cookie, which is why `persistent-session-restart` failed. The test now closes its server in `finally`, so a failure no longer hangs the runner.
- `integration/cli/mcp-startup` spawn timeouts raised from 1.2 s to 15 s (`mcp`, exits on stdin EOF) and 5 s (`serve`).
- `release-validate.yml` validates `v1-0-12-release-program` instead of the v1.0.11 change.
- `verify-upgrade-from-1.0.10.mjs` read the managed-block version from the candidate CLI instead of hardcoding `v1.0.11`.

| Gate | Command | Result |
|---|---|---|
| Build ordering + product build | `npm run verify:build-ordering` | pass |
| Typecheck | `npx tsc -b code-intel/shared code-intel/core code-intel/web` | pass |
| Release metadata | `npm run verify:release-metadata` | pass, 1.0.12 everywhere |
| Core tests | full serial run, nothing excluded | 2894 tests, 2892 pass, 1 skip, 1 fail (see below) |
| Web tests | `vitest run` | 52/52 |
| e2e | `npm run test:e2e --workspace=code-intel/core` | 13/13 |
| npm tarball | `validate:dist`, `verify:npm-install`, `verify:packaged-smoke-matrix` | pass |
| Runtime bundles | `prepare:runtime-native-packages`, four `build-runtime-bundle.mjs` targets, `verify:runtime-bundle-integrity` | pass, 4/4 |
| Runtime distribution | `verify:runtime-distribution` | pass after rebuild |
| Upgrade compatibility | `verify:upgrade-from-1.0.10` | pass after the script fix above |
| Security | `npm audit --audit-level=high` with and without `--omit=dev` | 0 high/critical; 1 moderate (`minimatch`) in production |
| License | lockfile walk of production packages against the CI `--failOn` list | 498 packages; only LGPL is optional `@img/sharp-*` |
| OpenSpec | `validate v1-0-12-release-program --strict`; eight v1.0.12 main specs `--type spec --strict` | all valid; `--all` has the same 17 pre-baseline failures as §3 |

The one core failure, `integration/cli/runtime-distribution-verify`, was an ordering artifact of this run. The typecheck command emits into `code-intel/core/dist` (`tsconfig.json` `outDir`), and I ran it after the product build, so it replaced tsup's bundled `cli/app.js` with per-file output. The bundled runtime then imported `dist/auth/middleware.js`, which needs `bcryptjs`, a core devDependency that only reaches the runtime when tsup inlines it, and `analyze` failed with `ERR_MODULE_NOT_FOUND`. After `npm run build:product`, `dist/auth/` does not exist and the same script passed. CI runs typecheck before the build, so it is not affected.

Open items, not release blockers:

- `bcryptjs` is imported at runtime but declared in `devDependencies`. It works only because tsup inlines it into `cli/app.js`. Moving it to `dependencies` removes that trap.
- The CI license step (`npx license-checker --production` at the repo root) checks only 5 packages because it does not walk the npm workspace tree. Its pass is not evidence; the lockfile walk above is.
- There is no automated upgrade check from a published 1.0.11 install. The existing script starts from 1.0.10 and its log lines still say "1.0.11" for the candidate.
- `code-intel upgrade` with no arguments prints a stack trace instead of a usage message.
- The Docker image build and Trivy scan run only in CI and were not run here.
- `CHANGELOG.md` lists 1.0.12 as `Unreleased`; set the date when the tag is cut.
