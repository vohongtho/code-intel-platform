import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { textSearch, reciprocalRankFusion } from '../../../src/search/text-search.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';

describe('textSearch', () => {
  it('returns empty array for empty graph', () => {
    const graph = createKnowledgeGraph();
    const results = textSearch(graph, 'anything');
    assert.equal(results.length, 0);
  });

  it('returns empty array when no matches', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'n1', kind: 'function', name: 'doWork', filePath: '/src/a.ts' });
    const results = textSearch(graph, 'xyznotfound');
    assert.equal(results.length, 0);
  });

  it('finds exact name match', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'n1', kind: 'function', name: 'authenticate', filePath: '/src/auth.ts' });
    const results = textSearch(graph, 'authenticate');
    assert.equal(results.length, 1);
    assert.equal(results[0]!.nodeId, 'n1');
  });

  it('exact match scores higher than partial match', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'exact', kind: 'function', name: 'auth', filePath: '/src/a.ts' });
    graph.addNode({ id: 'partial', kind: 'function', name: 'authenticate', filePath: '/src/b.ts' });
    const results = textSearch(graph, 'auth');
    assert.ok(results.length >= 2);
    assert.equal(results[0]!.nodeId, 'exact');
  });

  it('prefix match scores higher than contains match', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'prefix', kind: 'function', name: 'authHelper', filePath: '/src/a.ts' });
    graph.addNode({ id: 'contains', kind: 'function', name: 'runAuth', filePath: '/src/b.ts' });
    const results = textSearch(graph, 'auth');
    assert.ok(results.length >= 2);
    const prefixScore = results.find((r) => r.nodeId === 'prefix')!.score;
    const containsScore = results.find((r) => r.nodeId === 'contains')!.score;
    assert.ok(prefixScore > containsScore);
  });

  it('skips directory, cluster, flow nodes', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'd1', kind: 'directory', name: 'auth', filePath: '/src/auth' });
    graph.addNode({ id: 'cl1', kind: 'cluster', name: 'auth', filePath: '' });
    graph.addNode({ id: 'fl1', kind: 'flow', name: 'auth', filePath: '' });
    const results = textSearch(graph, 'auth');
    assert.equal(results.length, 0);
  });

  it('deprioritizes test path files', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'src', kind: 'function', name: 'login', filePath: '/src/auth.ts' });
    graph.addNode({ id: 'test', kind: 'function', name: 'login', filePath: '/src/auth.test.ts' });
    const results = textSearch(graph, 'login');
    const srcResult = results.find((r) => r.nodeId === 'src')!;
    const testResult = results.find((r) => r.nodeId === 'test')!;
    assert.ok(srcResult.score > testResult.score);
  });

  it('deprioritizes dist path files', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'src', kind: 'function', name: 'login', filePath: '/src/auth.ts' });
    graph.addNode({ id: 'dist', kind: 'function', name: 'login', filePath: '/dist/auth.js' });
    const results = textSearch(graph, 'login');
    const srcResult = results.find((r) => r.nodeId === 'src')!;
    const distResult = results.find((r) => r.nodeId === 'dist')!;
    assert.ok(srcResult.score > distResult.score);
  });

  it('boosts function/class/interface/method kinds', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn', kind: 'function', name: 'auth', filePath: '/src/a.ts' });
    graph.addNode({ id: 'var', kind: 'variable', name: 'auth', filePath: '/src/a.ts' });
    const results = textSearch(graph, 'auth');
    const fnResult = results.find((r) => r.nodeId === 'fn')!;
    const varResult = results.find((r) => r.nodeId === 'var')!;
    assert.ok(fnResult.score > varResult.score);
  });

  it('matches path in query term', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'n1', kind: 'function', name: 'doWork', filePath: '/src/auth/login.ts' });
    const results = textSearch(graph, 'auth');
    assert.ok(results.length > 0);
    assert.equal(results[0]!.nodeId, 'n1');
  });

  it('respects limit parameter', () => {
    const graph = createKnowledgeGraph();
    for (let i = 0; i < 10; i++) {
      graph.addNode({ id: `fn${i}`, kind: 'function', name: `doWork${i}`, filePath: '/src/a.ts' });
    }
    const results = textSearch(graph, 'doWork', 3);
    assert.ok(results.length <= 3);
  });

  it('result has required fields', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn1', kind: 'function', name: 'myFunc', filePath: '/src/foo.ts' });
    const results = textSearch(graph, 'myFunc');
    const r = results[0]!;
    assert.ok(r.nodeId !== undefined);
    assert.ok(r.name !== undefined);
    assert.ok(r.kind !== undefined);
    assert.ok(r.filePath !== undefined);
    assert.ok(r.score > 0);
  });

  it('includes snippet from content when available', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn1', kind: 'function', name: 'myFunc', filePath: '/src/foo.ts', content: 'function myFunc() { return 42; }' });
    const results = textSearch(graph, 'myFunc');
    assert.ok(results[0]!.snippet !== undefined);
    assert.ok(results[0]!.snippet!.includes('42'));
  });

  it('multi-term query matches all terms', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'n1', kind: 'function', name: 'parseUser', filePath: '/src/user.ts' });
    graph.addNode({ id: 'n2', kind: 'function', name: 'parse', filePath: '/src/a.ts' });
    const results = textSearch(graph, 'parse user');
    const n1 = results.find((r) => r.nodeId === 'n1');
    const n2 = results.find((r) => r.nodeId === 'n2');
    assert.ok(n1 !== undefined);
    // n1 matches both terms (name contains 'parse', path contains 'user')
    assert.ok(n1!.score > (n2?.score ?? 0));
  });

  it('returns results sorted by score descending', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'exact', kind: 'function', name: 'login', filePath: '/src/auth.ts' });
    graph.addNode({ id: 'partial', kind: 'function', name: 'loginHelper', filePath: '/src/b.ts' });
    graph.addNode({ id: 'path', kind: 'function', name: 'doWork', filePath: '/src/login/a.ts' });
    const results = textSearch(graph, 'login');
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1]!.score >= results[i]!.score);
    }
  });
});

describe('reciprocalRankFusion', () => {
  it('returns empty array for no rankings', () => {
    const results = reciprocalRankFusion();
    assert.equal(results.length, 0);
  });

  it('returns same items for single ranking', () => {
    const ranking = [
      { nodeId: 'a', name: 'a', kind: 'function', filePath: '/src/a.ts', score: 10 },
      { nodeId: 'b', name: 'b', kind: 'function', filePath: '/src/b.ts', score: 5 },
    ];
    const results = reciprocalRankFusion(ranking);
    assert.equal(results.length, 2);
    assert.ok(results.some((r) => r.nodeId === 'a'));
    assert.ok(results.some((r) => r.nodeId === 'b'));
  });

  it('merges two rankings and boosts items appearing in both', () => {
    const rankA = [
      { nodeId: 'shared', name: 'shared', kind: 'function', filePath: '/src/a.ts', score: 10 },
      { nodeId: 'only-a', name: 'onlyA', kind: 'function', filePath: '/src/a.ts', score: 5 },
    ];
    const rankB = [
      { nodeId: 'shared', name: 'shared', kind: 'function', filePath: '/src/a.ts', score: 9 },
      { nodeId: 'only-b', name: 'onlyB', kind: 'function', filePath: '/src/b.ts', score: 4 },
    ];
    const results = reciprocalRankFusion(rankA, rankB);
    const sharedEntry = results.find((r) => r.nodeId === 'shared');
    const onlyA = results.find((r) => r.nodeId === 'only-a');
    const onlyB = results.find((r) => r.nodeId === 'only-b');
    assert.ok(sharedEntry !== undefined);
    assert.ok(onlyA !== undefined);
    assert.ok(onlyB !== undefined);
    // shared appears in both → highest RRF score
    assert.ok(sharedEntry!.score > onlyA!.score);
    assert.ok(sharedEntry!.score > onlyB!.score);
  });

  it('results are sorted by score descending', () => {
    const rankA = [
      { nodeId: 'x', name: 'x', kind: 'function', filePath: '/src/x.ts', score: 10 },
      { nodeId: 'y', name: 'y', kind: 'function', filePath: '/src/y.ts', score: 5 },
    ];
    const results = reciprocalRankFusion(rankA);
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1]!.score >= results[i]!.score);
    }
  });

  it('deduplicate — same nodeId from multiple rankings counted once per ranking', () => {
    const r1 = [{ nodeId: 'dup', name: 'dup', kind: 'function', filePath: '/a.ts', score: 10 }];
    const r2 = [{ nodeId: 'dup', name: 'dup', kind: 'function', filePath: '/a.ts', score: 9 }];
    const results = reciprocalRankFusion(r1, r2);
    const dupResults = results.filter((r) => r.nodeId === 'dup');
    assert.equal(dupResults.length, 1);
  });
});
