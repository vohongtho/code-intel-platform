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

  it('ranks portal login intent above incidental token matches', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'page', kind: 'file', name: 'LoginPage', filePath: 'web/pages/LoginPage.tsx', content: 'portal authentication login page' });
    graph.addNode({ id: 'api', kind: 'method', name: 'login', filePath: 'web/api/client.ts', content: 'login to portal' });
    graph.addNode({ id: 'noise', kind: 'variable', name: 'token', filePath: 'core/query.ts', content: 'how to process login token' });

    const results = textSearch(graph, 'how to login portal');
    assert.deepEqual(new Set(results.slice(0, 2).map((result) => result.nodeId)), new Set(['api', 'page']));
  });

  it('returns deterministic ordering and cached copies', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'b', kind: 'function', name: 'login', filePath: 'b.ts' });
    graph.addNode({ id: 'a', kind: 'function', name: 'login', filePath: 'a.ts' });

    const first = textSearch(graph, 'login');
    first[0].name = 'mutated';
    const second = textSearch(graph, 'login');
    assert.deepEqual(second.map((result) => result.nodeId), ['a', 'b']);
    assert.equal(second[0].name, 'login');
  });

  it('invalidates cached results when graph generation shape changes', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'first', kind: 'function', name: 'loginHelper', filePath: 'a.ts' });
    assert.deepEqual(textSearch(graph, 'login').map((result) => result.nodeId), ['first']);

    graph.addNode({ id: 'exact', kind: 'function', name: 'login', filePath: 'b.ts' });
    assert.equal(textSearch(graph, 'login')[0].nodeId, 'exact');
  });

  it('should respect limit', () => {
    const graph = createKnowledgeGraph();
    for (let i = 0; i < 50; i++) {
      graph.addNode({ id: `n${i}`, kind: 'function', name: `func${i}`, filePath: `src/func${i}.ts` });
    }
    const results = textSearch(graph, 'func', 5);
    assert.equal(results.length, 5);
  });

  it('excludes test symbols across common language conventions', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'src-ts', kind: 'function', name: 'login', filePath: 'src/auth.ts' });
    graph.addNode({ id: 'test-ts', kind: 'function', name: 'login', filePath: 'tests/auth.test.ts' });
    graph.addNode({ id: 'test-py', kind: 'function', name: 'login', filePath: 'python/test_auth.py' });
    graph.addNode({ id: 'test-rs', kind: 'function', name: 'login', filePath: 'rust/login_spec.rs' });

    const results = textSearch(graph, 'login');
    assert.deepEqual(results.map((result) => result.nodeId), ['src-ts']);
  });

  it('excludes fixture, eval, and generated symbols from default results', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'main', kind: 'function', name: 'searchIndex', filePath: 'src/search/index.ts' });
    graph.addNode({ id: 'fixture', kind: 'function', name: 'searchIndex', filePath: 'fixtures/search/index.ts' });
    graph.addNode({ id: 'eval', kind: 'function', name: 'searchIndex', filePath: 'eval/search-index.ts' });
    graph.addNode({ id: 'generated', kind: 'function', name: 'searchIndex', filePath: 'dist/search/index.d.ts' });

    const results = textSearch(graph, 'searchIndex');
    assert.deepEqual(results.map((result) => result.nodeId), ['main']);
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
