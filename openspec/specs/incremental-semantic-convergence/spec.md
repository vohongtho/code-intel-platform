# Incremental Semantic Convergence

## Purpose

Define correctness guarantees for dependency-aware incremental semantic analysis: incremental output must converge to what a fresh full analysis would produce, unchanged files must be re-resolved when their dependencies change, incomplete invalidation knowledge must fall back to full analysis, and a failed incremental attempt must never disturb the active published generation.

## Requirements

### Requirement: Incremental semantic output MUST converge to fresh full analysis

Incremental analysis output MUST be equivalent to a fresh full analysis of the same final repository tree.

#### Scenario: Same final repository tree reached through an edit history

- **WHEN** the final incremental generation and a forced fresh full generation are normalized
- **THEN** canonical symbols, declaration fragments, relationships, trust/evidence receipts, and required retrieval membership MUST be equivalent
- **AND** equality MUST NOT be established only from node/edge counts.

### Requirement: Unchanged source MUST be re-resolved when dependency facts change

Unchanged source files that depend on a changed declaration, type, or public surface MUST be re-resolved.

#### Scenario: Declaration/type/public-surface fact changes elsewhere

- **GIVEN** an unchanged file contains a dependent call/reference/import
- **WHEN** semantic invalidation closure is computed
- **THEN** the unchanged dependent site MUST be included for re-resolution.

### Requirement: Incomplete invalidation knowledge MUST fall back to full analysis

When invalidation closure cannot be proven complete, the analyzer MUST fall back to full analysis automatically.

#### Scenario: Reverse dependency metadata is missing or incompatible

- **WHEN** planning cannot prove complete closure
- **THEN** the analyzer MUST automatically select the existing correctness-first full graph/BM25 rebuild
- **AND** MUST NOT require a user flag or migration command.

### Requirement: Failed incremental staging MUST preserve the active generation

A failed incremental staging or publication attempt MUST leave the previously published generation active and untouched.

#### Scenario: Incremental candidate fails convergence/read-back verification

- **WHEN** publication is aborted
- **THEN** the previously published Generation V2 snapshot MUST remain active and reopenable.
