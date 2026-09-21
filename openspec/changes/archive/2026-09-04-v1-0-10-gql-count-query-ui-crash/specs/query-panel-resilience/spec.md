# Query Panel resilience

## ADDED Requirements

### Requirement: Query Panel never dereferences an unverified result collection

The Query Panel MUST only render normalized GQL results.

#### Scenario: Aggregate result without legacy nodes field

- **WHEN** the client receives a legacy aggregate response that omits `nodes`
- **THEN** the client normalizes `nodes` to an empty array before updating React state
- **AND** the Query Panel does not evaluate `.length` on `undefined`.

#### Scenario: New normalized result

- **WHEN** the client receives the new stable response contract
- **THEN** all render paths use the normalized collections directly.

### Requirement: Query Panel renders by result kind

The Query Panel MUST choose its primary result presentation from `result.kind`.

#### Scenario: Aggregate result

- **WHEN** `result.kind` is `aggregate`
- **THEN** the panel renders the group/count table
- **AND** it does not require node results.

#### Scenario: Node result

- **WHEN** `result.kind` is `nodes`
- **THEN** the panel renders the node table when matches exist.

#### Scenario: Traversal result

- **WHEN** `result.kind` is `traversal`
- **THEN** the panel renders traversal nodes and edge metadata.

#### Scenario: Path result

- **WHEN** `result.kind` is `path`
- **THEN** the panel renders the available path representation or a no-path state.

### Requirement: Valid empty results have statement-specific empty states

The UI MUST distinguish a valid empty result from a failed query.

#### Scenario: Empty aggregate

- **WHEN** a valid COUNT query matches zero nodes
- **THEN** the panel displays a count/aggregate empty state
- **AND** it does not display a runtime error.

#### Scenario: Empty FIND

- **WHEN** a valid FIND query matches zero nodes
- **THEN** the panel displays a no-matching-nodes state.

#### Scenario: Missing path

- **WHEN** a valid PATH query finds no path
- **THEN** the panel displays a no-path state.

### Requirement: Invalid network result shapes become panel errors

The Web API client MUST validate or normalize network JSON before React receives it.

#### Scenario: Unusable successful response

- **WHEN** the server returns HTTP success with an unusable result shape
- **THEN** the client throws a typed query-result error
- **AND** the Query Panel displays the error message
- **AND** the application remains mounted.

#### Scenario: Structured API error

- **WHEN** the endpoint returns a structured 400, 422, 408, or 500 error
- **THEN** the Query Panel displays a safe message from the error envelope
- **AND** loading state is cleared.

### Requirement: Query-result render failures are locally contained

An unexpected exception in the Query Panel result renderer MUST NOT crash the entire Web UI.

#### Scenario: Result component throws

- **WHEN** a result child component throws during rendering
- **THEN** a local error boundary displays a Query Panel fallback
- **AND** the graph canvas, navigation, and other panels remain usable.

#### Scenario: Retry after contained failure

- **WHEN** the user submits a new query after a contained render failure
- **THEN** the boundary resets according to the defined retry key
- **AND** the new result can render normally.

### Requirement: Query history includes only successful normalized queries

The Query Panel MUST update query history after a response has been successfully normalized.

#### Scenario: Successful grouped count

- **WHEN** grouped COUNT completes and normalizes successfully
- **THEN** the query is added to history.

#### Scenario: Invalid result shape

- **WHEN** response normalization fails
- **THEN** the query is not added to successful history.

### Requirement: Loading state always terminates

The Query Panel MUST leave loading state for every request outcome.

#### Scenario: Successful response

- **WHEN** a query succeeds
- **THEN** loading becomes false after state update.

#### Scenario: API or normalization failure

- **WHEN** API execution or response normalization fails
- **THEN** loading becomes false in the finalization path.

### Requirement: The exact reported query is covered by browser regression

The packaged Web UI MUST have automated regression coverage for the reported crash.

#### Scenario: Grouped count through the browser

- **WHEN** the browser submits `COUNT function GROUP BY cluster`
- **THEN** a group table is visible
- **AND** no uncaught page exception is emitted
- **AND** the user can navigate to another panel afterward.
