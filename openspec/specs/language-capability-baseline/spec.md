# Language Capability Baseline

## Purpose

Define the canonical semantic-capability and resolver-scalability baseline for every advertised Code Intel language.

## Requirements

### Requirement: Every advertised language MUST have one canonical capability descriptor

The system MUST represent every advertised language exactly once in the canonical language registry.

#### Scenario: Registry completeness

- **GIVEN** the production `Language` enum
- **WHEN** the language registry is validated
- **THEN** TypeScript, JavaScript, Python, Java, Go, C, C++, C#, Rust, PHP, Kotlin, Ruby, Swift, Dart, and HTML MUST each have exactly one descriptor
- **AND** no descriptor language MAY be absent from the production enum.

### Requirement: Grammar availability MUST NOT be treated as proof of semantic support

The system MUST NOT treat grammar availability as proof of semantic support.

#### Scenario: Grammar loads but semantic query is missing

- **GIVEN** a language whose WASM grammar is available
- **AND** a required semantic extraction capability is not implemented
- **WHEN** release capability is reported
- **THEN** that capability MUST be `partial` or `unsupported`
- **AND** MUST NOT be reported `supported` solely because the grammar loaded.

### Requirement: Shared semantic changes MUST preserve all accepted language rows

The shared semantic release gate MUST preserve every accepted language row.

#### Scenario: One language regresses while aggregate metrics improve

- **GIVEN** accepted per-language semantic baselines
- **WHEN** a shared parser/resolver change improves average precision but breaks one accepted language case
- **THEN** the release gate MUST fail
- **AND** the regression MUST NOT be hidden by aggregate averages.

### Requirement: HTML support MUST be truthful and structural

HTML support MUST remain truthful and structural.

#### Scenario: HTML document contains resources and form/navigation references

- **GIVEN** HTML with script sources, stylesheet links, anchors, forms, IDs, and classes
- **WHEN** analysis runs
- **THEN** the defined structural/resource facts MUST be observable
- **AND** ordinary HTML elements MUST NOT be emitted as executable functions
- **AND** raw HTML control-flow/data-flow capability MUST be `not-applicable` unless an executable embedded language region is analyzed separately.

### Requirement: Resolver scalability MUST be registry-gated

Resolver scalability MUST be enforced by registry-gated contracts.

#### Scenario: Production adapter accidentally scans all files per import/reference

- **GIVEN** a language whose performance contract permits at most the configured workspace traversals/index builds
- **WHEN** a scaling fixture runs through the production adapter path
- **THEN** traversal and index-build counters MUST stay within the contract
- **AND** timing improvement alone MUST NOT allow a structural complexity regression to pass.
