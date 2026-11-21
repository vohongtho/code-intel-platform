import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { diffEntities, diffEntitiesWithContinuity, diffFlows, diffRelationships } from '../../../src/snapshots/graph-diff.js';
import type { NormalizedEdge, NormalizedFlow, NormalizedGraph, NormalizedNode } from '../../../src/snapshots/normalizer.js';

function node(id: string, overrides: Partial<NormalizedNode['properties']> = {}, kind: NormalizedNode['kind'] = 'function'): NormalizedNode {
  return {
    id,
    kind,
    properties: {
      name: overrides.name ?? id,
      filePath: overrides.filePath ?? 'src/index.ts',
      startLine: overrides.startLine,
      endLine: overrides.endLine,
      exported: overrides.exported,
      contentFingerprint: overrides.contentFingerprint,
    },
  };
}

function edge(overrides: Partial<NormalizedEdge> & Pick<NormalizedEdge, 'source' | 'target'>): NormalizedEdge {
  const kind = overrides.kind ?? 'calls';
  const callSiteId = overrides.callSiteId;
  return {
    key: `${overrides.source}::${kind}::${overrides.target}::${callSiteId ?? ''}`,
    source: overrides.source,
    target: overrides.target,
    kind,
    callSiteId,
    certainty: overrides.certainty,
    strategy: overrides.strategy,
    evidenceRef: overrides.evidenceRef,
    confidence: overrides.confidence,
    ambiguous: overrides.ambiguous,
  };
}

function graph(nodes: NormalizedNode[], edges: NormalizedEdge[] = [], flows: NormalizedFlow[] = []): NormalizedGraph {
  return {
    nodesById: new Map(nodes.map((n) => [n.id, n])),
    edgesByKey: new Map(edges.map((e) => [e.key, e])),
    flowsById: new Map(flows.map((flow) => [flow.flowId, flow])),
  };
}

function flow(flowId: string, entryPointId: string, steps: string[], callSiteIds: string[] = []): NormalizedFlow {
  return { flowId, entryPointId, stepCanonicalIds: steps, callSiteIds };
}

describe('graph-diff: entities', () => {
  it('reports a node present only in head as added', () => {
    const base = graph([]);
    const head = graph([node('sym:a')]);
    const deltas = diffEntities(base, head);
    assert.deepEqual(deltas.map((d) => d.kind), ['added']);
    assert.equal(deltas[0]!.headId, 'sym:a');
  });

  it('reports a node present only in base as removed', () => {
    const base = graph([node('sym:a')]);
    const head = graph([]);
    const deltas = diffEntities(base, head);
    assert.deepEqual(deltas.map((d) => d.kind), ['removed']);
    assert.equal(deltas[0]!.baseId, 'sym:a');
  });

  it('reports a node whose properties differ as changed, listing which properties changed', () => {
    const base = graph([node('sym:a', { startLine: 1, endLine: 3, contentFingerprint: 'fp1' })]);
    const head = graph([node('sym:a', { startLine: 5, endLine: 8, contentFingerprint: 'fp2' })]);
    const deltas = diffEntities(base, head);
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0]!.kind, 'changed');
    assert.deepEqual([...deltas[0]!.changedProperties!].sort(), ['contentFingerprint', 'endLine', 'startLine']);
  });

  it('reports nothing for an identical node on both sides', () => {
    const n = node('sym:a', { contentFingerprint: 'fp1' });
    const deltas = diffEntities(graph([n]), graph([n]));
    assert.deepEqual(deltas, []);
  });
});

describe('graph-diff: relationships', () => {
  it('keys by (source, kind, target, callSiteId) — never by display name', () => {
    const base = graph([], [edge({ source: 'sym:a', target: 'sym:b', callSiteId: 'cs:1' })]);
    const head = graph([], [edge({ source: 'sym:a', target: 'sym:b', callSiteId: 'cs:1' })]);
    assert.deepEqual(diffRelationships(base, head), []);
  });

  it('preserves multiple call sites between the same source/target/kind as distinct entries', () => {
    const base = graph([], [
      edge({ source: 'sym:a', target: 'sym:b', callSiteId: 'cs:1' }),
      edge({ source: 'sym:a', target: 'sym:b', callSiteId: 'cs:2' }),
    ]);
    const head = graph([], [
      edge({ source: 'sym:a', target: 'sym:b', callSiteId: 'cs:1' }),
    ]);
    const deltas = diffRelationships(base, head);
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0]!.kind, 'removed');
    assert.equal(deltas[0]!.callSiteId, 'cs:2');
  });

  it('reports a certainty degradation as changed even when source/target are identical', () => {
    const base = graph([], [edge({ source: 'sym:a', target: 'sym:b', certainty: 'exact', strategy: 'static-dispatch' })]);
    const head = graph([], [edge({ source: 'sym:a', target: 'sym:b', certainty: 'heuristic', strategy: 'name-heuristic' })]);
    const deltas = diffRelationships(base, head);
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0]!.kind, 'changed');
    assert.ok(deltas[0]!.changedFields!.includes('certainty'));
    assert.ok(deltas[0]!.changedFields!.includes('strategy'));
    assert.equal(deltas[0]!.base?.certainty, 'exact');
    assert.equal(deltas[0]!.head?.certainty, 'heuristic');
  });
});

describe('graph-diff: flow/cluster exclusion', () => {
  it('diffEntitiesWithContinuity never receives flow/cluster nodes to begin with (normalizer filters them)', () => {
    // graph-diff itself has no kind-based filtering — normalizer.ts owns that
    // exclusion. This test documents the contract: if a caller hands
    // diffEntitiesWithContinuity a 'flow' or 'cluster' node anyway (e.g. by
    // constructing a NormalizedGraph directly, bypassing normalizeGraphForDiff),
    // it is diffed like any other node kind. The safety property lives in
    // normalizer.ts, verified separately.
    const base = graph([]);
    const head = graph([node('flow:x', {}, 'flow')]);
    const deltas = diffEntitiesWithContinuity(base, head);
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0]!.nodeKind, 'flow');
  });
});

describe('graph-diff: stable flows', () => {
  it('returns no delta for an unchanged stable flow', () => {
    const same = flow('flow:entry:aaa', 'entry', ['entry', 'service', 'store']);
    assert.deepEqual(diffFlows(graph([], [], [same]), graph([], [], [same])), []);
  });

  it('reports added and removed flows when stable entry points do not correlate', () => {
    const base = graph([], [], [flow('flow:old:aaa', 'old', ['old', 'service', 'store'])]);
    const head = graph([], [], [flow('flow:new:bbb', 'new', ['new', 'service', 'store'])]);

    assert.deepEqual(diffFlows(base, head).map((delta) => delta.kind), ['added', 'removed']);
  });

  it('reports path-changed when one stable entry keeps membership but changes order', () => {
    const base = graph([], [], [flow('flow:entry:aaa', 'entry', ['entry', 'a', 'b'])]);
    const head = graph([], [], [flow('flow:entry:bbb', 'entry', ['entry', 'b', 'a'])]);

    assert.deepEqual(diffFlows(base, head).map((delta) => delta.kind), ['path-changed']);
  });

  it('reports membership-changed when one stable entry gains or loses a step', () => {
    const base = graph([], [], [flow('flow:entry:aaa', 'entry', ['entry', 'a', 'b'])]);
    const head = graph([], [], [flow('flow:entry:bbb', 'entry', ['entry', 'a', 'c'])]);

    assert.deepEqual(diffFlows(base, head).map((delta) => delta.kind), ['membership-changed']);
  });

  it('does not force-pair split or ambiguous flows sharing an entry point', () => {
    const base = graph([], [], [flow('flow:entry:aaa', 'entry', ['entry', 'a', 'end'])]);
    const head = graph([], [], [
      flow('flow:entry:bbb', 'entry', ['entry', 'b', 'end']),
      flow('flow:entry:ccc', 'entry', ['entry', 'c', 'end']),
    ]);

    assert.deepEqual(diffFlows(base, head).map((delta) => delta.kind), ['added', 'added', 'removed']);
  });
});
