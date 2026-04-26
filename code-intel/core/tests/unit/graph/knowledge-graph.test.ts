import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';

describe('KnowledgeGraph', () => {
  it('should add and retrieve nodes', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'n1', kind: 'function', name: 'foo', filePath: 'a.ts' });
    assert.equal(graph.size.nodes, 1);
    const node = graph.getNode('n1');
    assert.equal(node?.name, 'foo');
    assert.equal(node?.kind, 'function');
  });

  it('should add and retrieve edges', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'n1', kind: 'function', name: 'foo', filePath: 'a.ts' });
    graph.addNode({ id: 'n2', kind: 'function', name: 'bar', filePath: 'b.ts' });
    graph.addEdge({ id: 'e1', source: 'n1', target: 'n2', kind: 'calls', weight: 0.9 });

    assert.equal(graph.size.edges, 1);
    const edge = graph.getEdge('e1');
    assert.equal(edge?.kind, 'calls');
  });

  it('should find edges by kind', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'n1', kind: 'function', name: 'foo', filePath: 'a.ts' });
    graph.addNode({ id: 'n2', kind: 'function', name: 'bar', filePath: 'a.ts' });
    graph.addNode({ id: 'n3', kind: 'class', name: 'Baz', filePath: 'a.ts' });
    graph.addEdge({ id: 'e1', source: 'n1', target: 'n2', kind: 'calls' });
    graph.addEdge({ id: 'e2', source: 'n1', target: 'n3', kind: 'imports' });

    const callEdges = [...graph.findEdgesByKind('calls')];
    assert.equal(callEdges.length, 1);
    assert.equal(callEdges[0].id, 'e1');

    const importEdges = [...graph.findEdgesByKind('imports')];
    assert.equal(importEdges.length, 1);
  });

  it('should find edges from/to a node', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'n1', kind: 'function', name: 'foo', filePath: 'a.ts' });
    graph.addNode({ id: 'n2', kind: 'function', name: 'bar', filePath: 'a.ts' });
    graph.addEdge({ id: 'e1', source: 'n1', target: 'n2', kind: 'calls' });

    const from = [...graph.findEdgesFrom('n1')];
    assert.equal(from.length, 1);
    assert.equal(from[0].target, 'n2');

    const to = [...graph.findEdgesTo('n2')];
    assert.equal(to.length, 1);
    assert.equal(to[0].source, 'n1');
  });

  it('should remove node with cascade', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'n1', kind: 'function', name: 'foo', filePath: 'a.ts' });
    graph.addNode({ id: 'n2', kind: 'function', name: 'bar', filePath: 'a.ts' });
    graph.addEdge({ id: 'e1', source: 'n1', target: 'n2', kind: 'calls' });

    graph.removeNodeCascade('n1');
    assert.equal(graph.size.nodes, 1);
    assert.equal(graph.size.edges, 0);
    assert.equal(graph.getNode('n1'), undefined);
  });

  it('should clear all data', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'n1', kind: 'function', name: 'foo', filePath: 'a.ts' });
    graph.addEdge({ id: 'e1', source: 'n1', target: 'n1', kind: 'calls' });
    graph.clear();
    assert.equal(graph.size.nodes, 0);
    assert.equal(graph.size.edges, 0);
  });

  it('should iterate all nodes and edges', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'n1', kind: 'function', name: 'foo', filePath: 'a.ts' });
    graph.addNode({ id: 'n2', kind: 'class', name: 'Bar', filePath: 'b.ts' });
    graph.addEdge({ id: 'e1', source: 'n1', target: 'n2', kind: 'calls' });

    const nodes = [...graph.allNodes()];
    assert.equal(nodes.length, 2);

    const edges = [...graph.allEdges()];
    assert.equal(edges.length, 1);
  });
});
