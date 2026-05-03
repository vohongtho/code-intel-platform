import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { KnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { summarizeCluster } from '../../../src/query/cluster-summary.js';
import type { ClusterSummaryResult } from '../../../src/query/cluster-summary.js';

function buildTestGraph(): KnowledgeGraph {
  const graph = createKnowledgeGraph();

  // src/auth cluster
  graph.addNode({ id: 'authService', kind: 'class', name: 'AuthService', filePath: 'src/auth/service.ts' });
  graph.addNode({ id: 'authMiddleware', kind: 'function', name: 'authMiddleware', filePath: 'src/auth/middleware.ts' });
  graph.addNode({ id: 'loginFn', kind: 'function', name: 'login', filePath: 'src/auth/login.ts' });
  graph.addNode({ id: 'logoutFn', kind: 'function', name: 'logout', filePath: 'src/auth/logout.ts' });

  // src/db cluster (dependency of src/auth)
  graph.addNode({ id: 'dbClient', kind: 'class', name: 'DbClient', filePath: 'src/db/client.ts' });
  graph.addNode({ id: 'dbQuery', kind: 'function', name: 'query', filePath: 'src/db/query.ts' });

  // src/api cluster (dependent of src/auth)
  graph.addNode({ id: 'apiHandler', kind: 'function', name: 'handleRequest', filePath: 'src/api/handler.ts' });
  graph.addNode({ id: 'apiRouter', kind: 'class', name: 'Router', filePath: 'src/api/router.ts' });

  // AuthService is the most used (many callers)
  for (let i = 0; i < 5; i++) {
    graph.addNode({ id: `authCaller${i}`, kind: 'function', name: `authCaller${i}`, filePath: `src/services/svc${i}.ts` });
    graph.addEdge({ id: `eAuthCall${i}`, source: `authCaller${i}`, target: 'authService', kind: 'calls' });
  }

  // authMiddleware has 3 callers
  for (let i = 0; i < 3; i++) {
    graph.addNode({ id: `mwCaller${i}`, kind: 'function', name: `mwCaller${i}`, filePath: `src/routes/route${i}.ts` });
    graph.addEdge({ id: `eMwCall${i}`, source: `mwCaller${i}`, target: 'authMiddleware', kind: 'calls' });
  }

  // src/auth imports src/db
  graph.addEdge({ id: 'eAuthDb1', source: 'authService', target: 'dbClient', kind: 'imports' });
  graph.addEdge({ id: 'eAuthDb2', source: 'loginFn', target: 'dbQuery', kind: 'imports' });

  // src/api imports src/auth
  graph.addEdge({ id: 'eApiAuth1', source: 'apiHandler', target: 'authMiddleware', kind: 'imports' });
  graph.addEdge({ id: 'eApiAuth2', source: 'apiRouter', target: 'authService', kind: 'imports' });

  return graph;
}

describe('summarizeCluster', () => {
  const graph = buildTestGraph();

  it('returns error for unknown cluster', () => {
    const result = summarizeCluster(graph, 'src/nonexistent');
    assert.ok('error' in result, 'should return error for unknown cluster');
    const r = result as { error: string };
    assert.ok(r.error.includes('src/nonexistent'), `error should mention cluster name, got: ${r.error}`);
  });

  it('key symbols ranked by caller count', () => {
    const result = summarizeCluster(graph, 'src/auth');
    assert.ok(!('error' in result), 'should not return error');
    const r = result as ClusterSummaryResult;

    assert.ok(r.keySymbols.length > 0, 'should have key symbols');
    // AuthService has 5 callers (calls edges) + 1 imports edge from apiRouter = 6 total incoming edges
    assert.equal(r.keySymbols[0].name, 'AuthService', `AuthService should be first key symbol, got: ${r.keySymbols[0].name}`);
    assert.ok(r.keySymbols[0].callerCount >= 5, `AuthService should have at least 5 callers, got ${r.keySymbols[0].callerCount}`);

    // Results should be sorted descending
    for (let i = 1; i < r.keySymbols.length; i++) {
      assert.ok(
        r.keySymbols[i - 1].callerCount >= r.keySymbols[i].callerCount,
        `Key symbols should be sorted by callerCount desc at index ${i}`,
      );
    }
  });

  it('dependencies identify external clusters that auth imports from', () => {
    const result = summarizeCluster(graph, 'src/auth');
    assert.ok(!('error' in result));
    const r = result as ClusterSummaryResult;

    // src/auth imports from src/db
    assert.ok(
      r.dependencies.some((d) => d.includes('src/db') || d === 'src/db'),
      `dependencies should include src/db, got: ${JSON.stringify(r.dependencies)}`,
    );

    // src/auth does NOT import from src/api
    assert.ok(
      !r.dependencies.some((d) => d.includes('src/api')),
      `dependencies should not include src/api, got: ${JSON.stringify(r.dependencies)}`,
    );
  });

  it('dependents identify external clusters that import from auth', () => {
    const result = summarizeCluster(graph, 'src/auth');
    assert.ok(!('error' in result));
    const r = result as ClusterSummaryResult;

    // src/api imports from src/auth
    assert.ok(
      r.dependents.some((d) => d.includes('src/api') || d === 'src/api'),
      `dependents should include src/api, got: ${JSON.stringify(r.dependents)}`,
    );
  });

  it('symbol count by kind is correct', () => {
    const result = summarizeCluster(graph, 'src/auth');
    assert.ok(!('error' in result));
    const r = result as ClusterSummaryResult;

    // src/auth has: 1 class (AuthService), 3 functions (authMiddleware, login, logout)
    assert.equal(r.symbolCount['class'], 1, `should have 1 class, got ${r.symbolCount['class']}`);
    assert.equal(r.symbolCount['function'], 3, `should have 3 functions, got ${r.symbolCount['function']}`);
  });

  it('health score is present and valid', () => {
    const result = summarizeCluster(graph, 'src/auth');
    assert.ok(!('error' in result));
    const r = result as ClusterSummaryResult;

    assert.ok(r.health !== undefined, 'health should be present');
    assert.ok(typeof r.health.score === 'number', 'health.score should be a number');
    assert.ok(r.health.score >= 0 && r.health.score <= 100, `health.score should be 0-100, got ${r.health.score}`);
  });

  it('purpose derived from cluster name when no summary metadata', () => {
    const result = summarizeCluster(graph, 'src/auth');
    assert.ok(!('error' in result));
    const r = result as ClusterSummaryResult;

    assert.ok(typeof r.purpose === 'string', 'purpose should be a string');
    assert.ok(r.purpose.length > 0, 'purpose should not be empty');
  });

  it('purpose uses metadata summary when available', () => {
    const graph2 = createKnowledgeGraph();
    graph2.addNode({
      id: 'fn1',
      kind: 'function',
      name: 'doAuth',
      filePath: 'src/mymod/auth.ts',
      metadata: { summary: 'Handles OAuth 2.0 token flow' },
    });
    // Give it callers so it becomes the top node
    graph2.addNode({ id: 'caller', kind: 'function', name: 'caller', filePath: 'src/other/caller.ts' });
    graph2.addEdge({ id: 'ec', source: 'caller', target: 'fn1', kind: 'calls' });

    const result = summarizeCluster(graph2, 'src/mymod');
    assert.ok(!('error' in result));
    const r = result as ClusterSummaryResult;
    assert.equal(r.purpose, 'Handles OAuth 2.0 token flow', `purpose should use metadata summary, got: ${r.purpose}`);
  });

  it('key symbols limited to 5', () => {
    const graph2 = createKnowledgeGraph();
    for (let i = 0; i < 10; i++) {
      graph2.addNode({ id: `sym${i}`, kind: 'function', name: `sym${i}`, filePath: `src/big/sym${i}.ts` });
      // Give each different caller counts
      for (let j = 0; j < i; j++) {
        graph2.addNode({ id: `c${i}${j}`, kind: 'function', name: `c${i}${j}`, filePath: `src/callers/c${i}${j}.ts` });
        graph2.addEdge({ id: `ec${i}${j}`, source: `c${i}${j}`, target: `sym${i}`, kind: 'calls' });
      }
    }
    const result = summarizeCluster(graph2, 'src/big');
    assert.ok(!('error' in result));
    const r = result as ClusterSummaryResult;
    assert.ok(r.keySymbols.length <= 5, `key symbols should be limited to 5, got ${r.keySymbols.length}`);
  });
});
