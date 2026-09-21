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
#### Scenario: Snapshot has no vector index
GIVEN vector mode is requested for an alternate snapshot without vectors
WHEN search executes
THEN actual-mode fallback is reported
AND the active Generation's vectors are not queried.

### Requirement: Portable imports are untrusted until validated
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
#### Scenario: Metadata-only package
GIVEN source content was stripped
WHEN a source-dependent query runs
THEN the result reports missing-content capability
AND cannot reveal source omitted by the export profile.

### Requirement: Web graph diff consumes server truth
#### Scenario: Relationship certainty changed
GIVEN backend diff reports the change
WHEN Web renders it
THEN base/head trust fields are shown
AND the browser does not independently recalculate the verdict.
