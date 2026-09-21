# Capability: Change risk and test intelligence

## ADDED Requirements

### Requirement: PR impact can use bounded PDG precision
The system SHALL optionally map changed source statements through the existing PDG when the language, index trust and resource budgets permit it.

#### Scenario: PDG-supported changed function
GIVEN changed lines map to statements in a PDG-capable function
AND the semantic graph is trusted
WHEN PR impact runs with `precision=pdg`
THEN forward data/control-dependent statements are computed within limits
AND their semantic projections are returned with origin evidence.

#### Scenario: PDG is unavailable
GIVEN a changed function is unsupported, cannot be mapped, or exceeds analysis limits
WHEN PDG precision is requested
THEN that function falls back to graph-level impact
AND the boundary/fallback is reported
AND zero PDG results are not treated as proof of no impact.

### Requirement: Interprocedural PDG conclusions preserve relationship certainty
#### Scenario: Slice crosses an ambiguous call
GIVEN a PDG projection must cross an ambiguous call relationship
WHEN downstream impact is reported
THEN its certainty is no stronger than that call relationship
AND it is not labeled exact.

### Requirement: Test selection distinguishes evidence categories
#### Scenario: Test reaches changed flow
GIVEN an existing test has evidence that it covers a stable affected flow
WHEN tests are selected
THEN it is classified `affected-flow`
AND is ranked separately from candidate or generic suggestions.

#### Scenario: Coverage is incomplete
GIVEN analysis cannot establish complete relevant test coverage
WHEN no direct test is found
THEN the result is `unknown`
AND does not claim that a test is definitively missing or unnecessary.

### Requirement: Flow identity is deterministic
#### Scenario: Identical source analyzed twice
GIVEN two independent full analyses of the same repository revision
WHEN execution flows are persisted
THEN the same logical flow has the same versioned flow identity/fingerprint.

### Requirement: Stable flows can be diffed conservatively
#### Scenario: Flow path changes between refs
GIVEN the same stable entry point has a changed canonical step path
WHEN semantic graph diff runs
THEN the flow section reports a path/membership change with evidence
AND does not fabricate a rename between ambiguous flows.

### Requirement: PDG impact quality is evaluated against mutations
#### Scenario: Release enables automatic PDG precision
GIVEN the v1.0.12 mutation corpus
WHEN graph and PDG modes are compared
THEN the documented recall/precision gate passes
AND the benchmark output is reproducible
OTHERWISE automatic PDG selection remains disabled/experimental.
