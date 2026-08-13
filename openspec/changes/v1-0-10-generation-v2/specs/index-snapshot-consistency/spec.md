# Index Snapshot Consistency Specification

## ADDED Requirements

### Requirement: Every multi-artifact read MUST pin one generation snapshot

A logical operation that reads graph, BM25, vector, and/or metadata artifacts MUST resolve `current.json` once and derive all required paths from that single generation ID.

#### Scenario: Current generation changes during path resolution

- **GIVEN** generation A is current when an operation starts
- **AND** the operation resolves a pinned snapshot for A
- **WHEN** generation B is published before the operation opens all required artifacts
- **THEN** every artifact path used by the operation MUST remain under generation A
- **AND** the operation MUST NOT combine an A artifact with a B artifact

#### Scenario: Later operation observes new generation

- **GIVEN** generation B has been published successfully
- **WHEN** a new logical operation resolves its snapshot
- **THEN** it MAY resolve generation B
- **AND** every artifact used by that operation MUST be derived from B

#### Scenario: Invalid manifest or missing generation directory

- **GIVEN** `current.json` is malformed or references a missing/unsafe generation directory
- **WHEN** snapshot resolution runs
- **THEN** it MUST fail with a structured index error
- **AND** it MUST NOT fall back by mixing artifact paths from different locations

### Requirement: Snapshot resolution MUST enforce path containment and manifest compatibility

The system MUST reject untrusted generation identifiers and resolve only paths contained under the repository's index roots.

#### Scenario: Path traversal generation ID

- **GIVEN** a manifest contains a generation ID with `..`, path separators, an absolute path, or a null byte
- **WHEN** snapshot resolution runs
- **THEN** the manifest MUST be rejected
- **AND** no artifact outside `.code-intel/generations` may be opened or deleted

#### Scenario: Generation-v1 manifest

- **GIVEN** a valid generation-v1 manifest
- **WHEN** snapshot resolution runs
- **THEN** the system MUST return a normalized immutable snapshot
- **AND** graph, BM25, vector, and metadata paths MUST all derive from the same generation directory

#### Scenario: Legacy flat index

- **GIVEN** no valid generation manifest exists
- **AND** a complete supported legacy flat index exists
- **WHEN** an operation explicitly resolves legacy compatibility state
- **THEN** the returned snapshot MUST identify itself as legacy
- **AND** all paths MUST be flat legacy paths
- **AND** generation and legacy paths MUST NOT be mixed

### Requirement: Trust verification MUST operate on one pinned snapshot

Index trust/freshness checks MUST verify metadata and artifacts from one generation.

#### Scenario: Publication occurs during trust verification

- **GIVEN** trust verification pins generation A
- **WHEN** generation B is published before artifact checks finish
- **THEN** metadata, graph, BM25, and vector checks MUST all target A
- **AND** the result MUST report A's generation ID

#### Scenario: Required artifact missing in pinned snapshot

- **GIVEN** pinned metadata marks vector as required and ready
- **AND** the pinned generation lacks `vector.db`
- **WHEN** trust verification runs
- **THEN** the result MUST report the vector artifact missing for that pinned generation
- **AND** it MUST NOT satisfy the requirement using a vector artifact from a newer generation

### Requirement: One-shot CLI commands MUST use one snapshot per invocation

Commands that combine graph/search/metadata state MUST pin a snapshot at command start and pass explicit artifact paths through the operation.

#### Scenario: CLI search during publication

- **GIVEN** a CLI search pins generation A
- **WHEN** generation B publishes while search initializes BM25 or vector state
- **THEN** search MUST complete using only A
- **AND** existing CLI result schema MUST remain compatible

#### Scenario: CLI inspect, impact, or context during publication

- **GIVEN** inspect, impact, or context pins generation A
- **WHEN** B publishes during graph loading
- **THEN** symbol resolution, relationships, snippets, and metadata MUST come from A

### Requirement: Long-lived HTTP and MCP runtimes MUST replace repository state as one cohesive unit

Graph, BM25, vector, metadata, and snapshot identity MUST be loaded and swapped together rather than independently.

#### Scenario: Successful runtime reload

- **GIVEN** runtime state A is serving requests
- **AND** generation B becomes current
- **WHEN** the runtime reloads
- **THEN** it MUST resolve B once
- **AND** it MUST open and validate all required B components before swapping
- **AND** new requests MUST receive complete runtime state B only after successful construction

#### Scenario: In-flight request during reload

- **GIVEN** a request has acquired a lease on runtime state A
- **WHEN** complete runtime state B replaces the active reference
- **THEN** the existing request MUST finish using A
- **AND** A MUST remain open until the request releases its lease
- **AND** later requests MAY use B

#### Scenario: Replacement runtime fails to initialize

- **GIVEN** B is published
- **AND** one required B component fails to open or validate in a running server process
- **WHEN** reload is attempted
- **THEN** the runtime MUST continue serving complete state A
- **AND** it MUST report reload failure
- **AND** it MUST NOT replace only graph, BM25, vector, or metadata independently

### Requirement: Repository group operations MUST pin each member repository independently and consistently

A group request MAY use different generation IDs across different repositories, but each repository's artifacts MUST come from one pinned snapshot.

#### Scenario: One member publishes during group search

- **GIVEN** a group contains repositories R1 and R2
- **AND** the group request pins R1 generation A1 and R2 generation A2
- **WHEN** R1 publishes B1 during execution
- **THEN** the current group request MUST continue using A1 for all R1 artifacts
- **AND** it MUST continue using A2 for all R2 artifacts
- **AND** a later group request MAY use B1

#### Scenario: One member snapshot is invalid

- **GIVEN** a group member cannot resolve a safe snapshot
- **WHEN** group query initialization runs
- **THEN** the system MUST report or skip that repository according to the existing group failure contract
- **AND** it MUST NOT substitute artifacts from another repository or generation

### Requirement: Published-read APIs and staging-write APIs MUST remain distinct

The implementation MUST make it difficult for a caller to write into a published generation accidentally.

#### Scenario: Atomic child writes

- **GIVEN** the atomic child receives an explicit staging directory
- **WHEN** graph, BM25, vector, or metadata persistence occurs
- **THEN** write helpers MUST target the staging directory
- **AND** they MUST NOT resolve or modify the current published generation

#### Scenario: Normal reader

- **GIVEN** no staging context exists
- **WHEN** a reader loads metadata or an index artifact
- **THEN** it MUST use a pinned published or explicit legacy snapshot
- **AND** it MUST not expose a writable published path as a mutation target

## MODIFIED Requirements

### Requirement: Index freshness reload MUST use generation identity as the cohesive reload boundary

Existing reload-on-index-change behavior MUST treat a generation ID transition as a complete index transition.

#### Scenario: Generation ID unchanged after no-op

- **GIVEN** a server has loaded generation A
- **AND** a zero-change analyze returns without publication
- **WHEN** freshness polling runs
- **THEN** the generation ID MUST remain A
- **AND** the runtime MUST NOT reload graph, BM25, or vector state unnecessarily

#### Scenario: Generation ID changed after publication

- **GIVEN** generation B is published after real index work
- **WHEN** freshness polling detects B
- **THEN** the runtime MUST prepare a complete B replacement
- **AND** existing freshness semantics and public API behavior MUST remain compatible