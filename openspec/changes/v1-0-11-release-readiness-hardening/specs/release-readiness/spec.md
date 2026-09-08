# Release Readiness Specification

## ADDED Requirements

### Requirement: Release validation MUST be reproducible from a clean checkout

The `v1.0.11` release build MUST succeed from a clean checkout without depending on generated artifacts left by prior tests or build steps.

#### Scenario: Clean product build

- **WHEN** all generated `dist`/release output directories are removed before the supported product build
- **THEN** the build MUST recreate every required Shared, Web and Core release artifact
- **AND** Core packaging MUST NOT depend on Web output generated as a side effect of an earlier test command.

#### Scenario: Docker build from clean source

- **WHEN** the production Docker image is built from a clean checkout with no host build artifacts
- **THEN** the image build MUST succeed
- **AND** the image MUST contain the required CLI, Web, grammar, workflow and native runtime assets.

### Requirement: One authoritative pre-release path MUST validate the exact candidate SHA before tagging

A `v1.0.11` tag MUST NOT be created until the exact candidate commit has passed the complete release validation path.

#### Scenario: Candidate passes validation

- **WHEN** pre-release CI completes successfully for a candidate commit
- **THEN** the evidence MUST identify that exact commit SHA and package version
- **AND** the release tag MAY point to that SHA.

#### Scenario: Candidate changes after validation

- **WHEN** any source, documentation, dependency, workflow or metadata commit is added after candidate validation
- **THEN** prior release evidence MUST be considered stale
- **AND** the complete mandatory release validation MUST be rerun against the new SHA.

### Requirement: Active release workflows MUST agree on version and release policy

All workflows that act as `v1.0.11` release gates MUST use compatible version assertions, build ordering and required validation semantics.

#### Scenario: Stale prior-version workflow remains in repository

- **WHEN** an active release workflow still asserts `1.0.10` or follows an obsolete build path
- **THEN** it MUST be updated, retired from `1.0.11` gating, or assigned a clearly non-conflicting purpose
- **AND** it MUST NOT be allowed to represent `1.0.11` release readiness.

### Requirement: npm release packaging MUST be tested as an installed artifact

Source-level tests alone MUST NOT be sufficient evidence that the npm package is releasable.

#### Scenario: Candidate npm tarball is built

- **WHEN** `npm pack` produces the candidate package
- **THEN** the tarball contents MUST be inspected for required and forbidden files
- **AND** the tarball MUST be installed into an isolated environment without workspace symlinks
- **AND** representative packaged CLI/runtime smoke tests MUST pass.

### Requirement: Self-contained runtime artifacts MUST carry verifiable integrity metadata

Every supported self-contained runtime archive produced for the release MUST have verifiable target/version identity and integrity sidecars.

#### Scenario: Runtime archive is produced

- **WHEN** a release runtime archive is assembled
- **THEN** its SHA-256 sidecar MUST match the archive bytes
- **AND** its SBOM and provenance metadata MUST parse successfully
- **AND** the metadata MUST identify the corresponding release version/target.

### Requirement: Docker release artifacts MUST be built and scanned independently of workspace artifacts

The production Docker path MUST be reproducible and security-gated.

#### Scenario: Candidate image is assembled

- **WHEN** pre-release CI builds the production image
- **THEN** the build MUST not rely on host `dist` directories
- **AND** the image MUST pass the configured critical-vulnerability gate
- **AND** its packaged CLI version MUST equal `1.0.11`.

### Requirement: Cold, cached/no-op and forced analysis MUST converge semantically

For an unchanged source revision, supported analysis paths MUST produce equivalent normalized semantic state.

#### Scenario: Same revision is analyzed through different paths

- **WHEN** a repository is analyzed cold, reopened/no-op cached, and force rebuilt
- **THEN** normalized canonical symbols and relationships MUST be equivalent
- **AND** call-site identity, certainty/strategy/evidence semantics MUST remain equivalent
- **AND** differences in volatile Generation IDs/timestamps MUST NOT be treated as semantic differences.

### Requirement: Any active incremental semantic path MUST converge to an independent full rebuild

An active production incremental semantic executor MUST NOT publish a final semantic state that differs from a clean full rebuild of the same final source tree.

#### Scenario: Incremental execution is actually used

- **WHEN** a supported change is processed through an active incremental semantic executor
- **THEN** its final normalized persisted state MUST equal an independently forced full rebuild
- **AND** cross-file relationships and evidence MUST match.

#### Scenario: Current implementation uses correctness-first full rebuild instead

- **WHEN** a change-detection path ultimately performs a full rebuild rather than surgical incremental execution
- **THEN** release tests/documentation MUST describe it as a full rebuild
- **AND** MUST NOT claim that dependency-aware incremental execution was exercised merely because planning/foundation modules exist.

### Requirement: Semantic cache reuse MUST depend on semantic producer compatibility

Source bytes alone MUST NOT determine whether semantic artifacts are reusable.

#### Scenario: Producer semantics change without source changes

- **WHEN** parser/extractor/fact-schema/identity/resolver/evidence/framework/API-contract/program-analysis compatibility fingerprint changes while source bytes remain unchanged
- **THEN** incompatible semantic artifacts MUST be invalidated, rebuilt, or rejected
- **AND** MUST NOT reopen as trusted current state.

### Requirement: Persistence MUST not strengthen ambiguity or lose evidence

Persisting and reopening semantic state MUST preserve relationship meaning.

#### Scenario: Ambiguous relationship is persisted

- **WHEN** an ambiguous/candidate relationship is written and later reopened
- **THEN** it MUST remain ambiguous/candidate unless new evidence is produced by a new analysis
- **AND** persistence alone MUST NOT turn it into an exact relationship.

#### Scenario: Evidence-backed relationship is persisted

- **WHEN** an evidence-backed relationship is written and reopened
- **THEN** required evidence/trust metadata MUST remain available or coverage MUST degrade explicitly
- **AND** it MUST NOT silently appear exact without evidence.

### Requirement: Program-analysis capability claims MUST come from one authoritative tested matrix

`v1.0.11` documentation MUST use a single reconciled source of truth for program-analysis language support.

#### Scenario: Registry and release text disagree

- **WHEN** a capability registry, test count, README, CHANGELOG or OpenSpec statement reports a different supported-language count/status
- **THEN** the discrepancy MUST be resolved before release
- **AND** the final claim MUST be supported by the repository-defined real-parse/integration evidence.

### Requirement: Program-analysis maturity MUST distinguish engine support from public product surface

Internal implementation of CFG/PDG/dataflow/taint MUST NOT automatically imply mature public exploration support.

#### Scenario: Internal advanced artifact exists without full public surface

- **WHEN** an internal program-analysis capability is implemented but only partially exposed through inspect/other existing flows
- **THEN** release documentation MUST call out the foundation/initial integration boundary
- **AND** MUST NOT advertise a complete public advanced-analysis explorer.

### Requirement: Resource/truncation boundaries MUST remain explicit

A result produced under a limit, candidate cap or incomplete analysis boundary MUST not be represented as exhaustive proof.

#### Scenario: Bounded result reaches its cap

- **WHEN** search/graph/API/cross-repo/program-analysis output reaches a configured or transport limit
- **THEN** the response MUST expose equivalent completeness metadata such as `truncated`, `hasMore`, `total`, lower-bound coverage or an explicit partial boundary
- **AND** downstream agents MUST be able to distinguish the bounded result from an exhaustive result.

### Requirement: Upgrade from 1.0.10 MUST preserve user-owned state and fail closed on incompatible indexes

`1.0.11` MUST handle persisted `1.0.10` state without silently trusting incompatible semantic artifacts.

#### Scenario: 1.0.10 index is compatible

- **WHEN** compatibility fingerprints/schema prove an old artifact remains valid
- **THEN** it MAY be reused
- **AND** trust/freshness MUST be based on explicit compatibility evidence.

#### Scenario: 1.0.10 index is incompatible

- **WHEN** Symbol Identity, resolver, evidence, graph/API/program-analysis schema or other required compatibility data is incompatible/missing
- **THEN** `1.0.11` MUST rebuild, reject, or request reanalysis
- **AND** MUST NOT report the incompatible index as trusted/fresh.

#### Scenario: Upgrade preserves user state

- **WHEN** a persisted `1.0.10` installation is upgraded
- **THEN** repository registry identity, configuration, repository groups and user-owned agent/custom files MUST follow documented preservation rules.

### Requirement: Rollback MUST fail safely across incompatible semantic state

Runtime rollback MUST NOT serve a semantically incompatible `1.0.11` index through an older runtime as if it were valid.

#### Scenario: Older runtime cannot consume newer index

- **WHEN** rollback selects a runtime that cannot prove compatibility with the active index
- **THEN** the runtime MUST fail closed, request reanalysis, or otherwise avoid serving misleading semantic results
- **AND** user configuration/data MUST remain preserved according to lifecycle policy.

### Requirement: MCP and HTTP changes MUST preserve promised backward compatibility

Modified MCP/HTTP response contracts MUST NOT change the meaning of an existing required field without an explicitly documented breaking change. New `1.0.11` evidence, certainty, coverage and change-intelligence fields SHOULD be additive unless a breaking change is explicitly documented.

#### Scenario: Older client ignores new fields

- **WHEN** an older client calls an existing tool/endpoint and ignores unknown additive fields
- **THEN** existing required fields MUST retain their prior meaning
- **AND** the response MUST remain usable where backward compatibility is promised.

### Requirement: Release documentation MUST match tested behavior

README and CHANGELOG are mandatory release artifacts and MUST not contain known false capability, version, benchmark or rollout claims.

#### Scenario: Version is not publicly published yet

- **WHEN** the release candidate is still pre-publication
- **THEN** README MUST NOT falsely imply that npm `1.0.11` is already available through a static release badge/claim.

#### Scenario: Program-analysis release notes are prepared

- **WHEN** README/CHANGELOG describe Program Analysis Foundation
- **THEN** they MUST include supported/partial scope and current public limitations
- **AND** MUST match the authoritative capability matrix.

#### Scenario: Graph-diff benchmark is described

- **WHEN** release documentation references 10k/100k graph-diff scaling
- **THEN** it MUST state that the current test covers synthetic normalized graph diff logic unless a true end-to-end repository snapshot benchmark has separately been executed
- **AND** MUST NOT present the synthetic diff-stage benchmark as end-to-end analyzer performance.

### Requirement: README architecture MUST reflect the actual semantic pipeline

The release README MUST describe the major `1.0.11` semantic architecture rather than only the older parse/resolve pipeline.

#### Scenario: User reads architecture section

- **WHEN** the architecture is documented for `1.0.11`
- **THEN** it MUST represent Semantic Facts, Symbol Identity V2, Evidence-Based Resolution and the Evidence-Carrying Graph
- **AND** it MUST show downstream Search/Context, API/Contracts, Change Intelligence and Program Analysis at a level supported by source architecture.

### Requirement: CHANGELOG MUST use the actual release date

A development date MUST NOT be presented as the publication date for an unreleased version.

#### Scenario: 1.0.11 has not yet been published

- **WHEN** CHANGELOG is prepared before final publication
- **THEN** the version MUST be marked `Unreleased` or equivalent non-published state.

#### Scenario: Final release commit is prepared

- **WHEN** all release gates have passed and the real publication date is known
- **THEN** CHANGELOG MAY be updated to that date
- **AND** the new SHA MUST be revalidated before tagging.

### Requirement: Snapshot/diff RSS metrics MUST be described according to their measurement boundary

Parent-process RSS delta around child analysis MUST NOT be called analyzer peak memory.

#### Scenario: Analysis phase metric is surfaced/documented

- **WHEN** `analysis.rssDeltaBytes` is reported for snapshot building
- **THEN** documentation MUST state that analysis runs in a child process and the metric reflects parent RSS delta
- **AND** MUST NOT claim child analyzer peak RSS unless separately measured.

### Requirement: Release supply-chain artifacts MUST be verifiable

The final release MUST retain the configured integrity/provenance controls for each publication channel.

#### Scenario: npm artifact is published

- **WHEN** npm `1.0.11` is published
- **THEN** provenance MUST be enabled/verified according to the release workflow.

#### Scenario: Docker artifact is published

- **WHEN** the production image is published
- **THEN** an immutable digest and configured provenance/signature evidence MUST be available.

#### Scenario: Runtime archive is published

- **WHEN** a self-contained runtime archive is published
- **THEN** checksum, SBOM and provenance/attestation evidence MUST be available and match the artifact.

### Requirement: Post-publication smoke tests MUST consume public artifacts

Passing workspace/source tests MUST NOT be the final release validation step.

#### Scenario: npm publication completes

- **WHEN** public npm reports `1.0.11`
- **THEN** a fresh install from the registry MUST pass representative version/doctor/analyze/runtime smoke tests.

#### Scenario: Docker publication completes

- **WHEN** the image is available in the registry
- **THEN** the image MUST be pulled by published tag/digest and smoke-tested independently of the local build context.

### Requirement: Release blockers MUST fail closed

The release process MUST NOT proceed to tagging or publication while a known release-critical correctness, compatibility, packaging, documentation or security gate is unresolved.

#### Scenario: Mandatory gate fails

- **WHEN** clean build, semantic convergence, compatibility, package integrity, required security, OpenSpec or exact-SHA validation fails
- **THEN** `v1.0.11` MUST NOT be tagged/published from that candidate
- **AND** a fix MUST produce a new candidate SHA and restart required validation.
