# Design: Dependency-Aware Incremental Semantic Resolution

## Observed v1.0.10 behavior

The production planner uses a safety rule: a non-empty changed/deleted source set selects full graph/BM25 rebuild because dependency-closure re-resolution is unavailable. Generation V2 then publishes the replacement atomically.

That behavior is the reference fallback and must remain intact.

## Core invariant

For the same repository tree and compatible analyzer configuration:

```text
IncrementalAnalyze(history -> tree T)
          ≡
FullAnalyze(tree T)
```

Normalization compares canonical symbols, declaration fragments, materialized relationships, compact trust, required evidence receipts, BM25 membership, vector membership/update semantics, and affected derived summaries. Counts alone are insufficient.

## New modules

```text
code-intel/core/src/incremental/semantic-snapshot.ts
code-intel/core/src/incremental/semantic-delta.ts
code-intel/core/src/incremental/reverse-dependency-index.ts
code-intel/core/src/incremental/invalidation-closure.ts
code-intel/core/src/incremental/artifact-delta-plan.ts
```

Existing `pipeline/incremental.ts`, `pipeline/analysis-plan.ts`, Generation V2, and working-tree change detection remain owners of their current concerns.

## Semantic delta

```ts
interface SemanticDelta {
  changedFiles: readonly string[];
  deletedFiles: readonly string[];
  addedFacts: readonly string[];
  removedFacts: readonly string[];
  changedFacts: readonly string[];
  invalidatedReferences: readonly string[];
  invalidatedCallSites: readonly string[];
  invalidatedSymbols: readonly string[];
  affectedArtifacts: ReadonlySet<'graph' | 'bm25' | 'vector' | 'evidence' | 'flows' | 'clusters' | 'program-analysis'>;
  requiresFullResolution: boolean;
  reason?: string;
}
```

## Reverse dependencies

Track or reconstruct efficient reverse mappings for:

- import/public-surface consumers;
- type-reference consumers;
- inheritance/interface/protocol/trait consumers;
- call/reference sites by candidate name/qualified name/owner/type domain;
- callback/delegate/event registrations;
- DI/framework registrations;
- route/contract consumers;
- embedded HTML/template resource bindings where they affect semantics.

The index must not depend on stale simple-name uniqueness.

## Processing flow

```text
working-tree change set
  -> parse changed/new files into fact bundles
  -> diff against published semantic snapshot
  -> compute reverse dependency closure
  -> include affected unchanged call/reference sites
  -> re-run resolution for invalidated facts/sites
  -> compute artifact delta plan
  -> stage Generation V2 candidate
  -> semantic read-back/convergence checks
  -> publish
```

## Deleted/moved declarations

Removal must invalidate all prior consumers, including unchanged files. A move can appear as remove+add with identity/alias handling. Public-surface deletion invalidates importers transitively.

## Artifact coordination

One delta plan decides:

- graph inserts/deletes/updates;
- BM25 affected documents;
- vector membership/update set using existing embedding compatibility logic;
- evidence records;
- cluster/flow summaries whose input graph changed;
- future program-analysis cache invalidation.

Do not let each artifact independently guess changed scope.

## Fallback rules

Select full graph/BM25 (and compatible vector plan) automatically when:

- old generation lacks compatible semantic/reverse index;
- adapter emits repository-wide uncertainty;
- invalidation closure exceeds a configured breadth threshold;
- analyzer/fact/identity/resolver fingerprint changed;
- dependency graph is corrupt/unverified;
- convergence shadow check fails in release/diagnostic mode.

## Rollout

1. Keep production non-zero source changes on full rebuild.
2. Implement semantic delta and run candidate incremental in tests/shadow harness.
3. Compare exact normalized final semantics after short and long histories.
4. Enable internal incremental publication only when all 15 language rows satisfy convergence.
5. Keep full fallback permanently.

## Test histories

- add/remove competing declaration;
- rename/move declaration;
- direct import and re-export change;
- generic receiver/type change;
- interface implementation change;
- callback/event/DI registration change;
- body-only edit;
- staged/unstaged/untracked/deleted working-tree states;
- 50–100 sequential changes ending in a known final tree.

## Performance

Measure invalidated fact/site count, reverse-index lookup cost, staged bytes, and full-vs-incremental wall time. A body-only edit should not trigger repository-wide re-resolution absent semantic fact changes.

## Failure semantics

Any uncertainty about closure selects full rebuild. Failed staging/convergence never changes the active published generation.
