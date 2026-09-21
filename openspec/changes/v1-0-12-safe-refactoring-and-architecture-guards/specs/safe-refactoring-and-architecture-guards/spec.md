# Capability: Safe refactoring and architecture guards

## ADDED Requirements

### Requirement: Rename is canonical-identity based and dry-run by default
The refactoring service SHALL resolve one canonical target and produce a non-mutating rename plan unless source application is explicitly requested.

#### Scenario: Same simple name exists twice
GIVEN two canonical symbols share the same display name
WHEN rename is requested by that ambiguous name
THEN the system refuses to choose one
AND returns disambiguation candidates.

#### Scenario: Dry-run plan
GIVEN an exact target
WHEN rename is requested without explicit apply
THEN no file is modified
AND exact edits, candidate occurrences, boundaries and verification plan are returned.

### Requirement: Automatic edits require exact semantic spans
Automatic rename application SHALL modify only tested source spans that are linked exactly to the selected canonical target.

#### Scenario: Config string resembles symbol
GIVEN a string contains the old name without proven target identity
WHEN rename apply runs
THEN it is reported as a candidate
AND is not edited automatically.

#### Scenario: Language is preview-only
GIVEN a reference is resolved but no tested edit-span adapter exists
WHEN apply is requested
THEN automatic editing is refused for that occurrence
AND the capability boundary is reported.

### Requirement: Applied refactoring is semantically verified
After applying a rename, the system SHALL reanalyze affected source and withhold success unless expected definitions and references resolve to the new canonical symbol.

#### Scenario: Expected reference becomes unresolved
GIVEN a rename was applied
WHEN reanalysis cannot resolve a previously exact expected reference to the new symbol
THEN verification fails
AND success is not reported.

### Requirement: Architecture enforcement requires explicit policy
Architecture suggestions SHALL remain advisory, and only explicitly configured layer membership and dependency rules may produce blocking violations.

#### Scenario: Layer is only inferred
GIVEN a directory is heuristically classified as domain
AND no explicit policy confirms it
WHEN structural check runs
THEN the suggestion may be shown
AND it cannot fail the check.

### Requirement: Structural findings are evidence-bearing
Every structural finding SHALL include a stable rule identity, severity, location, evidence, certainty, and coverage suitable for JSON and SARIF output.

#### Scenario: Breaking API change
GIVEN contract comparison proves a breaking changed API
WHEN `code-intel check --changed` runs with that rule enabled
THEN JSON/SARIF contains a deterministic finding with rule, location, evidence and coverage/trust metadata.
