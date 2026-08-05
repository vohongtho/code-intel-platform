## Purpose

Define a canonical scoped search contract for HTTP, UI, and MCP search workflows, while preserving safe compatibility behavior for legacy callers during migration.
## Requirements
### Requirement: Search requests SHALL accept explicit repo or group scope
The system SHALL allow search-like API requests to declare the repository or repository group they are searching by supplying an explicit scope object. Repository scope SHALL use stable `repoId`. Group scope SHALL use group name.

#### Scenario: Repo-scoped HTTP search
- **WHEN** a client sends a search request with `scope.type` = `repo` and `scope.repoId` = an indexed repository ID
- **THEN** the system executes the search only against that repository
- **AND** the response identifies the resolved repo scope

#### Scenario: Group-scoped HTTP search
- **WHEN** a client sends a search request with `scope.type` = `group` and `scope.name` = an existing repository group name
- **THEN** the system executes the search only against that group
- **AND** the response identifies the resolved group scope

#### Scenario: Invalid explicit scope
- **WHEN** a client sends a search request with an unknown scope type, missing required scope field, unknown repo ID, or unknown group name
- **THEN** the system SHALL reject the request with an error that identifies the invalid scope field

#### Scenario: Legacy repo search shape normalized
- **WHEN** a documented legacy search request uses a repo name or legacy flat `repo` field during migration
- **THEN** the system normalizes it to the matching `repoId`
- **AND** it applies canonical scope validation and execution after normalization

### Requirement: Search strategy SHALL be selectable independently from search scope
The system SHALL let clients choose BM25, vector, or hybrid search behavior without changing how repo or group scope is expressed. This applies uniformly across every search transport — HTTP, UI, and MCP tool calls — by routing through the same canonical search execution path rather than a transport-specific reimplementation.

#### Scenario: Hybrid repo search
- **WHEN** a client sends a search request with `mode` = `hybrid` and repo scope
- **THEN** the system executes hybrid search only within the selected repository

#### Scenario: Vector group search
- **WHEN** a client sends a search request with `mode` = `vector` and group scope
- **THEN** the system executes vector search only within repositories in the selected group

#### Scenario: Default search mode
- **WHEN** a client omits the `mode` field from a scoped search request
- **THEN** the system SHALL apply the documented default search mode consistently for that endpoint

#### Scenario: MCP tool search with explicit BM25 mode
- **WHEN** an MCP client calls the `search` tool with `mode` = `bm25`
- **THEN** the system executes BM25-only search, bypassing vector search and Reciprocal Rank Fusion, even if a vector index exists for the repository
- **AND** the tool response `searchMode` field reports `bm25`

#### Scenario: MCP tool search with explicit vector mode
- **WHEN** an MCP client calls the `search` tool with `mode` = `vector` on a repository with a built vector index
- **THEN** the system executes vector search and reports `searchMode` = `vector` (or `bm25` if the vector index is unavailable, per existing fallback behavior)

#### Scenario: MCP tool default mode
- **WHEN** an MCP client calls the `search` tool without a `mode` field
- **THEN** the system SHALL apply the same behavior as today (hybrid when a vector index exists for the repository, BM25 otherwise) so existing callers are unaffected

### Requirement: Legacy search entry points SHALL honor the unified scope model during migration
The system SHALL preserve compatibility for existing search entry points while applying the same explicit scope semantics. Compatibility paths SHALL behave as thin adapters over the canonical search execution path rather than independent implementations.

#### Scenario: Legacy vector endpoint with explicit scope
- **WHEN** a client calls the legacy vector-search endpoint with explicit scope information
- **THEN** the system applies the same scope resolution and validation rules as the canonical search endpoint
- **AND** it resolves the request as `mode = vector`

#### Scenario: Legacy group endpoint
- **WHEN** a client calls the legacy group-search endpoint for group `G`
- **THEN** the system normalizes the request to `scope.type = group` and `scope.name = G`
- **AND** it delegates execution to the canonical search path

#### Scenario: Legacy flat repo/group fields
- **WHEN** a client sends a legacy request using `repo` or `group` fields instead of `scope`
- **THEN** the system normalizes that request into the equivalent explicit `scope`
- **AND** it applies canonical validation and execution rules after normalization

#### Scenario: Ambiguous mixed request shape
- **WHEN** a client sends both `scope` and legacy `repo` or `group` fields, or sends both legacy `repo` and `group` together
- **THEN** the system SHALL reject the request as ambiguous

#### Scenario: Legacy caller without explicit scope
- **WHEN** an existing caller uses a legacy search entry point without explicit scope during the migration window
- **THEN** the system MAY apply documented backward-compatible default scope behavior
- **AND** it SHALL NOT treat that omitted scope as permission to search outside the current default repository context

#### Scenario: Legacy request deprecation metadata
- **WHEN** a compatibility endpoint or legacy request shape is used during migration
- **THEN** the system response SHALL identify the resolved scope and mode
- **AND** it SHALL include a deprecation signal for the legacy path or shape

### Requirement: Search responses SHALL include resolved search context
The system SHALL return enough metadata for callers to determine which repo or group was searched and which strategy was used.

#### Scenario: Repo response metadata
- **WHEN** a repo-scoped search succeeds
- **THEN** the response includes the resolved repo identity and the applied search mode

#### Scenario: Group response metadata
- **WHEN** a group-scoped search succeeds
- **THEN** the response includes the resolved group identity and the applied search mode
- **AND** grouped results preserve per-repository attribution

#### Scenario: Legacy normalized response metadata
- **WHEN** a legacy endpoint or legacy request shape succeeds after normalization
- **THEN** the response includes the normalized scope and resolved mode actually used for execution

