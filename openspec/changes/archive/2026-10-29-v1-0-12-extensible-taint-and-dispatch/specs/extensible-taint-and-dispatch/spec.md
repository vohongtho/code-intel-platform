# Capability: Extensible taint and type-aware dispatch

## ADDED Requirements

### Requirement: Taint models are declarative, versioned and fingerprinted
The system SHALL support validated built-in and optional project taint models without executing model-provided code.

#### Scenario: Project model changes
GIVEN source files are unchanged
AND a taint model source/sink/sanitizer definition changes
WHEN program analysis runs
THEN incompatible cached taint output is invalidated
AND the new model fingerprint is used.

#### Scenario: Unknown matcher kind
GIVEN a project model contains an unsupported matcher
WHEN it is loaded
THEN validation fails with model/matcher diagnostics
AND the matcher is not silently ignored.

### Requirement: Sanitization is path-specific
The taint engine SHALL evaluate sanitizer evidence per reaching path and preserve distinct unsanitized propagation paths.

#### Scenario: One reaching definition is sanitized and another is not
GIVEN one reaching definition passes through a sanitizer and another remains unsanitized
WHEN taint reaches the same sink through both paths
THEN the unsanitized path remains reportable
AND sibling sanitizer evidence does not erase it.

### Requirement: Interprocedural taint requires trusted semantic calls
The taint engine SHALL cross function boundaries only through trusted, evidence-bearing semantic call and dispatch relationships while bounding path certainty at each hop.

#### Scenario: Semantic graph is stale
GIVEN an intraprocedural taint finding exists
AND the graph is not trusted
WHEN an interprocedural trace is requested
THEN intraprocedural evidence may be returned
AND cross-function propagation is gated off with a boundary.

#### Scenario: Taint crosses candidate dispatch
GIVEN a call has multiple candidate targets
WHEN taint is propagated through one candidate
THEN path certainty is no stronger than the dispatch/call evidence
AND the path is not labeled exact.

### Requirement: Receiver dispatch preserves all valid candidates
Dispatch resolution SHALL retain every runtime target supported by the available type, hierarchy, and registration evidence unless exact narrowing excludes it.

#### Scenario: Interface has two possible implementations
GIVEN both implementations are valid under the indexed type/hierarchy evidence
WHEN dispatch resolution runs
THEN both candidates are retained
AND the resolver does not choose one merely because it has a higher heuristic score.

#### Scenario: Exact registration narrows runtime type
GIVEN dependency-registration evidence proves one concrete provider
WHEN receiver dispatch resolves the injected interface
THEN the candidate set may be narrowed using that exact registration evidence
AND the strategy/evidence is recorded.

### Requirement: Dispatch completeness is explicit
Every dispatch result SHALL state whether its candidate set is complete and list boundaries that prevent complete static enumeration.

#### Scenario: Runtime reflection can add targets
GIVEN the language/framework boundary prevents complete static enumeration
WHEN dispatch resolution runs
THEN `complete=false` and the boundary are returned
AND absence of additional candidates is not treated as proof.

### Requirement: Public taint trace is coverage-aware
The public taint trace SHALL report model, language, trust, and resource coverage and SHALL NOT equate no finding with proven safety under partial support.

#### Scenario: No finding in unsupported language
GIVEN the selected language or taint model capability is unsupported or partial
WHEN `taint_trace` runs
THEN it reports unsupported/partial capability
AND does not state that the code is safe from taint vulnerabilities.
