# Design: Branch-Aware Semantic Graph Diff

## Snapshot descriptor

```ts
interface SemanticSnapshotDescriptor {
  snapshotId: string;
  repositoryIdentity: string;
  gitTree: string;
  commit?: string;
  dirtyStateFingerprint?: string;
  parserFingerprint: string;
  factSchemaFingerprint: string;
  identityFingerprint: string;
  resolverFingerprint: string;
  graphSchemaFingerprint: string;
  contractFingerprint?: string;
  createdAt: string;
}
```

`snapshotId` is content/config-derived; `createdAt` is metadata and not part of semantic equality.

## Isolation

Snapshot analysis writes to staging/temp generation paths. It MUST NOT mutate the currently published Generation V2 pointer. Only normal `analyze` publication owns current generation.

## Git materialization

Prefer Git object/tree access or isolated temporary worktree/materialization APIs. Do not checkout refs into the user's working tree. Refs with spaces/metacharacters are passed as process arguments, never through shell interpolation.

## Normalized diff

```ts
interface SemanticGraphDiff {
  base: SemanticSnapshotDescriptor;
  head: SemanticSnapshotDescriptor;
  nodes: EntityDelta[];
  relationships: RelationshipDelta[];
  contracts?: ContractDelta[];
  flows?: FlowDelta[];
  coverage: AnalysisCoverage;
}
```

Normalization excludes volatile timestamps/storage row ordering. Stable sorting uses canonical IDs, relationship call-site identities, and semantic property keys.

## Rename/move handling

Canonical identity continuity plus declaration/content/move evidence may classify `moved`/`renamed`. A same display name is insufficient. When continuity is uncertain, report remove+add with optional candidate correlation.

## Relationship changes

Detect edge creation/removal, target change, call-site change, and trust/certainty change. Degradation from exact to ambiguous/unknown is a semantic change even if source/target display names appear unchanged.

## Existing impact integration

`pr_impact` may accept `analysisMode: 'current-graph' | 'semantic-snapshot'`. Default remains backward compatible until snapshot mode is proven and performance policy is established. Snapshot output enriches, not replaces, textual hunks.

## Cache

Cache snapshots by descriptor fingerprint under a bounded repository cache. Use LRU/age/size policy. A cache hit is valid only after metadata and required artifacts reopen successfully.

## Query scaling

Large node/edge ID sets must be parameterized/batched. Never generate graph-query syntax proportional to number of Git hunks or changed entities.

## Failure semantics

If either semantic snapshot is partial, graph diff coverage is partial. A failed base snapshot MUST NOT be replaced with the current graph while still labeling the result base/head exact.
