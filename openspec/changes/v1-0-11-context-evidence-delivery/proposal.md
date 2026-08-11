# Proposal: Improve Existing Context Evidence Selection and Delivery

## Summary

Keep the existing `context` tool and v1.0.10 hard token budget, but improve symbol selection, evidence ranking, ambiguity handling, omission/coverage reporting, and repeated-source delivery across one MCP session.

## Production-baseline evidence

v1.0.10 already fixed final context token-budget enforcement and exposes block token counts/truncation. However `context/builder.ts::DedupeRegistry` uses symbol names as identity for cross-block deduplication, so unrelated same-name symbols can suppress each other. Context relevance is primarily graph/name driven and does not yet incorporate relationship certainty from the new semantic engine. Repeated MCP calls have no shared delivered-source memory.

## User-visible problem

An agent can receive the wrong same-name seed, lose a relevant same-name symbol due to name-based dedupe, spend tokens on uncertain relationships as if exact, or repeatedly receive source already seen in the same session while answer-bearing evidence is omitted.

## Goals

- Replace name-based context identity/deduplication with canonical symbol/artifact identity.
- Use the shared selector union so ambiguous seeds are never silently first-match exact.
- Add an optional additive `task` field to the existing context request; use it for intent/relevance when supplied.
- Rank exact evidence ahead of heuristic/candidate evidence while preserving uncertainty/boundary summaries.
- Track allocation/delivery receipts so explicitly requested evidence either appears or has a structured omission reason.
- Add session/workspace scoped source-range deduplication using content fingerprints; changed source must be re-emitted.
- Preserve the existing final hard token ceiling and block schema.

## Scope

### In scope

- Canonical seed resolution.
- Identity-based cross-block dedupe.
- Task-aware intent/ranking as an optional additive input.
- Evidence/certainty-aware ranking.
- Per-artifact token allocation/delivery receipts.
- Session-aware unchanged-source back-references.
- Context quality benchmarks: named-evidence delivery, critical-evidence recall, unique evidence/token, duplicate source bytes, external file-read fallback.

### Non-goals

- Increasing the default hard token budget.
- Introducing `context_v2` or another replacement MCP tool.
- Persisting conversation source history across process/user sessions.
- Deduplicating away trust/boundary/current-risk metadata.
- Replacing search/retrieval entirely.

## Compatibility

Existing `{ symbols: [...] }` context calls remain valid. `task`, `coverage`, `trust`, `omitted`, and delivery metadata are optional/additive. Existing block strings remain available.

## Migration

No index migration solely for session delivery. Canonical selection/trust ranking uses identity/evidence artifacts when available; legacy generations retain conservative compatibility behavior.

## Dependencies

Depends on `v1-0-11-symbol-identity-v2` and `v1-0-11-relationship-certainty`.

## Release risk

Medium. Context ordering/content may change. Snapshot tests must focus on deterministic evidence quality rather than preserving obsolete name-based suppression.

## Performance impact

Low. Per-session delivery state is bounded; source fingerprints can be computed only for selected ranges/artifacts.

## License/IP

Original integration. Session-aware context ideas may be inspired by MIT CodeGraph behavior; do not copy implementation unless attribution obligations are explicitly handled.
