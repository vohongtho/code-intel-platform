# Proposal: Add Relationship Evidence, Certainty, and Coverage

## Summary

Make every semantically resolved relationship explainable and prevent downstream consumers from treating missing or heuristic graph edges as proof of safe absence.

v1.0.10 relationships persist only `kind`, `weight`, and `label`. The resolver also uses numeric weights as rough confidence. There is no durable distinction between exact, candidate, heuristic, unresolved, external, or truncated outcomes.

## User-visible correctness problem

A blast-radius result of zero can mean either “nothing depends on this symbol” or “the analyzer failed to model the relevant dispatch/reference class.” Without certainty/coverage metadata, impact, dead-code, suggested-test, context, and security consumers can turn incomplete graph evidence into a false-safe verdict.

## Goals

- Persist compact relationship trust metadata: call/reference-site identity, confidence, certainty, strategy, resolver version, ambiguity, evidence reference.
- Persist unresolved/external/truncated resolution outcomes without inventing fake target edges.
- Introduce shared `AnalysisCoverage` and `AnalysisBoundary` contracts.
- Distinguish confirmed relationship, candidate relationship, heuristic relationship, not-observed, unknown/incomplete, external boundary, and truncated analysis.
- Require proof before an empty impact/reference result is labeled exact/safe.
- Update existing consumers internally; do not add replacement MCP tools.

## Scope

### In scope

- Shared trust/coverage/boundary types.
- Compact LadybugDB relationship properties.
- Versioned evidence side store for verbose explanation.
- `blast_radius`, path, context, flow, PR-impact, suggested-test, dead-code/orphan, and relationship explanation behavior.
- Additive MCP/HTTP/OpenAPI/Web trust fields where user-facing.

### Non-goals

- Treating confidence as runtime probability.
- Hiding uncertain results.
- Requiring users to configure thresholds for safe behavior.
- Persisting every evidence detail directly inside LadybugDB relationship rows.

## Compatibility

Existing edge kinds, tools, and routes remain valid. Old clients can ignore additive trust fields. Compact default output remains compact.

## Migration

The relationship/evidence schema becomes a Generation compatibility input. Existing v1.0.10 indexes that cannot provide required trust semantics are rebuilt automatically during normal analysis.

## Dependencies

Depends on `v1-0-11-symbol-identity-v2` and `v1-0-11-evidence-based-resolution`.

## Release risk

High because risk/severity outputs may change from `LOW` to `UNKNOWN`/lower-bound when evidence is incomplete. This is intentional correctness, but response compatibility and UI wording require explicit tests.

## Performance impact

Low-to-medium. Compact columns add relationship storage. Verbose evidence must use a side store and lazy reads to avoid graph bloat.

## License/IP

Original implementation. Epistemic behavior inspired by general static-analysis best practice and clean-room competitor study.
