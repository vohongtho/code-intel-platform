# Semantic Resolution Specification

## ADDED Requirements

### Requirement: Target resolution MUST use semantic evidence instead of simple-name uniqueness alone

#### Scenario: Multiple same-named methods exist

- **GIVEN** a member call with receiver/owner evidence
- **WHEN** multiple declarations share the called simple name
- **THEN** the resolver MUST prefer candidates compatible with the receiver/owner evidence
- **AND** MUST NOT select an unrelated target solely because a global name map contains it.

### Requirement: Global simple-name fallback MUST NOT produce exact certainty by itself

#### Scenario: Only a same-name global declaration is known

- **WHEN** no stronger scope/import/type/owner evidence proves the binding
- **THEN** any materialized candidate MUST be heuristic/candidate
- **AND** MUST NOT be labeled exact.

### Requirement: Language-defined public surfaces MUST participate in import resolution

#### Scenario: Caller imports a name through a package/module re-export

- **GIVEN** the target language publishes the name through a supported re-export chain
- **WHEN** the caller binding is resolved
- **THEN** the implementation declaration MUST be reachable through the public-surface evidence chain.

### Requirement: Ambiguous publication MUST remain ambiguous

#### Scenario: Multiple distinct definitions may publish one name

- **WHEN** static evidence cannot prove which definition is active
- **THEN** the resolver MUST preserve a candidate/ambiguous outcome
- **AND** MUST NOT choose based only on source/iteration order.

### Requirement: Generic/type-application structure MUST survive to language-specific resolution

#### Scenario: Receiver has type `Repo<User>` and other generic/specialized declarations exist

- **WHEN** candidates are evaluated
- **THEN** the resolver MUST retain type-argument/specialization evidence until the language module applies its semantics
- **AND** MUST NOT globally collapse all candidates to bare `Repo` first.

### Requirement: Candidate truncation MUST make coverage incomplete

#### Scenario: Interface dispatch exceeds fan-out limit

- **WHEN** only a bounded subset is emitted
- **THEN** the outcome MUST be `truncated` or equivalent incomplete candidate-set status
- **AND** total/emitted candidate coverage MUST be observable.

### Requirement: Resolution hot paths MUST use prepared indexes

#### Scenario: Repository size grows while import/reference count also grows

- **WHEN** production adapter resolution executes
- **THEN** configured full-workspace traversal/index-build budgets MUST be respected
- **AND** a per-reference O(files) scan MUST fail the structural performance gate unless explicitly justified by measured design evidence.
