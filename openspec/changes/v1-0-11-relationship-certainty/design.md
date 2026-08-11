# Design: Relationship Evidence, Certainty, and Coverage

## Observed v1.0.10 storage

`storage/schema.ts::getCreateEdgeTableDDL()` defines only:

```text
kind STRING
weight DOUBLE
label STRING
```

The resolver writes same-file calls with weight `0.95` and global-name fallback with `0.5`, but graph consumers do not have a durable semantic contract explaining what those weights mean.

## New shared contracts

```ts
type RelationshipCertainty = 'exact' | 'candidate' | 'heuristic';
type AnalysisCertainty = 'exact' | 'lower-bound' | 'heuristic' | 'truncated' | 'unavailable';

interface RelationshipTrust {
  callSiteId?: string;
  confidence: number;
  certainty: RelationshipCertainty;
  strategy: string;
  resolverVersion: string;
  evidenceRef?: string;
  ambiguous: boolean;
}

interface AnalysisCoverage {
  complete: boolean;
  examinedCount: number;
  totalKnownCount?: number;
  incompleteReasons: readonly string[];
}

interface AnalysisBoundary {
  kind:
    | 'external-library'
    | 'dynamic-dispatch'
    | 'unresolved-receiver'
    | 'ambiguous-target'
    | 'analysis-limit'
    | 'stale-index'
    | 'unavailable-index'
    | 'legacy-resolver'
    | 'unsupported-semantics';
  evidenceRefs: readonly string[];
}
```

## Graph persistence

Extend `CodeEdge` additively and update LadybugDB relation properties with compact scalar fields. Suggested relation schema additions:

```text
call_site_id STRING
confidence DOUBLE
certainty STRING
strategy STRING
resolver_version STRING
evidence_ref STRING
ambiguous BOOLEAN
```

Verbose candidate chains/source ranges/boundaries belong in a side artifact, not repeated on every edge row.

## Evidence side store

Introduce a focused interface under `code-intel/core/src/evidence/`:

```ts
interface ResolutionEvidenceStore {
  put(record: ResolutionEvidenceRecord): void;
  get(id: string): ResolutionEvidenceRecord | null;
  getByReference(referenceId: string): ResolutionEvidenceRecord[];
}
```

A compact SQLite artifact is preferred once persistence is required because it supports keyed lookup and bounded querying. If first rollout uses a simpler file format, the interface must hide it and Generation compatibility must version it.

Evidence records include source range, strategy inputs, candidate IDs, rejected-candidate reasons when bounded, coverage, boundaries, and resolver version.

## Consumer policy

### Blast radius

Traversal classifies paths by weakest required relationship certainty. Result includes confirmed/probable/uncertain buckets or equivalent additive trust summary. Current count-based risk logic must not return `LOW` solely because affected count is small when coverage is incomplete.

### `find_paths` / execution flow

Path/flow certainty is bounded by the weakest edge and any truncated expansion.

### Context

Exact evidence ranks ahead of heuristic evidence. Boundaries and uncertainty summaries must survive token trimming.

### PR impact / suggested tests

Suggested tests derived only through uncertain edges are marked accordingly. A missing test recommendation is not proof of no affected tests when coverage is incomplete.

### Dead code/orphans

`no callers observed` is distinct from `proved unused`. Unsupported reference classes force unknown/incomplete status.

### Relationship explanation

Existing explanation/query paths read evidence by stable relationship/call-site identity and can expose strategy/coverage on demand.

## Exact-empty proof rule

An empty result can be `exact` only if:

- the index generation is semantically verified/current;
- relevant language capability rows are supported for the relationship classes in question;
- no unresolved receiver/dispatch/import/public-surface boundary exists;
- no candidate fan-out/traversal limit truncated analysis;
- no evidence artifact is unavailable/corrupt;
- no legacy heuristic-only resolver path was required.

Otherwise the verdict is lower-bound/unknown/unavailable.

## Backward compatibility

Do not remove `weight` immediately. During migration it can remain as a compatibility score derived from trust, but semantic consumers must use explicit trust fields. Public responses add optional `certainty`, `coverage`, and `boundaries` summaries.

## Alternatives considered

### Encode evidence in `label`

Rejected. Labels are unstructured, hard to version/query, and encourage agent text parsing.

### Store all verbose evidence in LadybugDB edges

Rejected because repeated JSON inflates the central graph and makes simple traversals heavier.

## Failure semantics

If evidence persistence fails for a relationship class declared required by the generation, publication must fail. Optional verbose evidence may degrade only when compact trust remains truthful and generation status reports the limitation.

## Test strategy

- exact vs heuristic edge persistence/reload;
- unresolved outcome persistence without fake edge;
- exact-empty proof positive/negative cases;
- interface fan-out truncation;
- stale/unavailable artifact boundary;
- consumer risk changes;
- old-client response compatibility;
- graph/evidence deterministic fingerprints.
