# API Contract Intelligence Specification

## ADDED Requirements

### Requirement: Producers MUST have normalized contract identity

#### Scenario: Framework route is statically resolvable
- **WHEN** analysis discovers an HTTP route
- **THEN** method, normalized path, source anchor, and handler identity when known MUST be materialized
- **AND** dynamic unknown route segments MUST reduce coverage instead of being guessed.

### Requirement: Consumer links MUST be evidence-based

#### Scenario: Frontend call matches method and normalized route
- **WHEN** static URL and method evidence uniquely identify a producer
- **THEN** the graph MAY materialize an exact `CONSUMES_API` relationship
- **AND** the relationship MUST reference source/evidence metadata.

#### Scenario: URL expression is dynamic or matches multiple routes
- **WHEN** evidence does not uniquely identify a producer
- **THEN** exact linkage MUST NOT be fabricated
- **AND** candidates/boundary MUST be represented according to shared certainty rules.

### Requirement: Response compatibility MUST consider actual consumer usage

#### Scenario: Producer removes a response key read by a resolved consumer
- **WHEN** base/head contracts are compared
- **THEN** the change MUST be classified breaking for that consumer
- **AND** the affected source locations MUST be addressable.

### Requirement: Unknown shape MUST NOT be reported compatible

#### Scenario: Serializer behavior prevents static response-shape recovery
- **WHEN** compatibility is requested
- **THEN** shape compatibility MUST be `unknown` or partial
- **AND** MUST NOT be reported safe solely because no incompatible key was found.

### Requirement: Existing route workflows MUST remain compatible

#### Scenario: Existing client uses `routes` or general impact tools
- **WHEN** API contract intelligence is enabled by upgrade
- **THEN** existing required fields and commands MUST continue to work
- **AND** richer API evidence MAY be additive.
