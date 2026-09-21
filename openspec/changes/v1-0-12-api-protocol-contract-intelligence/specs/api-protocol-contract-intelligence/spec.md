# Capability: API and protocol contract intelligence

## ADDED Requirements

### Requirement: HTTP response validation uses consumer access paths
The system SHALL compare statically observed consumer response-field paths with matched producer response shapes.

#### Scenario: Nested consumed field is removed
GIVEN a matched consumer exactly reads `user.profile.displayName`
AND the base producer returns that nested field
WHEN the head producer removes the field with complete shape evidence
THEN shape check reports a breaking finding for that consumer.

#### Scenario: Consumer access is dynamic
GIVEN the consumer uses a computed property the analyzer cannot resolve
WHEN shape check runs
THEN coverage is partial/unknown
AND absence of a mismatch is not reported as proven compatibility.

### Requirement: GraphQL contracts preserve schema type semantics
#### Scenario: Required argument added
GIVEN a known GraphQL operation calls a field
AND the head schema adds a new non-null argument without a default
WHEN GraphQL drift runs
THEN a breaking finding is emitted for the affected operation.

#### Scenario: Nullable output field is added
GIVEN an existing object type
WHEN a nullable field is added
THEN schema compatibility reports the additive change as compatible
AND no affected consumer is fabricated.

### Requirement: GraphQL consumers map by operation/schema evidence
#### Scenario: Client selects a removed field
GIVEN a client operation's selected field path is resolved to a schema field
WHEN that field is removed
THEN the operation is listed as an affected consumer with its match certainty.

### Requirement: gRPC drift separates wire and source compatibility
#### Scenario: Field renamed without number/type change
GIVEN a protobuf field keeps its number and wire-compatible type but changes source name
WHEN drift runs
THEN wire compatibility may remain compatible
AND source compatibility reports the generated-code break risk.

#### Scenario: Field number is reused incompatibly
GIVEN a removed field number is reused for an incompatible field/type
WHEN drift runs
THEN wire compatibility is breaking.

### Requirement: gRPC RPC identity includes service and package
#### Scenario: Same RPC method name exists in two services
GIVEN two distinct services expose the same RPC method name
WHEN consumer/provider mapping runs
THEN method-name equality alone is insufficient
AND only canonical package/service/RPC evidence may create an exact link.

### Requirement: Legacy protocol contracts degrade explicitly
#### Scenario: v1.0.11 flat GraphQL/gRPC contract is compared
GIVEN a persisted contract uses the v1.0.11 flat protocol schema
WHEN rich schema fields required by the new comparator are absent
THEN compatibility remains `unknown` with a legacy-schema boundary
AND the system does not infer missing structure.
