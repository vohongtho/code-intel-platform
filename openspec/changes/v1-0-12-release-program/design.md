# Design: v1.0.12 Release Program

## 1. Architectural strategy

v1.0.12 is an integration release across existing engines, not a platform rewrite. Each detailed change owns one focused extension point and communicates through existing stable identities and service contracts.

## 2. Shared invariants

1. Current-repository behavior remains the default.
2. Alternate-ref reads never mutate the active Generation V2 generation.
3. Statement-level program-analysis artifacts remain separate from the semantic graph.
4. Any projection from PDG/taint to graph entities carries certainty, coverage and truncation.
5. Cross-repository traversal crosses only modeled contracts; a heuristic/candidate contract does not become an exact system-flow edge.
6. Refactoring is plan-first and dry-run by default.
7. Portable indexes and offline runtime bundles are untrusted until integrity/authenticity checks pass.
8. Agent workflows verify expected structural changes after edits instead of trusting an edit succeeded because files changed.

## 3. Ownership map

| Concern | Existing owner | v1.0.12 extension |
|---|---|---|
| Context | `src/context/*` | render policy, skeletonization, explore orchestration |
| Search | `src/search/*` | bounded graph-aware rerank |
| Ref snapshots | `src/snapshots/*` | normal read/query selection + export/import |
| PR impact | `src/query/pr-impact.ts` | PDG projection and flow/test risk |
| Tests | `src/query/suggest-tests.ts`, `analysis/test-coverage.ts` | change-flow coverage |
| API contracts | `src/semantic/api-contracts/*` | shape-check completion |
| Cross-repo | `src/multi-repo/*` | GraphQL/gRPC compatibility + system flows |
| Program analysis | `src/program-analysis/*` | change slices + extensible taint |
| Resolution | `src/resolution/*` | receiver type-set dispatch |
| Workflows | `src/agents/workflows/*` | checkpoint/session layer |
| Runtime | `src/cli/runtime-*`, `scripts/distribution/*` | authenticity/offline bundle |
| Web | `code-intel/web/src/pages/GraphDiffPage.tsx`, `code-intel/web/src/api/graph-diff-types.ts` | additive stable-flow/ref/workflow evidence in the existing graph-diff view |

## 4. Rollout

Each detailed change may be merged independently if its compatibility contract and release gates pass. Features that depend on another change must detect missing capability and degrade with an explicit boundary rather than silently approximating the stronger result.

The release uses seven ordered checkpoints: planning repair; identity/read-view/archive-safety foundations; small vertical capabilities; PDG/test and portable-index intelligence; protocol schemas and comparators; capability-gated refactoring/dispatch/interprocedural analysis; and workflow/system-flow integration. Schema-level protocol compatibility, declarative taint models and single-repository workflow sessions do not wait for their later optional binding, dispatch or cross-repository layers.

## 5. Validation

The release program is complete when all detailed changes that are selected for 1.0.12 have:
- validated OpenSpec;
- focused and full test passes;
- benchmark/eval evidence;
- compatibility evidence;
- documentation;
- release-readiness checks.

This umbrella change does not implement product behavior itself.
