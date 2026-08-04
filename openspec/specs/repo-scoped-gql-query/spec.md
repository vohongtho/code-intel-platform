# repo-scoped-gql-query Specification

## Purpose
TBD - created by archiving change make-gql-query-scope-repo-id-aware. Update Purpose after archive.
## Requirements
### Requirement: Repository-selecting API contracts SHALL use stable repo IDs
The system SHALL use stable `repoId` for machine-readable repository selection in backend, frontend, and MCP request contracts. Repository names SHALL remain human-facing labels unless a contract explicitly documents a compatibility adapter.

#### Scenario: Repo-scoped HTTP request
- **WHEN** a client sends a repository-selecting HTTP request on a contract covered by this capability
- **THEN** the canonical request shape uses `repoId` rather than repository name or filesystem path

#### Scenario: Repo-scoped web client request
- **WHEN** the web client submits a repository-selecting request on a covered contract
- **THEN** it sends `repoId` in the canonical request shape

#### Scenario: Repo-scoped MCP request
- **WHEN** an MCP client invokes a repository-selecting tool on a covered contract
- **THEN** the canonical request shape uses `repoId` rather than repository name or filesystem path

### Requirement: Explicit repository resolution SHALL fail closed
The system SHALL reject explicit repository selection requests that cannot be resolved, instead of silently falling back to a default graph, another repository, or path/name heuristics.

#### Scenario: Unknown repo ID
- **WHEN** a client sends an explicit `repoId` for a repository-selecting request and that repository does not exist
- **THEN** the system returns a structured error identifying the unknown repository scope
- **AND** it does not execute the request against any fallback repository

#### Scenario: Invalid repo scope shape
- **WHEN** a client sends a malformed repository scope or omits the required `repoId` field for an explicit repository-scoped request
- **THEN** the system returns an invalid-request error that identifies the malformed field

### Requirement: Repository-selecting responses SHALL expose resolved repository metadata
The system SHALL include resolved repository metadata in responses where repository resolution materially affects the meaning of the result.

#### Scenario: Query-like response metadata
- **WHEN** a repository-scoped query-like request succeeds
- **THEN** the response includes the resolved `repoId` and resolved repository name

#### Scenario: Compatibility-path response metadata
- **WHEN** a legacy repository-selecting request shape succeeds after normalization
- **THEN** the response identifies the resolved repository metadata used for execution

### Requirement: Compatibility adapters SHALL normalize legacy repo name/path inputs during migration
The system SHALL treat any preserved repo name or path input during migration as a compatibility-only adapter over canonical repo-id-based resolution.

#### Scenario: Legacy repo name input normalized
- **WHEN** a client sends a documented legacy request shape using a repository name on a covered contract during the migration window
- **THEN** the system normalizes that input to the matching `repoId`
- **AND** it applies canonical authorization, validation, and execution after normalization

#### Scenario: Ambiguous legacy repo input rejected
- **WHEN** a client sends a documented legacy request shape whose repository name/path cannot be resolved uniquely or safely
- **THEN** the system rejects the request with a clear error
- **AND** it does not guess a repository by fallback order

