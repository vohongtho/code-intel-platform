# Capability: Ref-aware and portable indexes

## ADDED Requirements

### Requirement: Read-only intelligence can select a committed ref
Repo-scoped read operations SHALL optionally execute against an immutable semantic snapshot for a requested Git ref.

#### Scenario: Search another branch
GIVEN `main` and `feature/x` resolve to different commits
WHEN search is requested with `ref=feature/x`
THEN results come from the feature snapshot
AND the working tree, HEAD and current Generation remain unchanged.

#### Scenario: Ref cannot be resolved
WHEN a read operation receives an unknown ref
THEN it returns an unknown-ref failure/boundary
AND does not silently use current state.

### Requirement: Alternate-ref artifacts are isolated
Every alternate-ref query SHALL use artifacts from one immutable snapshot view and SHALL NOT mix active-generation search artifacts into that view.

#### Scenario: Snapshot has no vector index
GIVEN vector mode is requested for an alternate snapshot without vectors
WHEN search executes
THEN actual-mode fallback is reported
AND the active Generation's vectors are not queried.

### Requirement: Portable imports are untrusted until validated
The importer SHALL stage, bound, authenticate, reopen, and validate every allowlisted artifact before publishing a portable snapshot cache entry.

#### Scenario: Graph artifact was modified
GIVEN a package graph DB does not match its manifest hash
WHEN import runs
THEN import fails
AND no snapshot cache entry is published.

#### Scenario: Package belongs to another repository
WHEN canonical repository identity differs
THEN import fails by default
AND does not silently adopt the package.

### Requirement: Privacy capabilities are explicit
Portable index manifests and read views SHALL expose the source-dependent capabilities available after applying the selected privacy profile.

#### Scenario: Metadata-only package
GIVEN source content was stripped
WHEN a source-dependent query runs
THEN the result reports missing-content capability
AND cannot reveal source omitted by the export profile.

### Requirement: Web graph diff consumes server truth
The existing Web graph-diff view SHALL render backend-provided continuity, certainty, compatibility, coverage, and stable-flow classifications without implementing a browser-side diff engine.

#### Scenario: Relationship certainty changed
GIVEN backend diff reports the change
WHEN Web renders it
THEN base/head trust fields are shown
AND the browser does not independently recalculate the verdict.
