# Proposal: v1.0.11 Release Readiness and Hardening

## Change Name

`v1-0-11-release-readiness-hardening`

## Purpose

Prepare `code-intel-platform` version `1.0.11` for production release by proving that the implemented capabilities are consistent, reproducible, backward-compatible, correctly documented, safely packaged, and validated on the exact release commit.

This is a release-hardening change. It MUST NOT introduce another major product feature into `1.0.11`.

The target invariant is:

```text
OpenSpec
= Source Code
= Tests
= README / CHANGELOG
= Packaged Runtime
= Published Release
```

The release MUST NOT depend on stale build artifacts, previous test side effects, hidden caches, or undocumented assumptions.

## Background

`release/1.0.11` contains substantial semantic and platform work, including:

- fifteen-language semantic baseline
- universal semantic fact model
- Symbol Identity V2
- evidence-based resolution
- relationship certainty and coverage semantics
- Generation semantic verification
- context evidence delivery
- framework semantic adapters
- dependency-aware incremental-resolution foundation
- graph-aware API contracts
- branch-aware semantic graph diff
- cross-repository contract drift
- graph-backed agent workflows
- self-contained runtime distribution/lifecycle
- program-analysis foundation: universal IR, CFG, dominators/control dependence, reaching definitions, def-use, function summaries, PDG and bounded taint analysis

Feature development for `1.0.11` is considered frozen. Remaining work is release correctness and release evidence.

## Goals

1. **Reproducible clean build** — a fresh checkout can build every release artifact without files produced by an earlier test/build.
2. **Semantic correctness** — cold, cached, forced and eligible incremental paths converge to the same normalized semantic result.
3. **Compatibility safety** — `1.0.10` repositories/configuration/index state transition safely to `1.0.11`, and rollback behavior is explicit.
4. **Documentation accuracy** — README, CHANGELOG, OpenSpec and release notes describe actual implementation maturity and limitations.
5. **Exact-SHA release evidence** — the exact commit tagged `v1.0.11` has passed the complete release validation workflow before publication.
6. **Artifact integrity** — npm, Docker and self-contained runtime artifacts have verifiable checksums/provenance/SBOM/signatures where applicable.
7. **No silent uncertainty** — bounded/truncated/ambiguous/stale results remain explicit to CLI, MCP, HTTP and agent consumers.

## Non-Goals

The following are explicitly deferred beyond `1.0.11` unless required to fix a release-blocking defect:

- new programming languages such as Zig
- new major framework adapters
- full public PDG/taint explorer UX
- AsyncAPI or new messaging intelligence
- GraphQL contract-drift expansion
- new agent workflow families
- remote repository index fleet
- broad production activation of dependency-aware incremental semantic publication
- semantic-snapshot incremental seeding proposal implementation
- Web UI redesign
- graph database replacement
- whole-platform TypeScript-to-Rust rewrite

## Release Baseline and Freeze Rules

The release branch is `release/1.0.11`.

Before tagging, one commit SHA MUST be designated as the release candidate (`RC_COMMIT`). Every release gate MUST execute against that exact SHA.

Any code, documentation, dependency or workflow change after validation creates a new candidate SHA and invalidates the previous validation evidence. The complete required release validation MUST be rerun.

No new feature work is allowed after the release candidate freeze. Newly discovered non-blocking feature requests move to `1.0.12` or `1.1.x`.

---

# Workstream A — Build and Packaging Reproducibility

## A1. Make product build ordering explicit

Audit:

- root `package.json`
- `code-intel/core/package.json`
- `code-intel/web/package.json`
- `.github/workflows/publish.yml`
- Docker build files
- `scripts/distribution/*`

Core packaging MUST NOT succeed merely because unit tests previously created `code-intel/web/dist`.

Define one authoritative product build order, conceptually:

```text
shared -> web -> core/package
```

Prefer a single reusable command such as `build:product`, or equivalent workspace orchestration, so local builds, CI, Docker and npm publication do not encode different dependency orders.

### Validation

From a fresh checkout:

```bash
git clean -xfd
npm ci --legacy-peer-deps --ignore-scripts --include=optional
# rebuild required native modules where the supported build requires it
npm run <authoritative-product-build>
```

Before the product build starts, `code-intel/web/dist` and `code-intel/core/dist` MUST NOT exist.

### Acceptance criteria

- clean build succeeds without running tests first
- Web assets required by Core packaging are generated explicitly
- CI and Docker use the same dependency ordering
- a test or verification script fails if Core packaging is attempted with required Web assets missing

## A2. Clean Docker build

Validate the actual publish path from a fresh checkout with no host `dist` artifacts.

Acceptance:

- supported multi-arch build path succeeds
- Dockerfile does not depend on host build leftovers
- required Web, grammar and workflow assets exist inside the produced image
- packaged CLI starts successfully inside the image

## A3. Clean npm package

From a fresh checkout build and execute `npm pack` for the Core package.

Inspect the tarball and verify it includes required runtime assets:

- CLI/MCP runtime
- Web UI distribution
- bundled grammars
- workflow/agent assets
- package metadata
- README/LICENSE as required

It MUST NOT accidentally include credentials, local caches, `.code-intel`, unrelated fixtures or workspace-only artifacts.

Install the generated tarball into an isolated directory and smoke-test at minimum:

```text
code-intel --version
code-intel doctor
code-intel analyze <fixture>
MCP startup
Web/server startup where supported
```

## A4. Self-contained runtime bundles

Build every supported runtime target from a clean checkout. Validate archive layout, executable startup, checksums, SBOM and provenance metadata.

---

# Workstream B — Pre-Release CI and Exact-SHA Evidence

## B1. Add a pre-release validation path

The complete validation MUST be runnable before a tag triggers publication.

Support at least:

- `workflow_dispatch`
- release-branch execution (`release/**`) or an equivalent explicit RC workflow

A dedicated `release-validate.yml` is acceptable, but duplication with `publish.yml` SHOULD be minimized by sharing scripts/jobs where practical.

## B2. Required validation gates

The pre-release workflow MUST cover:

### Static/build validation

- TypeScript project build/typecheck
- OpenSpec validation
- workflow/agent asset validation
- package/distribution layout validation

### Test suites

- unit
- integration
- e2e where maintained
- semantic fact extraction/resolution
- Symbol Identity V2
- evidence/relationship certainty
- Generation verification
- framework adapters
- API contracts
- branch graph diff/snapshot safety
- cross-repository contract drift
- program analysis
- semantic convergence gates described below

### Packaging

- clean product build
- npm pack/install smoke
- self-contained runtime build/verification
- Docker publish-path build verification

### Security/compliance

- production dependency audit
- license audit
- image vulnerability gate where applicable
- artifact provenance checks

### Compatibility

- `1.0.10 -> 1.0.11` upgrade smoke
- legacy index compatibility/rebuild behavior
- rollback/data-preservation smoke

## B3. Record exact release evidence

The workflow output/artifacts MUST identify:

- commit SHA
- package version
- Node/runtime version
- runner OS/architecture
- package/runtime hashes
- Docker digest when built/published

The `v1.0.11` tag MUST point to the successfully validated SHA.

---

# Workstream C — OpenSpec Consistency and Scope Closure

Audit all `v1-0-11-*` changes, including archived changes. A checked/archived requirement MUST correspond to implemented behavior, a passing validation, or an explicitly documented scoped limitation.

At minimum review:

- `v1-0-11-fifteen-language-semantic-baseline`
- `v1-0-11-universal-semantic-fact-model`
- `v1-0-11-symbol-identity-v2`
- `v1-0-11-evidence-based-resolution`
- `v1-0-11-relationship-certainty`
- `v1-0-11-generation-semantic-verification`
- `v1-0-11-context-evidence-delivery`
- `v1-0-11-framework-semantic-adapters`
- `v1-0-11-dependency-aware-incremental-resolution`
- `v1-0-11-graph-aware-api-contracts`
- `v1-0-11-branch-aware-semantic-graph-diff`
- `v1-0-11-cross-repository-contract-drift`
- `v1-0-11-graph-backed-agent-workflows`
- `v1-0-11-program-analysis-foundation`
- `v1-0-11-self-contained-runtime-distribution`

Special requirement: documentation MUST distinguish the implemented dependency-aware incremental engine/foundation from production activation. Do not state that dependency-aware semantic incremental publication is fully active when the live publication path remains conservative or the dependency-aware delta is not wired into that path.

---

# Workstream D — Program-Analysis Release Truth

## D1. Establish one authoritative capability matrix

Derive the language/capability matrix from source and passing tests, not commit messages or manual claims.

For every language report the status of applicable capabilities:

- lowering to universal IR
- CFG
- dominator/control-dependence analysis
- reaching definitions
- def-use
- summaries
- PDG
- bounded taint

Use explicit statuses such as `supported`, `partial`, `not-applicable`, and document what `supported` proves.

## D2. Reconcile language-count inconsistencies

Search and reconcile all references in:

- capability registry
- program-analysis tests
- README
- CHANGELOG
- OpenSpec
- release notes/comments that become user-facing documentation

There MUST NOT be contradictory claims such as one source saying 10 verified languages while another authoritative registry says 11 supported.

## D3. Document maturity accurately

README/CHANGELOG MUST describe `1.0.11` as a program-analysis foundation/initial integration unless all advanced PDG/taint surfaces are genuinely exposed and tested.

Do not imply mature public GitNexus-equivalent PDG/taint exploration when only internal modules or limited inspect integration exists.

## D4. Resource and uncertainty behavior

Validate program-analysis limits and ensure truncation/unknown/unsupported constructs are represented explicitly rather than silently interpreted as complete proof.

---

# Workstream E — Semantic Convergence Gates

Semantic convergence is a P0 release gate.

## E1. Cold vs cached vs forced convergence

For the same source revision prove:

```text
normalized(cold analysis)
== normalized(warm/cached analysis)
== normalized(forced rebuild)
```

Do not compare only node/edge counts. Compare canonical semantic fingerprints/content covering at least:

- canonical symbols
- relationship identity
- repeated call-site identity where applicable
- relationship certainty/trust
- evidence/provenance
- API contracts
- semantic index/fingerprints
- program-analysis summaries/artifact identities where applicable

## E2. Full vs incremental final-state convergence

Where incremental behavior is eligible/implemented, prove:

```text
normalized(incremental final state)
== normalized(independent full rebuild final state)
```

Required mutation fixtures should include, where supported:

### Source structure

- function body edit
- add/delete function
- rename symbol
- move symbol
- move file
- add/delete file

### Resolution

- import change
- export/barrel change
- inheritance/interface change
- implementation change
- overloaded/same-simple-name symbol case

### API/contracts

- add/remove route
- HTTP method change
- route path change
- request/response shape change
- consumer change

## E3. Cross-file invalidation cases

Include explicit cases where the dependent source file itself is unchanged:

```text
A imports B; B changes; A unchanged
```

and equivalent inheritance/export/contract scenarios.

## E4. Persistence/reopen convergence

After analysis, close and reopen persisted stores and prove the normalized semantic answer remains equivalent. Ambiguous relationships MUST NOT become exact merely because of persistence/reload.

---

# Workstream F — Semantic Cache and Producer Fingerprint Correctness

## F1. Cache invalidation MUST include semantic producer identity

Add tests proving:

```text
same source bytes + changed semantic producer fingerprint = cache miss/reanalysis
```

Audit fingerprints for at least:

- parser/grammar identity
- extraction/query/fact schema identity
- Symbol Identity version
- resolver version
- evidence schema/logic
- framework adapters
- API contract producer
- program-analysis lowering version
- program-analysis version
- semantic graph fingerprint dependencies

## F2. Generation compatibility

If a producer/schema fingerprint changes, incompatible cached semantic artifacts MUST NOT be silently treated as current. Generation compatibility should reject/rebuild according to the existing architecture.

## F3. Derived-artifact invalidation

Verify BM25/vector/API-contract/program-analysis/other derived artifacts are invalidated or rebuilt when their semantic inputs or producer versions change.

---

# Workstream G — Backward Compatibility and Migration

## G1. Real `1.0.10 -> 1.0.11` upgrade fixture

Create an isolated state using the actual `1.0.10` distribution where practical:

- analyze a representative fixture repository
- create persisted repository metadata
- create a repository group if supported
- configure relevant agent/runtime settings
- create indexes/embeddings as appropriate

Upgrade to the candidate `1.0.11` package/runtime.

Verify:

- repository identity/name preserved
- configuration preserved
- repository-group membership preserved
- agent target/custom assets preserved according to lifecycle rules
- incompatible index state is rejected/rebuilt rather than silently trusted
- MCP starts
- Web/server starts
- representative search/inspect/impact operations work

## G2. Legacy index behavior

Explicitly test old graph/index metadata against new identity/resolver/evidence/schema fingerprints.

Expected behavior is either safe compatibility or explicit rebuild. Silent stale reuse is a release blocker.

## G3. Rollback smoke

Test the documented rollback path after `1.0.11` has run. Configuration and user-owned data MUST NOT be corrupted or deleted.

If `1.0.10` cannot consume `1.0.11` indexes, rollback MUST fail safely or request reanalysis rather than returning misleading semantic results.

## G4. Additive API/MCP compatibility

Audit modified MCP/HTTP response contracts. Existing fields MUST retain meaning unless a breaking change is explicitly documented. New trust/evidence/truncation fields SHOULD be additive so older clients that ignore unknown fields continue to work.

---

# Workstream H — Completeness, Truncation and Coverage Semantics

Audit bounded result surfaces including where applicable:

- search
- callers/callees
- blast radius
- path finding
- flows
- context
- PR/change impact
- API consumers
- cross-repository consumers
- program-analysis/data-flow results

A bounded response MUST make incompleteness explicit. Prefer a consistent contract such as:

```json
{
  "returned": 20,
  "totalKnown": 174,
  "truncated": true
}
```

where the engine can know the total. If total is unknown, represent that explicitly rather than inventing a value.

Agents and users MUST NOT be able to interpret `returned == limit` as proof that the result set is complete.

---

# Workstream I — README Release Update

README update is mandatory for this proposal.

## I1. Version/badge correctness

Do not present `1.0.11` as already published to npm before publication. Prefer a dynamic npm badge or release-candidate wording until publish. After publish, verify the public registry reports `1.0.11`.

## I2. Architecture diagram/text

Update stale architecture descriptions to reflect the actual semantic architecture, conceptually:

```text
Tree-sitter
  -> Semantic Facts
  -> Symbol Identity V2
  -> Evidence-Based Resolution
  -> Evidence-Carrying Knowledge Graph
       -> Search / Context
       -> API / Contracts
       -> Change Intelligence
       -> Program Analysis (IR/CFG/Dataflow/PDG/Taint)
```

The final diagram MUST match real modules rather than being marketing-only.

## I3. Program Analysis section

Document:

- universal IR
- CFG
- dominator/control-dependence support
- reaching definitions/def-use
- function summaries
- PDG
- bounded taint
- supported/partial/not-applicable language matrix
- resource/truncation behavior
- current public integration
- current limitations

## I4. Incremental terminology

Clearly distinguish:

- file/change detection
- dependency-aware incremental engine/foundation
- production publication behavior
- semantic snapshot building/seeding

Do not use one broad claim that makes unactivated behavior appear production-enabled.

## I5. Installation/runtime lifecycle

Verify install, doctor, upgrade, pin, rollback and uninstall documentation matches the packaged `1.0.11` behavior.

---

# Workstream J — CHANGELOG and Release Notes

CHANGELOG update is mandatory for this proposal.

## J1. Release date

Before actual release use `Unreleased` or another clearly non-published marker. At the final release commit/tag set the real release date. Do not retain an earlier development date as if it were the publication date.

## J2. Program Analysis Foundation entry

Add a user-facing section covering the implemented foundation and its limitations. Avoid claiming every internal analysis is already a mature public MCP/HTTP/UI workflow.

## J3. Performance statement accuracy

The new graph-diff scaling tests exercise the diff stage at large normalized graph sizes. Do not claim that full end-to-end 10k/100k repository snapshot analysis has been benchmarked unless it actually has.

Recommended distinction:

> The graph-diff stage is regression-tested at 10k/100k normalized entities. Full end-to-end 10k/100k snapshot-build benchmarking has not yet been performed.

## J4. Incremental-resolution wording

Describe implemented architecture and current rollout status separately.

## J5. Breaking/migration notes

Document any index rebuild, schema/fingerprint incompatibility, upgrade behavior or changed defaults relevant to `1.0.10` users.

---

# Workstream K — Snapshot/Diff Observability and Performance

## K1. Validate per-phase timing/RSS instrumentation

Validate newly introduced snapshot/diff metrics for phases such as:

- materialization
- analysis
- readback
- fingerprinting
- normalization
- graph diff
- contract diff

## K2. RSS semantics

Where analysis runs in a child process, parent-process `rssDeltaBytes` MUST NOT be documented as analyzer peak RSS. Document the measurement boundary accurately.

## K3. Scaling regression tests

Keep deterministic algorithmic scaling tests separate from noisy wall-clock CI gates. Large synthetic normalized-graph tests should verify result stability and guard pathological regressions.

If wall-clock thresholds are introduced, use representative baselines/tolerance and avoid flaky strict timing assertions on shared CI runners.

---

# Workstream L — Security, Licensing and Supply Chain

## L1. Production dependency audit

Run the release gate equivalent of:

```bash
npm audit --audit-level=high --omit=dev
```

Unaccepted high/critical production vulnerabilities block release.

## L2. License audit

Verify production/runtime dependencies remain compatible with MIT/commercial distribution policy. New/transitive copyleft or noncommercial restrictions MUST be reviewed before release.

## L3. Container vulnerability scan

Published Docker image MUST be scanned. Critical vulnerabilities block release according to existing policy; high findings require explicit review.

## L4. Secret/package-content review

Verify npm tarball, Docker context, runtime bundles and generated provenance do not contain tokens, local credentials or sensitive developer files.

## L5. Provenance and signing

Validate the configured release supply chain produces, as applicable:

- npm provenance
- immutable Docker digest
- Docker provenance
- cosign signature
- runtime archive SHA-256
- runtime SBOM
- runtime/GitHub build provenance attestation

---

# Workstream M — Runtime Lifecycle Smoke Tests

For self-contained distribution validate supported flows:

```text
install
-> doctor
-> analyze
-> MCP/server
-> upgrade
-> version list
-> version pin
-> rollback
-> uninstall
```

User-modified workflow/agent assets and persisted data MUST follow the documented preservation policy. Uninstall MUST NOT behave like purge unless purge is explicitly requested.

---

# Workstream N — Agent Workflow Safety

Validate all bundled graph-backed workflows/skills present in the release.

For each workflow verify:

- referenced MCP tools exist
- required input/output fields exist
- optional-tool fallback is valid
- workflow registry validation passes
- user-modified assets are preserved according to lifecycle state
- install/upgrade/dry-run behavior is deterministic

Behavioral agent benchmarking is valuable future work but is not required to add new workflow functionality to this release-hardening change.

---

# Workstream O — Web, CLI, HTTP and MCP Smoke Matrix

Using the actual packaged candidate, execute representative user journeys rather than only source-level tests.

At minimum validate:

### CLI/runtime

- version
- doctor
- analyze
- repository listing/status
- server/Web startup
- MCP startup

### MCP

Exercise representative existing tools such as:

- repos/overview
- search
- inspect
- context
- blast radius
- explain relationship
- PR/change impact
- graph diff where exposed
- API/contract intelligence
- group/cross-repository intelligence
- suggested tests/health

Use actual registered tool names from source; do not create release tests from stale documentation names.

### Web

Smoke-test major existing surfaces and error/empty states. At minimum ensure partial/ambiguous/stale/truncated semantic states do not crash the UI.

### HTTP

Verify representative existing API endpoints and compatibility of additive evidence/trust fields.

---

# Workstream P — Release Candidate Procedure

1. Freeze feature development on `release/1.0.11`.
2. Complete this hardening change and required documentation.
3. Ensure version metadata is `1.0.11` but CHANGELOG does not falsely state publication before release.
4. Select `RC_COMMIT`.
5. Run the complete pre-release validation against that exact SHA.
6. If any fix is committed, select the new SHA and rerun all mandatory gates.
7. When green, set the real CHANGELOG release date.
8. Verify README/version/release notes.
9. Tag `v1.0.11` at the validated SHA.
10. Let the publication workflow produce npm, Docker and runtime artifacts.
11. Run post-publication smoke validation against downloaded/pulled artifacts, not local workspace builds.

---

# Post-Publish Validation

Verify the public npm registry reports `1.0.11`, then install it in a fresh environment and verify `code-intel --version`, doctor, analysis and MCP/server startup.

Verify published Docker tag/digest/signature and smoke-test the pulled image.

Verify GitHub/runtime artifacts, checksums, SBOM and provenance.

A local build passing is not sufficient evidence that the published artifact is correct.

---

# Rollback Plan

An already-published npm version MUST NOT be silently replaced. A critical npm defect after publication should normally be corrected by a subsequent patch version.

For Docker, retain immutable digests and stop promoting a defective digest to mutable aliases such as `latest` where applicable.

Self-contained runtime distribution MUST keep the previous known-good version available for version pin/rollback according to existing lifecycle behavior.

Rollback MUST preserve user configuration and data or clearly state/recover from index incompatibility.

---

# Required Release Test Matrix

The following MUST be green or explicitly waived with documented rationale before release:

| Area | Required result |
|---|---|
| Typecheck/build | PASS |
| Core unit tests | PASS |
| Integration tests | PASS |
| E2E maintained for release path | PASS |
| Semantic language baseline | PASS |
| Universal semantic facts | PASS |
| Symbol Identity V2 | PASS |
| Evidence-based resolution | PASS |
| Relationship certainty/coverage | PASS |
| Generation verification | PASS |
| Framework semantic adapters | PASS |
| API contracts | PASS |
| Branch semantic graph diff | PASS |
| Cross-repository contract drift | PASS |
| Program-analysis foundation | PASS |
| Snapshot safety/failure modes | PASS |
| Cold/cached/forced convergence | PASS |
| Full/incremental convergence for eligible paths | PASS |
| Persistence/reopen semantic equivalence | PASS |
| Clean npm pack/install | PASS |
| Clean Docker build | PASS |
| Runtime bundle verification | PASS |
| `1.0.10 -> 1.0.11` upgrade smoke | PASS |
| Rollback/data-preservation smoke | PASS |
| Production dependency audit | PASS |
| License audit | PASS |
| OpenSpec validation | PASS |
| Exact release SHA pre-release CI | PASS |

---

# Release Blockers

The release MUST NOT proceed while any of the following is true:

- the exact release SHA has no successful pre-release validation evidence
- clean product build requires stale `dist` output or test side effects
- npm/Docker/runtime packages are missing required runtime assets
- cold/cached/forced semantic results diverge
- eligible incremental final state diverges from independent full rebuild
- semantic producer changes can incorrectly reuse stale cache artifacts
- incompatible `1.0.10` index state is silently treated as current
- supported-language/program-analysis claims contradict tests or registry
- README/CHANGELOG contains a known false release or benchmark claim
- production dependency audit has unaccepted high/critical findings
- incompatible dependency licensing is introduced
- artifact integrity/provenance required by the release workflow cannot be verified
- upgrade or rollback corrupts repository registry, groups, configuration or user-owned assets
- a bounded/ambiguous semantic result is incorrectly exposed as exact/complete in a release-critical path

---

# Suggested Implementation Tasks

## Build and CI

- [ ] Audit and fix authoritative Shared -> Web -> Core product build ordering.
- [ ] Remove release validation dependence on unit-test-created Web artifacts.
- [ ] Add/reuse a pre-release workflow runnable on `release/**` and `workflow_dispatch`.
- [ ] Add clean npm pack/install verification.
- [ ] Add clean Docker publish-path verification.
- [ ] Add clean self-contained runtime verification.
- [ ] Record exact validated commit SHA and artifact hashes.

## Semantic correctness

- [ ] Add cold-vs-cached-vs-forced convergence tests.
- [ ] Add full-vs-incremental final-state convergence tests for eligible paths.
- [ ] Cover edit/add/delete/rename/move/import/export/inheritance/API-contract mutations.
- [ ] Add persistence/reopen equivalence checks.
- [ ] Verify repeated call-site identity survives persistence.
- [ ] Verify ambiguity cannot silently become exact after reopen/cache reuse.

## Cache/version compatibility

- [ ] Test source-unchanged + parser/extractor semantic change => cache miss.
- [ ] Test source-unchanged + fact-schema change => cache miss.
- [ ] Test source-unchanged + identity/resolver/evidence change => cache miss.
- [ ] Test framework-adapter/API-contract producer changes invalidate affected derived state.
- [ ] Test program-analysis lowering/version changes invalidate affected artifacts.
- [ ] Verify Generation compatibility rejects incompatible semantic producer fingerprints.

## Program analysis

- [ ] Reconcile supported/partial language count across registry, tests, README, CHANGELOG and OpenSpec.
- [ ] Produce authoritative program-analysis capability matrix from tests.
- [ ] Validate resource-limit/truncation/unknown semantics.
- [ ] Validate program-analysis cache fingerprinting.
- [ ] Document foundation/public-surface boundary accurately.

## Backward compatibility

- [ ] Build an actual `1.0.10` compatibility fixture/state.
- [ ] Upgrade it using the candidate `1.0.11` package/runtime.
- [ ] Verify repository registry, groups and configuration preservation.
- [ ] Verify incompatible old indexes trigger safe rebuild/rejection.
- [ ] Verify representative MCP/Web/search/inspect/impact behavior after upgrade.
- [ ] Execute rollback/data-preservation smoke test.
- [ ] Audit additive MCP/HTTP response compatibility.

## Completeness semantics

- [ ] Audit bounded search/graph/change/API/program-analysis surfaces.
- [ ] Add consistent `returned`/`totalKnown`/`truncated` metadata where appropriate.
- [ ] Ensure unknown totals and partial coverage remain explicit.
- [ ] Add tests preventing agents/clients from interpreting truncation as complete proof.

## Documentation

- [ ] Update `README.md` architecture to semantic facts -> identity -> evidence resolution -> evidence graph -> downstream intelligence.
- [ ] Add/update README Program Analysis Foundation and language matrix.
- [ ] Correct README version/npm badge behavior around publication.
- [ ] Clarify incremental engine foundation vs production activation.
- [ ] Verify runtime lifecycle documentation.
- [ ] Update `CHANGELOG.md` release date only when actually releasing.
- [ ] Add Program Analysis Foundation release entry and limitations.
- [ ] Correct 10k/100k graph-diff benchmark wording.
- [ ] Document parent-vs-child RSS measurement limitation.
- [ ] Document upgrade/index rebuild/compatibility behavior.

## Security and artifacts

- [ ] Run production dependency audit and resolve/approve findings.
- [ ] Run production license audit.
- [ ] Run container vulnerability gate.
- [ ] Verify package/runtime artifacts contain no credentials/local sensitive files.
- [ ] Verify npm provenance.
- [ ] Verify Docker digest/provenance/cosign signature.
- [ ] Verify runtime SHA-256, SBOM and provenance attestations.

## Final release

- [ ] Freeze feature development.
- [ ] Select exact RC SHA.
- [ ] Run complete release validation on that SHA.
- [ ] Rerun from the beginning if the SHA changes.
- [ ] Set final CHANGELOG release date.
- [ ] Confirm package version `1.0.11`.
- [ ] Tag `v1.0.11` at the validated SHA.
- [ ] Publish npm package, Docker image and runtime bundles through the release workflow.
- [ ] Create/verify GitHub Release artifacts.
- [ ] Install from public npm in a fresh environment and smoke-test.
- [ ] Pull the published Docker image and smoke-test.
- [ ] Verify public artifact signatures/checksums/provenance.

---

# Validation Strategy

Release validation has three independent layers:

## Layer 1 — Source correctness

- typecheck/build
- unit/integration/e2e
- OpenSpec validation
- semantic convergence
- compatibility tests

## Layer 2 — Packaging correctness

- npm pack/install
- Docker build
- self-contained runtime bundles

## Layer 3 — Published artifact correctness

- install from public npm
- pull published Docker image
- install/download published runtime archive
- verify signatures/checksums/provenance

Passing Layer 1 does not imply Layers 2 or 3 are correct.

---

# Definition of Done

`v1.0.11` is release-ready only when:

```text
all release blockers closed
+ all mandatory release tests green
+ exact release SHA validated
+ README/CHANGELOG/OpenSpec match source behavior
+ semantic convergence proven
+ upgrade/rollback behavior verified
+ clean package builds reproducible
+ security/license gates pass
+ release artifacts are verifiable
```

At that point the branch remains feature-frozen and the validated SHA may be tagged and published as `v1.0.11`.
