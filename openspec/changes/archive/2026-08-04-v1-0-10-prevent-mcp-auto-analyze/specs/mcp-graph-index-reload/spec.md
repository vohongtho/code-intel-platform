## MODIFIED Requirements

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
