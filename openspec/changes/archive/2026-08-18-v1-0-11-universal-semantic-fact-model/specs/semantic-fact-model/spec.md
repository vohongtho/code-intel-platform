# Semantic Fact Model Specification

## ADDED Requirements

### Requirement: Parsing and relationship resolution MUST share one semantic fact source

The system MUST use one shared semantic fact source for parsing and relationship resolution.

#### Scenario: A supported call site is extracted

- **GIVEN** a source file containing a supported call construct
- **WHEN** the language adapter emits a `CallSiteFact`
- **THEN** graph relationship resolution MUST consume that fact
- **AND** MUST NOT independently reinterpret the same call through a conflicting line-regex model.

### Requirement: Semantic declarations MUST use the smallest one-entity identity anchor

The system MUST assign each semantic declaration the smallest anchor that identifies exactly one entity.

#### Scenario: One syntax wrapper contains multiple declarations

- **GIVEN** a grouped or multi-declaration syntax node
- **WHEN** declaration facts are emitted
- **THEN** each semantic declaration MUST receive its own identity anchor
- **AND** documentation, scope, or render anchors MAY reference a containing wrapper without merging declaration identity.

### Requirement: Import binding and public-name publication MUST be distinct facts

The system MUST represent import bindings and public-name publication as distinct facts.

#### Scenario: Import is local to a function/class scope

- **GIVEN** a language where a local-scope import does not publish a module-level name
- **WHEN** the import is extracted
- **THEN** an import-binding fact MUST be emitted
- **AND** a module public-name fact MUST NOT be emitted solely because the import exists.

### Requirement: Type structure MUST be preserved until language semantics are evaluated

The system MUST preserve extracted type structure until language semantics evaluate it.

#### Scenario: Generic receiver type is extracted

- **GIVEN** a receiver whose declared type is a generic application such as `Repo<User>`
- **WHEN** a type fact is created
- **THEN** the base type and type arguments MUST remain distinguishable
- **AND** the fact MUST NOT be reduced globally to the bare name `Repo` before language-specific resolution.

### Requirement: Cross-file-affecting extraction loss MUST be observable

The system MUST make cross-file-affecting extraction loss observable through diagnostics.

#### Scenario: Adapter cannot determine module/owner identity

- **WHEN** the missing identity can make later cross-file resolution incomplete
- **THEN** a bounded diagnostic MUST identify the affected capability and impact scope
- **AND** analysis MUST NOT silently claim complete semantics for the affected fact class.
