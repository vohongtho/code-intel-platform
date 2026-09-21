# Design: Change Risk and Test Intelligence

## 1. Existing control flow

`query/pr-impact.ts` consumes changed files/diff-derived scope and semantic graph traversal. `query/suggest-tests.ts` walks caller/import relationships. Program analysis is separately owned by `src/program-analysis/*`. Flow generation is owned by `flow-detection/*` and its pipeline phase.

The design joins these through canonical symbol identity; it does not merge the two graph layers.

## 2. New modules

Add:
- `code-intel/core/src/program-analysis/change-slice.ts`;
- `program-analysis/source-map.ts` or a focused source-range→IR mapping module;
- `query/change-risk.ts`;
- `query/test-selection.ts`;
- `flow-detection/identity.ts`;
- `eval/run-pdg-mutation-bench.mjs`;
- mutation fixture manifests under `eval/fixtures/pdg-mutations/`.

Modify:
- `query/pr-impact.ts`;
- `query/suggest-tests.ts`;
- `flow-detection/entry-point-finder.ts`;
- `pipeline/phases/flow-phase.ts`;
- `snapshots/types.ts` and `snapshots/graph-diff.ts`;
- MCP definitions/server, CLI PR-impact command, HTTP/OpenAPI.

## 3. Source-range mapping

Introduce a stable `SourceStatementMap` built during/lazily from lowering:
```ts
interface SourceStatementRef {
  statementId: string;
  startLine: number;
  endLine: number;
  functionId: string;
}
```

A diff hunk may map to zero, one, or multiple IR statements. Zero mapping is an explicit boundary, not a reason to claim no semantic effect.

## 4. Slice model

```ts
interface ChangeSlice {
  functionId: string;
  seedStatementIds: string[];
  forward: SliceNode[];
  backward?: SliceNode[];
  dataDependencies: number;
  controlDependencies: number;
  truncated: boolean;
  reason?: string;
  certainty: ResolutionCertainty;
}
```

Intraprocedural slice uses existing PDG. Cross-function projection uses function/call summaries and trusted semantic call edges through `gateInterproceduralAnalysis`.

## 5. Precision selection

`precision: graph|pdg|auto`.

- graph: existing behavior;
- pdg: attempt PDG for all eligible changed functions, explicitly report fallback rows;
- auto: use capability registry + trusted index + resource budget + mutation-gate feature flag.

Requested and actual precision is reported per function and globally.

## 6. Projection

PDG statement results project to:
1. owning semantic function;
2. callers/callees only through trusted relationship evidence;
3. route/API contracts through existing graph/API facts;
4. stable execution flows;
5. tests through tested_by/import/call evidence.

The result keeps origin evidence so a caller can distinguish "statement dependency" from "call-graph expansion".

## 7. Test evidence

Create `TestEvidence`:
```ts
type TestEvidenceKind = 'direct'|'affected-flow'|'transitive'|'candidate'|'unknown';
interface TestEvidence {
  testId?: string;
  filePath?: string;
  kind: TestEvidenceKind;
  path?: string[];
  certainty: AnalysisCertainty;
  boundaries: AnalysisBoundary[];
}
```

`selectTestsForImpact` deduplicates by canonical test/file identity and ranks direct > affected-flow > transitive > candidate. Unknown is a coverage state, not a fake test.

A missing-test finding requires a defined minimum coverage gate configured centrally.

## 8. Stable flow identity

`flow-detection/identity.ts` owns `FLOW_IDENTITY_VERSION`, canonical normalization and fingerprints. Flow phase must stop using accumulating indices.

Persist flow metadata:
- entryPointCanonicalId;
- stepCanonicalIds;
- optional callSiteIds;
- flowFingerprint;
- algorithmVersion.

Flow ID must be content-derived and deterministic. A changed path creates a new fingerprint; graph diff correlates by stable entry point to classify path/membership change conservatively.

## 9. Migration/fingerprints

Bump a flow identity/schema producer fingerprint in generation metadata. Old flow identities trigger rebuild; no in-place DB mutation. Semantic snapshot fingerprints must include the flow identity version before flow diff is considered supported.

## 10. Mutation harness

Each fixture contains:
- source repo template;
- mutation operation;
- expected affected semantic IDs/flow IDs;
- expected irrelevant IDs;
- capability requirements.

The harness creates separate temporary Git commits and runs actual analysis paths, then scores precision/recall.

No hand-authored in-memory-only graph is sufficient for the release gate.

## 11. Performance

Cache per-function IR/CFG/dataflow/PDG under existing program-analysis cache identity plus source content fingerprint. Add request-level wall-clock/work counters. The production default cannot become unbounded because a diff touches a generated/minified file.

## 12. Failure semantics

- unsupported language -> graph fallback + boundary;
- source mapping failure -> graph fallback + boundary;
- stale/untrusted graph -> no interprocedural PDG projection;
- budget hit -> partial lower-bound result;
- stable-flow migration unavailable -> flow diff remains unsupported;
- test evidence incomplete -> unknown, not definitive missing.

## 13. Tests

Unit:
- source mapping;
- forward/backward slice;
- certainty projection;
- test evidence classification;
- flow identity determinism.

Integration:
- diff→IR→PDG→graph projection;
- exact vs ambiguous call;
- API route projection;
- flow/test projection;
- snapshot flow diff across refs.

Evaluation:
- real temporary repositories and mutations, graph vs PDG scoring.
