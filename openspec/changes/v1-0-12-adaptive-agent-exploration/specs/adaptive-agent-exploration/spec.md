# Capability: Adaptive agent exploration

## ADDED Requirements

### Requirement: Task-oriented exploration composes existing intelligence
The system SHALL provide an optional Explore operation that selects existing search, graph, API, impact, test, security and context capabilities for a stated task.

#### Scenario: Change-oriented exploration
GIVEN a trusted repository index
WHEN a caller explores a change task
THEN relevant seed symbols and impact/API/test evidence are selected
AND a bounded context document is returned
AND specialized tools remain independently callable.

### Requirement: Rendering is value-aware and bounded
The renderer SHALL assign `full`, `snippet`, `signature`, `skeleton`, or `reference` according to task relevance, evidence and token budget.

#### Scenario: Repetitive polymorphic siblings
GIVEN one orchestration method and several supporting implementations
WHEN the orchestration method is central to the task
THEN it receives richer source
AND supporting siblings may receive signature/skeleton rendering
AND omitted body detail is recorded.

#### Scenario: Skeletonization unsupported
GIVEN no tested skeletonizer capability exists for a language
WHEN structural compression is requested
THEN the engine falls back to snippet/signature
AND reports the capability boundary
AND does not use destructive generic rewriting.

### Requirement: Session references are freshness-safe
Previously delivered source SHALL be pointer-referenced only when canonical identity, content fingerprint and selected index identity still match.

#### Scenario: Symbol changed
GIVEN source was delivered earlier
AND its content or selected ref changed
WHEN Explore runs again
THEN source is eligible for delivery again
AND a stale pointer-only response is forbidden.

### Requirement: Reranking preserves uncertainty
Graph-aware reranking SHALL preserve relationship certainty and candidate boundaries.

#### Scenario: Candidate has only ambiguous graph evidence
GIVEN a candidate is supported only by ambiguous graph relationships
WHEN reranking executes
THEN ambiguous evidence contributes only at bounded certainty
AND exact path evidence is not claimed.

### Requirement: Hard token budget is enforced
#### Scenario: Context exceeds budget
GIVEN relevant context exceeds the normalized requested token budget
WHEN allocation completes
THEN the final context remains within the normalized limit
AND omitted items include structured reasons.
