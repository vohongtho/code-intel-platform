import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectCommunities, addClustersToGraph } from '../../../src/clustering/community-detector.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { CodeNode } from '../../../src/shared/index.js';

function makeGraph(nodes: Partial<CodeNode>[]) {
  const graph = createKnowledgeGraph();
  for (const n of nodes) {
    graph.addNode(n as CodeNode);
  }
  return graph;
}

describe('detectCommunities', () => {
  it('returns empty array for fewer than 10 relevant nodes', () => {
    const graph = makeGraph([
      { id: 'n1', kind: 'function', name: 'fn1', filePath: '/src/a.ts' },
      { id: 'n2', kind: 'function', name: 'fn2', filePath: '/src/b.ts' },
    ]);
    const clusters = detectCommunities(graph);
    assert.equal(clusters.length, 0);
  });

  it('groups nodes by directory when >= 10 relevant nodes', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({
      id: `n${i}`,
      kind: 'function' as const,
      name: `fn${i}`,
      filePath: `/src/utils/fn${i}.ts`,
    }));
    const graph = makeGraph(nodes);
    const clusters = detectCommunities(graph);
    assert.ok(clusters.length > 0);
    assert.ok(clusters[0]!.memberIds.length >= 2);
  });

  it('ignores non-relevant node kinds (e.g. file)', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({
      id: `f${i}`,
      kind: 'file' as const,
      name: `file${i}`,
      filePath: `/src/file${i}.ts`,
    }));
    const graph = makeGraph(nodes);
    const clusters = detectCommunities(graph);
    assert.equal(clusters.length, 0);
  });

  it('skips directories with only one member', () => {
    const nodes: Partial<CodeNode>[] = [
      { id: 'a0', kind: 'function', name: 'a0', filePath: '/src/a/fn0.ts' },
      { id: 'a1', kind: 'function', name: 'a1', filePath: '/src/a/fn1.ts' },
      { id: 'a2', kind: 'function', name: 'a2', filePath: '/src/a/fn2.ts' },
      { id: 'b0', kind: 'class', name: 'b0', filePath: '/src/b/cl0.ts' },
      { id: 'b1', kind: 'method', name: 'b1', filePath: '/src/b/cl1.ts' },
      { id: 'b2', kind: 'interface', name: 'b2', filePath: '/src/b/if0.ts' },
      { id: 'b3', kind: 'struct', name: 'b3', filePath: '/src/b/st0.ts' },
      // only 1 in /src/c — should be skipped
      { id: 'c0', kind: 'function', name: 'c0', filePath: '/src/c/only.ts' },
      { id: 'd0', kind: 'function', name: 'd0', filePath: '/src/d/fn0.ts' },
      { id: 'd1', kind: 'function', name: 'd1', filePath: '/src/d/fn1.ts' },
    ];
    const graph = makeGraph(nodes);
    const clusters = detectCommunities(graph);
    for (const cluster of clusters) {
      assert.ok(cluster.memberIds.length >= 2);
    }
  });

  it('cluster label uses last path segment of directory', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`,
      kind: 'function' as const,
      name: `fn${i}`,
      filePath: `/src/mymodule/fn${i}.ts`,
    }));
    const graph = makeGraph(nodes);
    const clusters = detectCommunities(graph);
    assert.ok(clusters.length > 0);
    assert.equal(clusters[0]!.label, 'mymodule');
  });

  it('assigns unique clusterIds', () => {
    const nodes: Partial<CodeNode>[] = [
      ...Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, kind: 'function' as const, name: `a${i}`, filePath: `/src/mod1/f${i}.ts` })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, kind: 'class' as const, name: `b${i}`, filePath: `/src/mod2/c${i}.ts` })),
    ];
    const graph = makeGraph(nodes);
    const clusters = detectCommunities(graph);
    const ids = clusters.map((c) => c.clusterId);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length);
  });
});

describe('addClustersToGraph', () => {
  it('adds cluster nodes and belongs_to edges for each member', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`,
      kind: 'function' as const,
      name: `fn${i}`,
      filePath: `/src/mod/fn${i}.ts`,
    }));
    const graph = makeGraph(nodes);
    const clusters = detectCommunities(graph);
    assert.ok(clusters.length > 0);
    const before = graph.size;
    addClustersToGraph(graph, clusters);
    const after = graph.size;
    assert.ok(after.nodes > before.nodes);
    assert.ok(after.edges > before.edges);
  });

  it('does nothing for empty clusters array', () => {
    const graph = createKnowledgeGraph();
    const before = graph.size;
    addClustersToGraph(graph, []);
    const after = graph.size;
    assert.equal(after.nodes, before.nodes);
    assert.equal(after.edges, before.edges);
  });

  it('each cluster node has kind=cluster', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`,
      kind: 'function' as const,
      name: `fn${i}`,
      filePath: `/src/pkg/fn${i}.ts`,
    }));
    const graph = makeGraph(nodes);
    const clusters = detectCommunities(graph);
    addClustersToGraph(graph, clusters);
    for (const cluster of clusters) {
      const node = graph.getNode(cluster.clusterId);
      assert.ok(node !== undefined);
      assert.equal(node!.kind, 'cluster');
    }
  });
});
