import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { IncrementalIndexer, removeAffectedNodesFromGraph } from '../../../src/pipeline/incremental-indexer.js';

function makeGraph() {
  return createKnowledgeGraph();
}

describe('IncrementalIndexer', () => {
  it('returns zero counts for empty changedFiles', async () => {
    const graph = makeGraph();
    const indexer = new IncrementalIndexer(graph, '/workspace', '/workspace/.code-intel/graph.db');
    const result = await indexer.patchGraph([]);
    assert.equal(result.filesProcessed, 0);
    assert.equal(result.nodesRemoved, 0);
    assert.equal(result.nodesAdded, 0);
    assert.equal(result.duration, 0);
  });

  it('removes stale nodes for a deleted file', async () => {
    const graph = makeGraph();
    graph.addNode({ id: 'fn1', kind: 'function', name: 'foo', filePath: 'src/a.ts' });
    graph.addNode({ id: 'fn2', kind: 'function', name: 'bar', filePath: 'src/b.ts' });
    const indexer = new IncrementalIndexer(graph, '/', '/__nonexistent__/graph.db');
    const result = await indexer.patchGraph(['/src/a.ts']);
    assert.equal(result.filesProcessed, 1);
    assert.equal(result.nodesRemoved, 1);
    assert.equal(graph.size.nodes, 1);
    assert.equal([...graph.allNodes()][0]?.id, 'fn2');
  });

  it('removes ALL nodes for a given file', async () => {
    const graph = makeGraph();
    graph.addNode({ id: 'n1', kind: 'function', name: 'a', filePath: 'src/x.ts' });
    graph.addNode({ id: 'n2', kind: 'class', name: 'B', filePath: 'src/x.ts' });
    graph.addNode({ id: 'n3', kind: 'function', name: 'c', filePath: 'src/y.ts' });
    const indexer = new IncrementalIndexer(graph, '/', '/__nonexistent__/graph.db');
    const result = await indexer.patchGraph(['/src/x.ts']);
    assert.equal(result.nodesRemoved, 2);
    assert.equal(graph.size.nodes, 1);
    assert.ok(graph.getNode('n3') !== undefined);
  });

  it('patchResult duration >= 0', async () => {
    const graph = makeGraph();
    const indexer = new IncrementalIndexer(graph, '/', '/__nonexistent__/graph.db');
    const result = await indexer.patchGraph(['/nonexistent-file.ts']);
    assert.ok(result.duration >= 0);
  });

  it('handles multiple changed files', async () => {
    const graph = makeGraph();
    graph.addNode({ id: 'a1', kind: 'function', name: 'a1', filePath: 'src/a.ts' });
    graph.addNode({ id: 'b1', kind: 'function', name: 'b1', filePath: 'src/b.ts' });
    graph.addNode({ id: 'c1', kind: 'function', name: 'c1', filePath: 'src/c.ts' });
    const indexer = new IncrementalIndexer(graph, '/', '/__nonexistent__/graph.db');
    const result = await indexer.patchGraph(['/src/a.ts', '/src/b.ts']);
    assert.equal(result.filesProcessed, 2);
    assert.equal(result.nodesRemoved, 2);
    assert.equal(graph.size.nodes, 1);
  });
});

describe('removeAffectedNodesFromGraph', () => {
  it('removes changed-file nodes and all cascade edges before the main pipeline', () => {
    const graph = makeGraph();
    graph.addNode({ id: 'a', name: 'a', kind: 'function', filePath: 'src/a.ts' });
    graph.addNode({ id: 'b', name: 'b', kind: 'function', filePath: 'src/b.ts' });
    graph.addEdge({ id: 'a-calls-b', source: 'a', target: 'b', kind: 'calls' });

    const removed = removeAffectedNodesFromGraph(graph, '/repo', ['/repo/src/a.ts']);

    assert.equal(removed, 1);
    assert.equal(graph.getNode('a'), undefined);
    assert.ok(graph.getNode('b'));
    assert.equal([...graph.allEdges()].length, 0);
  });

  it('removes nodes for deleted relative paths', () => {
    const graph = makeGraph();
    graph.addNode({ id: 'deleted', name: 'deleted', kind: 'function', filePath: 'src/deleted.ts' });
    graph.addNode({ id: 'kept', name: 'kept', kind: 'function', filePath: 'src/kept.ts' });

    const removed = removeAffectedNodesFromGraph(graph, '/repo', [], ['src/deleted.ts']);

    assert.equal(removed, 1);
    assert.equal(graph.getNode('deleted'), undefined);
    assert.ok(graph.getNode('kept'));
  });
});
