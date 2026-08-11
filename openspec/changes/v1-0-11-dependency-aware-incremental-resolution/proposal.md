# Proposal: Add Dependency-Aware Incremental Semantic Resolution

## Summary

Re-enable non-zero incremental graph/BM25 work only after the new fact/identity/resolver layers can compute complete semantic invalidation closure. Preserve v1.0.10's correctness-first full rebuild as the automatic fallback.

## Production-baseline problem

v1.0.10 intentionally falls back to full graph/BM25 rebuild when source changes because deleting/replacing changed-file nodes can invalidate incoming relationships from unchanged files. This is correct but sacrifices incremental performance.

The missing capability is not “detect changed files”; it is “determine every unchanged call/reference/import/type/registration whose resolution can change because facts elsewhere changed.”

## User-visible problem

Large repositories pay full graph/BM25 rebuild cost for small source changes. A naive incremental optimization would be worse than the current behavior because it could publish a graph that differs from a clean rebuild.

## Goals

- Introduce versioned semantic fact snapshots/deltas.
- Build reverse dependency indexes for public surfaces, types, heritage, call/reference candidate domains, callbacks/events/DI/framework registrations.
- Re-resolve affected unchanged source when declaration/type/module/registration facts change.
- Drive graph, BM25, vector, evidence, flow/cluster summaries, and future program-analysis invalidation from one semantic delta plan.
- Preserve automatic full-rebuild fallback when closure is unavailable, incompatible, too broad, or uncertain.
- Prove full-vs-incremental convergence by semantic sets/fingerprints, not counts.

## Scope

### In scope

- Semantic snapshot and delta contracts.
- Reverse dependency indexes.
- Changed + affected unchanged re-resolution.
- Deleted/moved/renamed declarations and re-export changes.
- Generation V2 staging integration.
- Long-history convergence and dirty working-tree tests.

### Non-goals

- Incremental execution for every edit at any cost.
- Disabling full rebuild fallback.
- User-visible incremental mode switch.
- Replacing current working-tree change detection if already correct.

## Compatibility

`code-intel analyze` remains the only normal user action. The planner chooses incremental/full internally.

## Migration

Reverse dependency/index format is versioned. Missing/incompatible dependency metadata triggers the existing full rebuild and repopulates required metadata.

## Dependencies

Depends on semantic facts, identity v2, evidence-based resolution, and relationship certainty. Integrates with Generation semantic verification.

## Release risk

Very high. Incremental publication remains disabled for non-zero semantic graph changes until shadow/full convergence gates pass for all 15 languages.

## Performance impact

Positive for small changes after rollout. Additional reverse-index storage/memory is required. Broad invalidation must automatically switch to full rebuild.

## License/IP

Original implementation; clean-room behavior for competitor-inspired convergence techniques.
