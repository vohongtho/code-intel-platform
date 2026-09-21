# Design: Agentic Cross-Repository Change Workflows

## 1. Existing control flow

Today workflow manifests are static instructions validated against `MCP_TOOL_DEFINITIONS`. They tell an external agent which tools to call but Code Intel does not retain workflow progress.

Multi-repo group sync owns contracts/links/consumer index. Local flow detection owns intra-repo paths. The new workflow layer composes these owners.

Implement and reopen-test the session store/state machine before adding planning orchestration. Complete deterministic single-repo expected-vs-actual verification before group session writes. Build system-flow stitching last, gated by stable local-flow identity and exact contract consumers; until then sessions report flow verification unavailable rather than synthesizing continuity.

## 2. New modules

Workflow state:
- `code-intel/core/src/agents/workflows/session-types.ts`;
- `agents/workflows/session-store.ts`;
- `agents/workflows/session-service.ts`;
- `agents/workflows/verification.ts`;
- `agents/workflows/commit-plan.ts`;
- `agents/workflows/review-lenses.ts`.

System flows:
- `multi-repo/system-flows/types.ts`;
- `system-flows/stitcher.ts`;
- `system-flows/identity.ts`;
- `system-flows/service.ts`.

Modify workflow registry/assets/validator, MCP definitions/server, CLI/HTTP/OpenAPI, group drift/PR impact as additive consumers.

## 3. Session contract

```ts
type ChangeWorkflowPhase =
  | 'discover'
  | 'plan'
  | 'ready-for-change'
  | 'reindex-required'
  | 'verify'
  | 'needs-revision'
  | 'review'
  | 'complete';

interface ChangeWorkflowSession {
  schemaVersion: 1;
  id: string;
  revision: number;
  phase: ChangeWorkflowPhase;
  createdAt: string;
  updatedAt: string;
  scope: WorkflowScope;
  taskFingerprint: string;
  taskSummary?: string;
  baselines: RepositoryBaseline[];
  selectedTargets: WorkflowTargetRef[];
  plan: WorkflowPlan;
  checkpoints: WorkflowCheckpoint[];
  capabilities: WorkflowCapabilityResolution;
}
```

Task summary persistence is configurable; full prompt history is not required.

## 4. Session store

Use atomic temp-write + rename. Validate schema and maximum byte/checkpoint counts on reopen. `revision` provides compare-and-swap semantics:
- caller sends expected revision;
- stale revision -> conflict with current revision;
- no lost update.

Store under repository-managed Code Intel data for single-repo sessions. Group sessions need one deterministic owning state root, preferably the global Code Intel group registry state if that is already authoritative, rather than duplicating the session into each member repo.

## 5. Baseline

At start:
- pin current Generation or semantic snapshot ID per repo;
- record Git commit/ref where available;
- record analyzer/schema fingerprints;
- record group sync/version if group scoped;
- capture current target symbols/contracts/stable flows.

No source copy is necessary.

## 6. Plan model

```ts
interface WorkflowPlanStep {
  id: string;
  title: string;
  repositories: string[];
  targets: WorkflowTargetRef[];
  expected: ExpectedSemanticCondition[];
  tests: PlannedTestEvidence[];
  reviewLenses: ReviewLensId[];
  dependsOn: string[];
  certainty: AnalysisCertainty;
  boundaries: AnalysisBoundary[];
}
```

Expected conditions are typed:
- node-exists/node-absent/identity-change;
- relationship-exists/absent;
- contract-compatible/expected-breaking;
- flow-preserved/flow-changed;
- test-evidence-present;
- structural-rule-no-new-violation;
- taint/security condition where capability exists.

## 7. Verification engine

For each affected repo:
1. resolve current trusted index/read view;
2. detect stale vs baseline;
3. compute semantic graph diff or current-vs-baseline equivalent;
4. run contract drift;
5. run planned test selection;
6. run requested review lenses;
7. evaluate expected conditions.

Condition evaluator is pure/deterministic. It returns status plus evidence IDs.

Unexpected changes are graph/contract/flow deltas not consumed by an expected condition, after ignoring configured benign/generated categories.

## 8. External edit boundary

The service transitions to `ready-for-change` and returns instructions/targets/context. The external user/agent edits files. On next status/verify:
- if repository source changed and index is stale, phase becomes `reindex-required`;
- verify refuses to reason from stale semantic state unless explicitly operating in a documented limited textual mode.

Code Intel does not invoke an autonomous editing agent.

## 9. Review lenses

`ReviewLens` has:
- id/version;
- required/optional capabilities;
- evaluator;
- finding severity;
- coverage.

Built-ins orchestrate existing services:
- architecture -> structural check;
- api -> contract drift;
- tests -> change/test intelligence;
- security -> scanner/taint trace where available;
- change-risk -> PR/PDG impact;
- scope -> expected-vs-actual diff.

## 10. Commit plan

`buildCommitPlan` groups verified changed files/symbols by plan step/repository/contract dependency and suggests conventional commit titles/bodies. It returns only data/text; no Git stage/commit action exists in the service.

## 11. System-flow data model

```ts
interface SystemFlow {
  id: string;
  fingerprint: string;
  algorithmVersion: string;
  segments: SystemFlowSegment[];
  certainty: AnalysisCertainty;
  coverage: AnalysisCoverage;
  boundaries: AnalysisBoundary[];
}

interface SystemFlowSegment {
  repositoryId: string;
  localFlowId?: string;
  entrySymbolId: string;
  exitSymbolId?: string;
  boundaryToNext?: SystemFlowBoundary;
}

interface SystemFlowBoundary {
  contractId: string;
  providerRepositoryId: string;
  consumerRepositoryId: string;
  consumerId: string;
  certainty: AnalysisCertainty;
}
```

## 12. Stitching algorithm

Inputs:
- synchronized group member snapshot/index descriptors;
- stable local flows;
- contract versions/consumer index;
- optional local path service.

Algorithm:
1. index local flow entry/member/exit canonical IDs;
2. for a local segment boundary contract, read exact/candidate consumers from current consumer index;
3. for exact consumer, find a local flow containing/starting at the consumer symbol; if none, optionally find a bounded exact local path;
4. append segment and continue;
5. stop on repo/system-flow cycle, hop/segment cap, partial group coverage, or unresolved consumer;
6. collect candidate continuations separately.

No simple-name matching.

## 13. System-flow identity/fingerprint

`SYSTEM_FLOW_VERSION` plus ordered:
- repository ID;
- local flow fingerprint or canonical entry/exit IDs;
- contract ID;
- consumer canonical ID.

The identity is deterministic and source-format independent. Any changed segment/boundary yields fingerprint change; continuity may correlate flows by stable origin only when unambiguous.

## 14. Persistence/invalidation

Persist group system-flow cache keyed by:
- group schema/version;
- member snapshot IDs;
- contract consumer-index fingerprint;
- local flow identity versions;
- stitcher version.

If any input changes, cache is stale and recomputed.

Workflow sessions store references to system-flow IDs/fingerprints; verification detects stale/replaced flows.

## 15. Public API

Prefer one MCP tool:
`change_workflow` with action enum.

CLI:
`workflow start|status|checkpoint|verify|complete`.

HTTP:
session endpoints only if server auth/ownership semantics can be defined cleanly; otherwise defer HTTP writes and keep MCP/CLI for v1.0.12. Read-only system flow query can be exposed independently.

Potential system-flow read tool:
`system_flows` with group, symbol/contract filter and bounded pagination.

## 16. Workflow asset evolution

Keep eight IDs. Add optional `change_workflow` and `explore` capability declarations to manifests. Validator ensures assets never require a tool absent from the live definition registry.

User-modified managed assets keep current conflict-preservation behavior.

## 17. Dependencies

Hard:
- current workflow registry;
- semantic identities;
- group contract links.

For exact historical system flows:
- stable local flow identity from change-risk change.

Optional:
- adaptive Explore;
- ref-aware views;
- GraphQL/gRPC richer contracts;
- PDG/test intelligence;
- architecture/taint review lenses.

Missing optional feature creates reduced-guarantee boundary.

## 18. Tests

Session:
- lifecycle/phase transitions;
- optimistic revision conflict;
- stale index requiring reindex;
- expected condition satisfied/unknown/unexpected;
- partial capabilities;
- reopen/corruption/size bounds.

System flows:
- HTTP and event cross-repo exact boundary;
- candidate consumer not exact;
- three-repo chain;
- cycle;
- missing local flow fallback;
- cap/partial group;
- deterministic identity/cache invalidation.

Integration:
- plan -> external fixture edit -> analyze -> verify;
- intentional API break with consumer repo migration;
- unexpected extra dependency;
- commit plan output without Git mutation.

## 19. Observability/performance

Session verification work scales by changed/planned scope, not entire group where avoidable. System-flow stitching uses indexes by contract/consumer/local-flow membership. Add hop/segment/candidate caps and counters. No O(all flows × all contracts × all repos) nested scan in hot path.
