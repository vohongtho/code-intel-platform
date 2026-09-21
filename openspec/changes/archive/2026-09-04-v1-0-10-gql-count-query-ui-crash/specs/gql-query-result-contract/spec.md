# GQL query result contract

## ADDED Requirements

### Requirement: Every successful GQL response has a stable transport shape

The system MUST return the same top-level successful result fields for every supported GQL statement.

The response MUST include:

- `kind`;
- `nodes`;
- `edges`;
- `groups`;
- `path`;
- `executionTimeMs`;
- `truncated`;
- `totalCount`.

`nodes`, `edges`, and `groups` MUST be arrays. `path` MUST be an array or `null`.

#### Scenario: Grouped COUNT response

- **WHEN** an authenticated viewer submits `COUNT function GROUP BY cluster`
- **THEN** the server returns a successful aggregate result
- **AND** `kind` equals `aggregate`
- **AND** `nodes` is an empty array
- **AND** `edges` is an empty array
- **AND** `groups` contains the grouped counts
- **AND** `path` is `null`
- **AND** scalar execution metadata is present.

#### Scenario: FIND response

- **WHEN** a valid FIND query is executed
- **THEN** `kind` equals `nodes`
- **AND** `nodes` contains the matches
- **AND** all non-applicable collections remain present as empty values.

#### Scenario: TRAVERSE response

- **WHEN** a valid TRAVERSE query is executed
- **THEN** `kind` equals `traversal`
- **AND** node and edge collections are present
- **AND** aggregate collections remain present and empty.

#### Scenario: PATH response

- **WHEN** a valid PATH query is executed
- **THEN** `kind` equals `path`
- **AND** `path` is either the ordered path node array or `null`
- **AND** all common result fields remain present.

### Requirement: Aggregate execution does not materialize node results

The system MUST preserve aggregate performance characteristics.

#### Scenario: COUNT with matching nodes

- **WHEN** a COUNT query matches nodes
- **THEN** the executor calculates counts and groups
- **AND** it does not include matching node objects in the response
- **AND** the normalized `nodes` field remains an empty array.

### Requirement: Result kind matches statement semantics

The system MUST use a deterministic statement-to-result mapping.

#### Scenario: Supported statements

- **WHEN** the AST type is FIND, TRAVERSE, PATH, or COUNT
- **THEN** the result kind is respectively `nodes`, `traversal`, `path`, or `aggregate`.

#### Scenario: Unsupported runtime AST

- **WHEN** an unsupported AST type reaches execution
- **THEN** the system fails through a controlled internal-error path
- **AND** it does not silently return a misleading empty result.

### Requirement: Successful results are validated before serialization

The HTTP API MUST validate the internal GQL result before sending a successful response.

#### Scenario: Valid normalized result

- **WHEN** executor output satisfies the result contract
- **THEN** the API serializes it with the established success status.

#### Scenario: Invalid internal result

- **WHEN** executor output contains an unknown kind, invalid collection, or invalid scalar metadata
- **THEN** the API returns a structured internal-error response
- **AND** no partial invalid success body is sent
- **AND** the server remains running.

### Requirement: Existing request and parse errors remain structured

The change MUST preserve the existing error envelope and authorization behavior.

#### Scenario: Missing GQL field

- **WHEN** the request body has no string `gql` field
- **THEN** the API returns HTTP 400 with the structured error envelope.

#### Scenario: Invalid GQL syntax

- **WHEN** parsing fails
- **THEN** the API returns HTTP 422 with parse position diagnostics
- **AND** execution is not attempted.

### Requirement: Grouped COUNT preserves current semantics

The crash fix MUST NOT change count or grouping semantics.

#### Scenario: Missing group property

- **WHEN** a matching node has no value for the requested group property
- **THEN** it is counted under `(none)`.

#### Scenario: Group ordering

- **WHEN** multiple groups are produced
- **THEN** groups are ordered by descending count.

### Requirement: Legacy response compatibility is supported in the Web client

The Web client MUST accept compatible responses from a server version that omits non-applicable fields.

#### Scenario: Legacy aggregate response

- **WHEN** a successful response contains `groups` and scalar metadata but omits `nodes`, `edges`, `path`, and `kind`
- **THEN** the client infers `aggregate`
- **AND** normalizes absent collections to empty arrays
- **AND** returns a safe GQL result to the UI.

### Requirement: OpenAPI documents all result kinds

The OpenAPI document MUST describe the common successful result schema and examples for every supported statement family.

#### Scenario: API documentation consumer

- **WHEN** a consumer inspects `/api/v1/query`
- **THEN** the success schema lists the result-kind enum and all normalized fields
- **AND** examples include grouped COUNT.
