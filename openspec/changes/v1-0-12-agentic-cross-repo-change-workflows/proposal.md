# v1.0.12: Agentic Cross-Repository Change Workflows

## Change ID
`v1-0-12-agentic-cross-repo-change-workflows`

## Feature IDs
F07, F22

## Priority
P1 — strategic differentiation

## Summary
Evolve the existing static agent workflow assets into resumable graph-verified change sessions, and stitch exact cross-repository contracts plus stable local flows into system/business-flow traces that can be used for planning, review, validation, and test selection.

Code Intel remains an intelligence and verification layer. It does not become an autonomous source editor or Git committer.

## 1. Source-verified baseline

v1.0.11 already includes eight workflow manifests under `code-intel/core/src/agents/workflows/registry.ts`:
- `explore`;
- `debug`;
- `impact`;
- `plan`;
- `review`;
- `api-review`;
- `test-coverage`;
- `security-investigation`.

These manifests validate tool availability and install agent-specific static assets for Claude/Cursor. They do not maintain a durable execution/checkpoint state after an external agent edits code.

The multi-repository subsystem already has:
- repository groups;
- stable repository identity;
- synchronized contracts;
- cross-repo provider/consumer links;
- contract consumer index;
- branch/ref contract drift;
- certainty/coverage;
- exact-consumer test/flow guidance in drift findings.

Local execution flows already exist but v1.0.11 identities are not stable across analyses; `v1-0-12-change-risk-and-test-intelligence` owns stabilization.

The missing product layer is therefore:
1. a stateful plan→external-work→reindex→verify workflow;
2. expected-vs-actual graph/contract/test validation at checkpoints;
3. system flows that join local flows across proven repository contracts.

## 2. Workflow session model

Add a resumable state machine:

```text
DISCOVER
   |
   v
PLAN
   |
   v
READY_FOR_CHANGE
   |
   | external agent/user edits files
   v
REINDEX_REQUIRED
   |
   v
VERIFY
   |----> NEEDS_REVISION
   |          |
   |          +---- external edit -> REINDEX_REQUIRED
   v
REVIEW
   |
   v
COMPLETE
```

A session stores:
- schema version and session ID;
- repository/group scope;
- task summary/fingerprint;
- baseline index/snapshot IDs and Git refs;
- selected canonical symbols/contracts/flows;
- planned steps;
- expected semantic deltas;
- expected API/protocol changes;
- expected tests/checks;
- capability/coverage boundaries;
- checkpoint history;
- latest verification result;
- optional commit grouping plan.

The session SHALL NOT store full source blobs unless explicitly necessary; use stable identities/fingerprints/anchors.

## 3. User workflow

Single repository:

```bash
code-intel workflow start --task "add idempotency to payment capture" --scope repo
code-intel workflow status <session>
# user/agent changes code
code-intel analyze
code-intel workflow verify <session>
```

Repository group:

```bash
code-intel workflow start --task "rename customerId to accountId across contracts" --group commerce
# agent changes one or more repos
code-intel workflow verify <session> --group commerce
```

MCP should prefer one action-oriented tool instead of many near-duplicate tools:

```json
{
  "action": "start|status|checkpoint|verify|complete",
  "session_id": "...",
  "task": "...",
  "scope": { "type": "repo|group", "...": "..." }
}
```

Suggested name: `change_workflow`.

## 4. Planning

On `start`, the workflow composes:
- Explore/task context when the adaptive exploration capability is installed;
- graph/API/group impact;
- stable local/system flow evidence;
- suggested tests;
- structural/security/API review lenses relevant to the task.

The plan separates:
- `required` edits: exact evidence;
- `candidate` edits: heuristic/ambiguous evidence;
- `optional` cleanup;
- `blocked/unknown`: missing capability/coverage.

No file edit is performed by the workflow service.

## 5. Expected semantic deltas

Each plan step can specify expected post-change conditions, for example:
- symbol renamed/moved/added/removed;
- relationship added/removed;
- API contract intentionally changed/unchanged;
- no new forbidden architecture edge;
- consumer repositories updated;
- stable flow preserved or intentionally changed;
- expected tests added/selected;
- security boundary not weakened.

These conditions are expressed against canonical identities/contracts, not display-name-only text.

## 6. Checkpoint and verification

After external edits:
1. verify repository/branch/ref still corresponds to the session scope;
2. require/recommend reanalysis for stale affected repos;
3. compute changed files/symbols;
4. compare graph/snapshot/contract deltas against expected conditions;
5. run selected review lenses;
6. evaluate test evidence;
7. identify unexpected changes and remaining planned items;
8. update checkpoint state.

Verification classifications:
- `satisfied`;
- `partially-satisfied`;
- `unexpected-change`;
- `not-observed`;
- `unknown`;
- `blocked`.

Unknown/partial evidence does not become satisfied.

## 7. Atomic commit planning

The workflow may propose commit groups after verification:
```text
1. feat(api): add accountId contract
2. refactor(portal): migrate customerId consumers
3. test: cover compatibility migration
```

A `CommitPlan` contains changed files/symbols and rationale, but Code Intel SHALL NOT execute `git commit`, stage files, rewrite history, or push.

This keeps human/agent source-control agency outside the intelligence layer.

## 8. Specialized review lenses

Reusable lenses:
- `architecture`: structural policy/new cycles;
- `api`: HTTP/GraphQL/gRPC compatibility and consumers;
- `tests`: direct/flow/transitive/unknown test evidence;
- `security`: vulnerability/taint evidence when capability exists;
- `change-risk`: graph/PDG impact;
- `scope`: planned-vs-unexpected semantic changes.

A workflow selects lenses based on task and capabilities. Users can request additional lenses.

## 9. Cross-repository system-flow model

A `SystemFlow` stitches repository-local stable flows across exact contract boundaries.

Example:

```text
web repo:
  CheckoutPage.submit
   -> apiClient.capturePayment
       |
       | HTTP POST /payments/capture
       v
payments repo:
  PaymentController.capture
   -> PaymentService.capture
   -> event publish payment.captured
       |
       v
notifications repo:
  PaymentCapturedConsumer.handle
   -> ReceiptSender.send
```

A system flow consists of ordered segments:
```ts
interface SystemFlowSegment {
  repositoryId: string;
  localFlowId?: string;
  entrySymbolId: string;
  exitSymbolId?: string;
  boundary?: {
    contractId: string;
    providerRepositoryId: string;
    consumerRepositoryId: string;
    certainty: AnalysisCertainty;
    consumerId: string;
  };
}
```

## 10. Cross-repository stitching rules

A repository boundary is stitched as an exact system-flow continuation only when:
- the provider/consumer contract link is exact enough according to current contract semantics;
- both repository identities are known;
- the local consumer entry symbol can be resolved;
- relevant local flow identity exists or a bounded local path can be proven;
- group sync/snapshot coverage is not stale/incomplete for that claim.

Heuristic/candidate contract links appear as candidate continuations, not exact system-flow edges.

No cross-repo flow is inferred from same method/class/event names alone.

## 11. System-flow identity

Stable identity is content-derived from:
- system-flow algorithm version;
- ordered repository IDs;
- ordered stable local-flow IDs or canonical entry/exit IDs;
- ordered contract IDs at boundaries.

```text
systemFlowId = hash(version + segment identities + boundary contract identities)
```

A local flow path change or contract boundary change produces a changed/new fingerprint. Historical comparison can distinguish:
- local segment changed;
- contract boundary changed;
- repository segment added/removed;
- consumer became ambiguous/unresolved.

## 12. Group-aware change impact

For a changed contract/symbol:
- find local affected stable flows;
- find exact known cross-repo consumers;
- continue into consumer local flows;
- bound repository hops and total segments;
- attach affected system flows to group drift/PR impact/workflow verification.

Cap hits produce lower-bound coverage.

## 13. Persistence

Workflow sessions are local project/user data, not semantic Generation contents. Store under a managed Code Intel state directory such as:
```text
.code-intel/workflows/sessions/<sessionId>.json
```
or the established global/repo-managed data root if ownership rules require it.

Session state has:
- schema version;
- atomic writes;
- maximum history/checkpoint retention;
- no secrets;
- explicit source/task retention policy.

System flows are derived semantic artifacts and should be persisted/fingerprinted with group sync/snapshot state if reuse is needed. They must never be valid when member snapshot/contract/flow fingerprints no longer match.

## 14. Dependencies and graceful degradation

Strongest experience depends on:
- adaptive Explore;
- ref-aware index views;
- stable local flow identity;
- protocol contract intelligence;
- PDG/test intelligence;
- structural/taint review lenses.

The workflow engine SHALL NOT require all of these. It records unavailable optional capabilities and reduces guarantees explicitly.

For example, without PDG it verifies graph-level impact; without stable flows it verifies symbols/contracts but marks flow verification unavailable.

## 15. Automatic context selection

Workflow steps should use task intent and planned canonical targets to request focused context automatically. Do not dump all repository source into prompts/assets.

Session records content fingerprints for context already supplied so external agents can avoid redundant reads where integrations support it.

## 16. Agent integration

Existing `agents/workflows` manifests evolve to understand optional `change_workflow` session capability.

Do not delete the eight static workflow IDs. Their instructions may:
- start or join a session;
- request status;
- perform external edit work;
- reindex;
- verify;
- stop when verification reports blocked/unknown rather than claiming completion.

Managed workflow asset fingerprint/conflict-preservation behavior remains.

## 17. Concurrency and stale sessions

A session pins baseline identities, not filesystem assumptions.

Verification must detect:
- branch/HEAD moved unexpectedly;
- repository group membership changed;
- baseline snapshot evicted but reproducible;
- analyzer/schema version incompatible;
- concurrent session updated state.

Use optimistic session revision/version. Stale update returns conflict rather than overwriting a newer checkpoint.

## 18. Security and privacy

- session ID is unguessable/random;
- file paths/state writes remain inside managed directory;
- session JSON is bounded/untrusted on reopen;
- no OAuth tokens/API secrets/source blobs stored by default;
- MCP session actions require the same auth/repo scope policy as underlying tools;
- workflow cannot bypass source-write restrictions because it does not write source.

## 19. Observability

Record:
- session phase transitions;
- time spent planning/reindexing/verifying;
- planned vs actual semantic delta counts;
- unexpected changes;
- lens results;
- cross-repo segment/hop counts;
- candidate/cap/partial boundaries.

Do not emit task/source text to telemetry by default.

## 20. Non-goals

- autonomous file editing;
- staging/committing/pushing;
- background agents that continue without an explicit run;
- cross-repo taint propagation;
- runtime distributed tracing;
- forcing one agent vendor;
- claiming a system flow is a runtime trace.

## 21. Acceptance

A user/agent can start a plan, edit externally, reindex, and receive deterministic expected-vs-actual verification; static workflows remain usable; exact contract links stitch stable local flows across repos; candidates remain candidates; session conflicts/staleness are explicit; commit plans are suggestions only.
