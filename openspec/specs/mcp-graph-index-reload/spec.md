# mcp-graph-index-reload Specification

## Purpose
TBD - created by archiving change reload-mcp-graph-on-index-change. Update Purpose after archive.
## Requirements
### Requirement: Analyze SHALL publish comparable index metadata

`code-intel analyze` SHALL write repo metadata containing `indexedAt`, `schemaVersion`, and `indexVersion` after a successful index build.

#### Scenario: Successful analyze publishes metadata
- **WHEN** `code-intel analyze` completes successfully for a repository
- **THEN** the repo `meta.json` contains an ISO `indexedAt` value
- **AND** it contains the active index `schemaVersion`
- **AND** it contains an `indexVersion` value that changes when the finalized graph/search index changes

#### Scenario: Failed analyze does not publish a new version
- **WHEN** `code-intel analyze` fails before the index is complete
- **THEN** the previous published `meta.json#indexVersion` remains unchanged
- **AND** MCP graph tools continue using the previous complete index

### Requirement: MCP graph tools SHALL reload stale per-repo graph caches

The MCP server SHALL keep graph caches per repository and SHALL compare the cached `indexVersion` with the repository metadata before running any graph-backed tool. MCP startup itself SHALL NOT run analysis implicitly while bootstrapping that server, and missing indexes SHALL be reported at graph-tool call time without dropping the MCP connection.

#### Scenario: Graph tool observes a newer analyze result
- **GIVEN** the MCP server has loaded graph version `A` for repository `R`
- **AND** `code-intel analyze` publishes graph version `B` for repository `R`
- **WHEN** a graph-backed MCP tool is called for repository `R`
- **THEN** the MCP server reloads the graph for repository `R`
- **AND** the tool result uses version `B`
- **AND** no MCP client reconnect is required

#### Scenario: Unchanged graph version reuses cache
- **GIVEN** the MCP server has loaded graph version `A` for repository `R`
- **AND** repo metadata still reports version `A`
- **WHEN** a graph-backed MCP tool is called for repository `R`
- **THEN** the MCP server reuses the cached graph
- **AND** it does not reload graph storage

#### Scenario: Concurrent stale graph calls share one reload
- **GIVEN** the MCP server cache for repository `R` is stale
- **WHEN** two graph-backed MCP tool calls for repository `R` start concurrently
- **THEN** only one graph reload for repository `R` runs
- **AND** both tool calls use the reloaded graph

#### Scenario: MCP startup succeeds without a published index
- **GIVEN** repository `R` has no published `.code-intel/` index metadata and graph snapshot
- **WHEN** a user or MCP client starts `code-intel mcp` for repository `R`
- **THEN** startup succeeds and the MCP server accepts tool calls
- **AND** the startup path does not create or publish a new index for `R`
- **AND** it does not run analysis as part of MCP bootstrap

#### Scenario: Graph-backed MCP tool reports missing index clearly
- **GIVEN** repository `R` has no published `.code-intel/` index metadata and graph snapshot
- **AND** an MCP client is already connected
- **WHEN** a graph-backed MCP tool is called for repository `R`
- **THEN** the tool returns a clear instruction to run `code-intel analyze`
- **AND** the MCP connection stays open
- **AND** the tool call does not create or publish a new index for `R`

#### Scenario: Graph-backed MCP tool auto-recovers after explicit analyze
- **GIVEN** repository `R` had no published index when the MCP client connected
- **AND** a graph-backed MCP tool previously returned a missing-index instruction for `R`
- **WHEN** the user runs `code-intel analyze` for repository `R`
- **AND** a graph-backed MCP tool is called again for repository `R`
- **THEN** the MCP server loads or reloads the published graph for `R`
- **AND** the tool succeeds without requiring an MCP reconnect

#### Scenario: MCP startup succeeds with a published index
- **GIVEN** repository `R` has a published `.code-intel/` index metadata and graph snapshot
- **WHEN** a user or MCP client starts `code-intel mcp` for repository `R`
- **THEN** startup loads the published graph for `R`
- **AND** it does not run analysis as part of MCP bootstrap

### Requirement: MCP graph cache SHALL be isolated by repository

The MCP server SHALL resolve and cache loaded graphs by stable repository identity and path so one repository cannot satisfy graph tool calls for another repository, even if repository names change later.

#### Scenario: Two repositories have different graph versions
- **GIVEN** repositories `A` and `B` are both indexed
- **AND** the MCP server has loaded repository `A`
- **WHEN** a graph-backed MCP tool is called for repository `B`
- **THEN** the MCP server loads repository `B` from repository `B`'s path
- **AND** it does not use repository `A`'s cached graph

#### Scenario: Repository rename does not collide with cached state
- **GIVEN** repository `R` has stable repository ID `RID`
- **AND** the MCP server has cached graph state for `RID`
- **WHEN** the repository name changes
- **THEN** subsequent graph-backed MCP tool calls still resolve to repository `RID`
- **AND** the MCP server does not treat the rename as a different repository
- **AND** no cached graph for another repository is reused

### Requirement: Repo-scoped MCP search SHALL not leak results from other repositories

When a MCP search request specifies a repository, the search implementation SHALL only return results from that repository's index.

#### Scenario: Search in one repo excludes another repo
- **GIVEN** repositories `A` and `B` are indexed
- **AND** both contain symbols matching query `Q`
- **WHEN** MCP search is called with `repo: "A"` and query `Q`
- **THEN** every returned result has a file path from repository `A`'s index
- **AND** no result from repository `B` is returned

### Requirement: Schema incompatibility SHALL fail clearly

When the MCP server sees repo metadata with an unsupported `schemaVersion`, graph-backed MCP tools SHALL fail with a clear message instead of serving a stale graph.

#### Scenario: Unsupported schema version
- **GIVEN** repository `R` metadata has unsupported `schemaVersion` `S`
- **WHEN** a graph-backed MCP tool is called for repository `R`
- **THEN** the tool fails with a message that includes `schemaVersion`
- **AND** the message instructs the user to re-run `code-intel analyze` or upgrade the MCP server

