import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { IncrementalIndexer } from '../../../src/pipeline/incremental-indexer.js';

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeGraph() {
  const graph = createKnowledgeGraph();
  return graph;
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
    assert.equal(graph.size.nodes, 2);

    // Point to a non-existent dbPath so DB ops are skipped gracefully
    const indexer = new IncrementalIndexer(graph, '/', '/__nonexistent__/graph.db');
    // Use absolute path that maps to the relative filePath
    const result = await indexer.patchGraph(['/src/a.ts']);

    // fn1 should be removed (filePath matches), fn2 should remain
    assert.equal(result.filesProcessed, 1);
    assert.equal(result.nodesRemoved, 1);
    assert.equal(graph.size.nodes, 1);
    const remaining = [...graph.allNodes()];
    assert.equal(remaining[0]?.id, 'fn2');
  });

  it('removes ALL nodes for a given file', async () => {
    const graph = makeGraph();
    graph.addNode({ id: 'n1', kind: 'function', name: 'a', filePath: 'src/x.ts' });
    graph.addNode({ id: 'n2', kind: 'class',    name: 'B', filePath: 'src/x.ts' });
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
    assert.equal(graph.size.nodes, 1); // only c1 remains
  });
});
