# Context Evidence Delivery Specification

## MODIFIED Requirements

### Requirement: Existing context workflow MUST remain valid

#### Scenario: Client sends current symbols-only request

- **WHEN** the existing `context` operation is invoked without a task field
- **THEN** it MUST return the existing token-bounded context block structure
- **AND** no new required argument or replacement tool MAY be required.

### Requirement: Context symbol selection MUST preserve ambiguity

#### Scenario: Multiple canonical symbols share one requested simple name

- **WHEN** existing request evidence cannot disambiguate them
- **THEN** context MUST expose/conservatively handle ambiguity
- **AND** MUST NOT silently label the first candidate exact.

### Requirement: Requested evidence MUST be delivered or have an explicit omission reason

#### Scenario: Requested symbol resolves but budget is constrained

- **WHEN** the final context cannot include the selected evidence
- **THEN** the response MUST expose a structured omission reason
- **AND** lower-ranked content MUST NOT silently consume the complete protected allocation first.

### Requirement: Session deduplication MUST be content-safe

#### Scenario: Source range was delivered earlier in same MCP workspace session

- **WHEN** it is selected again and its fingerprint is unchanged
- **THEN** a smaller back-reference MAY replace repeated source
- **BUT** if the fingerprint changed, current source MUST be emitted again.

### Requirement: Trust and boundary metadata MUST survive deduplication/trimming

#### Scenario: Selected relationship is uncertain or analysis is incomplete

- **WHEN** verbose evidence is trimmed or source is replaced by a pointer
- **THEN** compact uncertainty/coverage information MUST remain observable.
