import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { textSearch, reciprocalRankFusion } from '../../../src/search/text-search.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';

describe('Text Search', () => {
  it('should find nodes by name', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'n1', kind: 'function', name: 'authenticate', filePath: 'auth.ts' });
    graph.addNode({ id: 'n2', kind: 'function', name: 'validate', filePath: 'auth.ts' });
    graph.addNode({ id: 'n3', kind: 'class', name: 'UserService', filePath: 'user.ts' });

    const results = textSearch(graph, 'auth');
    assert.ok(results.length >= 1);
    assert.equal(results[0].name, 'authenticate');
  });

  it('should rank exact matches higher', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'n1', kind: 'function', name: 'login', filePath: 'a.ts' });
    graph.addNode({ id: 'n2', kind: 'function', name: 'loginHelper', filePath: 'b.ts' });

    const results = textSearch(graph, 'login');
    assert.equal(results[0].name, 'login');
  });

  it('should respect limit', () => {
    const graph = createKnowledgeGraph();
    for (let i = 0; i < 50; i++) {
      graph.addNode({ id: `n${i}`, kind: 'function', name: `func${i}`, filePath: 'a.ts' });
    }
    const results = textSearch(graph, 'func', 5);
    assert.equal(results.length, 5);
  });
});

describe('Reciprocal Rank Fusion', () => {
  it('should merge rankings', () => {
    const r1 = [
      { nodeId: 'a', name: 'a', kind: 'function', filePath: 'a.ts', score: 10 },
      { nodeId: 'b', name: 'b', kind: 'function', filePath: 'b.ts', score: 5 },
    ];
    const r2 = [
      { nodeId: 'b', name: 'b', kind: 'function', filePath: 'b.ts', score: 10 },
      { nodeId: 'c', name: 'c', kind: 'function', filePath: 'c.ts', score: 5 },
    ];
    const merged = reciprocalRankFusion(r1, r2);
    // b appears in both rankings, should rank highest
    assert.equal(merged[0].nodeId, 'b');
  });
});
