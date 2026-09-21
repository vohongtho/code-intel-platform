# API Contract Intelligence

## Purpose

Connect HTTP producer routes to request/response shape and statically identifiable consumers so Code Intel can answer route-level compatibility and impact questions (e.g. does a response-field change break a known caller) with evidence-backed certainty, additive to existing route/graph/impact workflows.

## Requirements

### Requirement: Producers MUST have normalized contract identity

Discovered HTTP routes MUST be materialized with normalized method, path, and identity so they can be compared and linked deterministically.

#### Scenario: Framework route is statically resolvable
- **WHEN** analysis discovers an HTTP route
- **THEN** method, normalized path, source anchor, and handler identity when known MUST be materialized
- **AND** dynamic unknown route segments MUST reduce coverage instead of being guessed.

### Requirement: Consumer links MUST be evidence-based

Consumer-to-producer relationships MUST be backed by static evidence and MUST NOT be fabricated when that evidence is ambiguous or absent.

#### Scenario: Frontend call matches method and normalized route
- **WHEN** static URL and method evidence uniquely identify a producer
- **THEN** the graph MAY materialize an exact `CONSUMES_API` relationship
- **AND** the relationship MUST reference source/evidence metadata.

#### Scenario: URL expression is dynamic or matches multiple routes
- **WHEN** evidence does not uniquely identify a producer
- **THEN** exact linkage MUST NOT be fabricated
- **AND** candidates/boundary MUST be represented according to shared certainty rules.

### Requirement: Response compatibility MUST consider actual consumer usage

Compatibility classification MUST factor in whether a resolved consumer actually reads the affected response shape, not only whether the producer's declared shape changed.

#### Scenario: Producer removes a response key read by a resolved consumer
- **WHEN** base/head contracts are compared
- **THEN** the change MUST be classified breaking for that consumer
- **AND** the affected source locations MUST be addressable.

### Requirement: Unknown shape MUST NOT be reported compatible

When response shape cannot be statically recovered, compatibility MUST be reported as unknown or partial rather than defaulting to compatible.

#### Scenario: Serializer behavior prevents static response-shape recovery
- **WHEN** compatibility is requested
- **THEN** shape compatibility MUST be `unknown` or partial
- **AND** MUST NOT be reported safe solely because no incompatible key was found.

### Requirement: Existing route workflows MUST remain compatible

Existing route, impact, and repository-group workflows MUST continue to work unchanged when API contract intelligence is enabled.

#### Scenario: Existing client uses `routes` or general impact tools
- **WHEN** API contract intelligence is enabled by upgrade
- **THEN** existing required fields and commands MUST continue to work
- **AND** richer API evidence MAY be additive.
