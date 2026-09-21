# Atomic Index Publication Specification

## ADDED Requirements

### Requirement: Analysis MUST resolve a complete publication plan before creating staging

The system MUST determine graph, BM25, vector, metadata, seed-artifact, and publication work before creating a staging generation or copying an existing artifact.

#### Scenario: Stable zero-change repository

- **GIVEN** a valid published generation with trusted graph, BM25, metadata, and any required vector artifact
- **AND** source change scope is known
- **AND** no source file changed or was deleted
- **AND** no force, schema migration, parser migration, embedding rebuild, or metadata rewrite is required
- **WHEN** the user runs `code-intel analyze`
- **THEN** the resolved plan MUST be `noop`
- **AND** no staging directory MUST be created
- **AND** no artifact MUST be copied or written
- **AND** `current.json` MUST remain byte-identical
- **AND** the active generation ID MUST remain unchanged

#### Scenario: One changed file with healthy vectors

- **GIVEN** a trusted published generation with embeddings enabled and a healthy compatible vector index
- **AND** source change scope identifies exactly one changed file
- **WHEN** analysis planning completes
- **THEN** graph work MUST be `full`
- **AND** BM25 work MUST be `full`
- **AND** vector work MUST be `incremental`
- **AND** only `vector.db` MUST be selected for seeding
- **AND** publication MUST be required

#### Scenario: Unknown source change scope

- **GIVEN** the system cannot prove the complete changed/deleted path set
- **WHEN** analysis planning completes
- **THEN** graph and BM25 MUST use a safe full rebuild
- **AND** vector MUST use a full rebuild when embeddings are enabled
- **AND** the system MUST NOT choose incremental vector mutation

### Requirement: A true no-op MUST preserve the complete published state

A no-op analysis MUST NOT create a logically equivalent replacement generation merely to update check time or metadata.

#### Scenario: No-op preserves files and retention state

- **GIVEN** a repository whose planner returns `noop`
- **WHEN** analysis exits successfully
- **THEN** `current.json` bytes and modification time MUST be unchanged
- **AND** graph, BM25, vector, and metadata modification times MUST be unchanged
- **AND** the number of published generation directories MUST be unchanged
- **AND** immutable metadata such as `indexedAt` MUST remain unchanged
- **AND** copied-byte diagnostics MUST report zero

#### Scenario: No-op under generation-v1 manifest

- **GIVEN** a valid generation-v1 manifest
- **AND** no index work is required
- **WHEN** analysis runs under v1.0.10
- **THEN** the system MUST preserve the generation-v1 manifest without rewriting it solely to upgrade manifest format

### Requirement: Staging MUST contain only required preserved artifacts and newly built artifacts

The system MUST seed only artifacts that the plan marks for preservation or incremental mutation.

#### Scenario: Full graph and BM25 rebuild

- **GIVEN** graph and BM25 work are `full`
- **WHEN** staging is prepared
- **THEN** the previous `graph.db` MUST NOT be copied into staging
- **AND** the previous `bm25.db` MUST NOT be copied into staging
- **AND** the child MUST create new graph and BM25 artifacts in staging

#### Scenario: Incremental vector update

- **GIVEN** vector work is `incremental`
- **WHEN** staging is prepared
- **THEN** the published `vector.db` MUST be cloned into staging
- **AND** graph and BM25 MUST be cloned only when their own plan modes require preservation
- **AND** metadata MUST be written from validated in-memory state rather than copied by default

#### Scenario: Full vector rebuild

- **GIVEN** vector work is `full`
- **WHEN** staging is prepared
- **THEN** the previous `vector.db` MUST NOT be copied into staging
- **AND** the child MUST build a new vector artifact

#### Scenario: Metadata-only publication

- **GIVEN** source artifacts remain valid
- **AND** a metadata change requires publication
- **WHEN** staging is prepared
- **THEN** every preserved database artifact required by the new manifest MUST be cloned
- **AND** the new metadata MUST be written into staging
- **AND** the current generation MUST remain immutable

### Requirement: Artifact cloning MUST preserve correctness with or without reflink support

Copy-on-write cloning MAY optimize selected artifact seeding, but correctness MUST NOT depend on filesystem reflink support.

#### Scenario: Reflink supported

- **GIVEN** the filesystem supports copy-on-write cloning
- **WHEN** a selected artifact is seeded
- **THEN** the system SHOULD use reflink cloning
- **AND** diagnostics MUST identify the clone mode
- **AND** the published source artifact MUST remain immutable when the staged clone is modified

#### Scenario: Reflink unsupported

- **GIVEN** reflink operations fail or are unsupported
- **WHEN** a selected artifact is seeded
- **THEN** the system MUST fall back to a normal file copy
- **AND** analysis correctness and publication semantics MUST remain identical
- **AND** diagnostics MUST report the physical bytes copied

#### Scenario: Clone failure

- **GIVEN** a required seed artifact cannot be cloned or copied
- **WHEN** staging preparation runs
- **THEN** analysis MUST fail before the child starts
- **AND** the current generation MUST remain unchanged
- **AND** only staging owned by the failing process MAY be removed

### Requirement: Publication MUST validate a complete immutable generation before pointer replacement

The system MUST validate all required staging artifacts and generation identity before changing `current.json`.

#### Scenario: Successful publication

- **GIVEN** all required staging artifacts exist, are non-empty, are contained under the staging directory, and pass compatibility checks
- **AND** staged metadata identifies the staging generation ID
- **WHEN** publication runs
- **THEN** staging MUST be renamed to the final immutable generation directory
- **AND** `current.json` MUST be atomically replaced afterward
- **AND** new readers MAY resolve the new generation only after pointer replacement succeeds

#### Scenario: Required artifact missing

- **GIVEN** a required staging artifact is missing or empty
- **WHEN** publication validation runs
- **THEN** publication MUST fail
- **AND** `current.json` MUST continue pointing to the previous generation
- **AND** the previous graph, BM25, vector, and metadata artifacts MUST remain reopenable

#### Scenario: Generation identity mismatch

- **GIVEN** staged metadata has a generation ID different from the staging generation
- **WHEN** validation runs
- **THEN** publication MUST be rejected
- **AND** the active generation MUST remain unchanged

#### Scenario: Ready vector metadata without vector artifact

- **GIVEN** metadata claims embeddings are enabled and ready
- **AND** `vector.db` is missing or empty
- **WHEN** validation runs
- **THEN** publication MUST be rejected

#### Scenario: Manifest write failure after final rename

- **GIVEN** staging has been renamed to a final generation directory
- **AND** atomic replacement of `current.json` fails
- **WHEN** publication exits
- **THEN** the previous manifest MUST remain active
- **AND** the newly renamed but unreachable generation MUST NOT be treated as current
- **AND** later maintenance MAY remove it as abandoned state

### Requirement: Published generation manifests MUST remain backward compatible

Generation V2 MUST preserve fields required by v1.0.9 while adding optional v2 details.

#### Scenario: Read generation-v1 manifest

- **GIVEN** a manifest without a `version` field and with `artifacts` as artifact names
- **WHEN** v1.0.10 resolves it
- **THEN** the system MUST normalize it as generation-v1
- **AND** all artifact paths MUST resolve from its single generation ID

#### Scenario: Publish generation-v2 manifest

- **GIVEN** a real publication occurs under v1.0.10
- **WHEN** the manifest is written
- **THEN** it MUST include `version: 2`
- **AND** it MUST retain top-level `generationId`, `publishedAt`, and `artifacts` fields compatible with v1.0.9
- **AND** optional details MAY include base generation, schema, parser, sizes, required flags, and fingerprints

### Requirement: Failed analysis MUST leave the previous generation usable

Every failure before successful pointer replacement MUST preserve the complete previous published state.

#### Scenario: Child analysis fails

- **GIVEN** a valid current generation
- **AND** the atomic child exits non-zero while preparing a replacement
- **WHEN** the parent handles the failure
- **THEN** the parent MUST preserve `current.json`
- **AND** the previous artifacts MUST remain usable
- **AND** the parent MUST remove only its own staging by default
- **AND** the command MUST return non-zero

#### Scenario: Graph, BM25, vector, or metadata persistence fails

- **GIVEN** failure is injected at any artifact persistence stage
- **WHEN** analysis exits
- **THEN** no partially prepared artifact MUST become visible through the active manifest
- **AND** a test MUST reopen the previous persisted artifacts and prove they remain valid

## MODIFIED Requirements

### Requirement: Incremental vector scope MUST remain independent from graph execution mode

Generation optimization MUST NOT regress the v1.0.9 vector update contract.

#### Scenario: Correctness-first graph rebuild with one changed file

- **GIVEN** graph relationship correctness requires a full graph rebuild
- **AND** the changed path set is known
- **AND** the vector state is healthy and compatible
- **WHEN** analysis runs
- **THEN** graph and BM25 MUST rebuild fully
- **AND** vector entries MUST be deleted/upserted only for changed/deleted paths
- **AND** the entire repository MUST NOT be re-embedded

#### Scenario: Zero-change embeddings-enabled run

- **GIVEN** embeddings are enabled and the vector state is healthy
- **AND** no source or configuration change exists
- **WHEN** analysis runs
- **THEN** no vector write MUST occur
- **AND** Generation V2 MUST also avoid cloning the vector artifact or publishing a new generation