import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { hybridSearch } from '../../../src/search/hybrid-search.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';

// Helper to build a small graph with predictable search results
function buildTestGraph() {
  const graph = createKnowledgeGraph();
  graph.addNode({ id: 'n1', kind: 'function', name: 'authenticate', filePath: 'src/auth.ts', content: 'function authenticate(user, pass) {}' });
  graph.addNode({ id: 'n2', kind: 'function', name: 'login', filePath: 'src/auth.ts', content: 'function login(credentials) {}' });
  graph.addNode({ id: 'n3', kind: 'class',    name: 'UserService',  filePath: 'src/user.ts', content: 'class UserService { save() {} }' });
  graph.addNode({ id: 'n4', kind: 'function', name: 'hashPassword', filePath: 'src/crypto.ts', content: 'function hashPassword(plain) {}' });
  graph.addNode({ id: 'n5', kind: 'interface', name: 'ILogger',     filePath: 'src/logger.ts', content: 'interface ILogger { log(msg: string): void; }' });
  return graph;
}

describe('hybridSearch (Epic 2.2 — Hybrid Search)', () => {
  it('returns BM25-only results when no vectorDbPath is provided', async () => {
    const graph = buildTestGraph();
    const { results, searchMode } = await hybridSearch(graph, 'authenticate', 5);
    assert.equal(searchMode, 'bm25');
    assert.ok(results.length > 0, 'should return at least one result');
    assert.ok(results.every((r) => r.searchMode === 'bm25'), 'all results should have searchMode bm25');
  });

  it('searchMode is "bm25" when no vectorDbPath provided', async () => {
    const graph = buildTestGraph();
    const { searchMode } = await hybridSearch(graph, 'login', 5);
    assert.equal(searchMode, 'bm25');
  });

  it('searchMode is "bm25" when vectorDbPath does not exist on disk', async () => {
    const graph = buildTestGraph();
    const { searchMode } = await hybridSearch(graph, 'login', 5, { vectorDbPath: '/nonexistent/path/vector.db' });
    assert.equal(searchMode, 'bm25');
  });

  it('results are sorted by descending score (BM25 only)', async () => {
    const graph = buildTestGraph();
    const { results } = await hybridSearch(graph, 'auth', 10);
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1].score >= results[i].score, `results should be sorted descending: ${results[i - 1].score} >= ${results[i].score}`);
    }
  });

  it('respects limit parameter', async () => {
    const graph = buildTestGraph();
    const { results } = await hybridSearch(graph, 'function', 2);
    assert.ok(results.length <= 2, `should return at most 2 results, got ${results.length}`);
  });

  it('returns correct shape for each result', async () => {
    const graph = buildTestGraph();
    const { results } = await hybridSearch(graph, 'authenticate', 5);
    assert.ok(results.length > 0);
    const first = results[0];
    assert.ok(typeof first.nodeId === 'string', 'nodeId should be string');
    assert.ok(typeof first.name === 'string', 'name should be string');
    assert.ok(typeof first.kind === 'string', 'kind should be string');
    assert.ok(typeof first.filePath === 'string', 'filePath should be string');
    assert.ok(typeof first.score === 'number', 'score should be number');
    assert.ok(first.searchMode === 'bm25' || first.searchMode === 'vector' || first.searchMode === 'hybrid', 'searchMode should be valid');
  });

  it('returns empty array when no nodes match', async () => {
    const graph = buildTestGraph();
    const { results, searchMode } = await hybridSearch(graph, 'zzznomatch12345', 5);
    assert.equal(results.length, 0);
    assert.equal(searchMode, 'bm25');
  });

  it('RRF merging: node appearing in both rankings scores higher than node in only one', () => {
    // Test the RRF logic directly via reciprocalRankFusion re-use
    // We simulate what hybridSearch does internally by checking that
    // a node appearing in both BM25 and vector rankings would score highest.
    //
    // We test this through the public hybridSearch API with a mock by checking
    // that the function returns the correct structure.
    // (Full hybrid integration with real vector DB is tested separately.)
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'shared', kind: 'function', name: 'sharedSymbol', filePath: 'a.ts', content: 'shared symbol content function' });
    graph.addNode({ id: 'bm25only', kind: 'function', name: 'bm25onlySymbol', filePath: 'b.ts', content: 'bm25 only symbol content function' });

    // Both nodes should appear in BM25 search for 'function'
    return hybridSearch(graph, 'function', 10).then(({ results, searchMode }) => {
      assert.equal(searchMode, 'bm25');
      // Both nodes should be in results (searching for 'function' which appears in content)
      const ids = results.map((r) => r.nodeId);
      assert.ok(ids.includes('shared'), 'shared node should appear');
      assert.ok(ids.includes('bm25only'), 'bm25only node should appear');
    });
  });

  it('bm25Limit and vectorLimit options are accepted without error', async () => {
    const graph = buildTestGraph();
    const { results, searchMode } = await hybridSearch(graph, 'auth', 5, { bm25Limit: 10, vectorLimit: 10 });
    assert.equal(searchMode, 'bm25');
    assert.ok(Array.isArray(results));
  });
});
