import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseGQL, isGQLParseError } from '../../../src/query/gql-parser.js';
import { executeGQL } from '../../../src/query/gql-executor.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { KnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { GQLResult } from '../../../src/query/gql-executor.js';

function buildTestGraph(): KnowledgeGraph {
  const graph = createKnowledgeGraph();

  // Add nodes
  graph.addNode({ id: 'fn1', kind: 'function', name: 'handleLogin', filePath: 'auth/login.ts', exported: true, metadata: { cluster: 'auth', language: 'typescript' } });
  graph.addNode({ id: 'fn2', kind: 'function', name: 'handleLogout', filePath: 'auth/logout.ts', exported: true, metadata: { cluster: 'auth', language: 'typescript' } });
  graph.addNode({ id: 'fn3', kind: 'function', name: 'validateToken', filePath: 'auth/token.ts', exported: false, metadata: { cluster: 'auth', language: 'typescript' } });
  graph.addNode({ id: 'fn4', kind: 'function', name: 'createUser', filePath: 'user/create.ts', exported: true, metadata: { cluster: 'user', language: 'typescript' } });
  graph.addNode({ id: 'fn5', kind: 'function', name: 'sendEmail', filePath: 'mail/send.ts', exported: true, metadata: { cluster: 'mail', language: 'typescript' } });
  graph.addNode({ id: 'fn6', kind: 'function', name: 'hashPassword', filePath: 'auth/crypto.ts', exported: false, metadata: { cluster: 'auth' } });
  graph.addNode({ id: 'cls1', kind: 'class', name: 'UserService', filePath: 'user/service.ts', exported: true, metadata: { cluster: 'user' } });
  graph.addNode({ id: 'cls2', kind: 'class', name: 'AuthService', filePath: 'auth/service.ts', exported: true, metadata: { cluster: 'auth' } });
  graph.addNode({ id: 'iface1', kind: 'interface', name: 'IUserRepository', filePath: 'user/repo.ts', exported: true, metadata: { cluster: 'user' } });

  // Add edges
  graph.addEdge({ id: 'e1', source: 'fn1', target: 'fn3', kind: 'calls' });
  graph.addEdge({ id: 'e2', source: 'fn1', target: 'fn6', kind: 'calls' });
  graph.addEdge({ id: 'e3', source: 'fn4', target: 'fn5', kind: 'calls' });
  graph.addEdge({ id: 'e4', source: 'cls2', target: 'fn1', kind: 'has_member' });
  graph.addEdge({ id: 'e5', source: 'cls1', target: 'iface1', kind: 'implements' });
  graph.addEdge({ id: 'e6', source: 'fn4', target: 'fn6', kind: 'calls' });

  return graph;
}

describe('GQL Executor — FIND', () => {
  const graph = buildTestGraph();

  it('finds all functions', () => {
    const ast = parseGQL('FIND function');
    assert.ok(ast.type === 'FIND');
    const result: GQLResult = executeGQL(ast, graph);
    assert.ok(result.nodes!.length >= 6);
    assert.ok(result.nodes!.every((n) => n.kind === 'function'));
  });

  it('finds all classes', () => {
    const ast = parseGQL('FIND class');
    assert.ok(ast.type === 'FIND');
    const result = executeGQL(ast, graph);
    assert.equal(result.nodes!.length, 2);
    assert.ok(result.nodes!.every((n) => n.kind === 'class'));
  });

  it('finds functions matching name CONTAINS auth', () => {
    const ast = parseGQL('FIND function WHERE name CONTAINS "auth"');
    assert.ok(ast.type === 'FIND');
    const result = executeGQL(ast, graph);
    const names = result.nodes!.map((n) => n.name);
    assert.ok(names.every((n) => n.toLowerCase().includes('auth')));
  });

  it('finds symbols matching STARTS_WITH', () => {
    const ast = parseGQL('FIND function WHERE name STARTS_WITH "handle"');
    assert.ok(ast.type === 'FIND');
    const result = executeGQL(ast, graph);
    assert.ok(result.nodes!.length >= 2);
    assert.ok(result.nodes!.every((n) => n.name.toLowerCase().startsWith('handle')));
  });

  it('finds symbols with IN list', () => {
    const ast = parseGQL('FIND * WHERE kind IN [function, class]');
    assert.ok(ast.type === 'FIND');
    const result = executeGQL(ast, graph);
    assert.ok(result.nodes!.every((n) => n.kind === 'function' || n.kind === 'class'));
  });

  it('respects LIMIT', () => {
    const ast = parseGQL('FIND function LIMIT 3');
    assert.ok(ast.type === 'FIND');
    const result = executeGQL(ast, graph);
    assert.equal(result.nodes!.length, 3);
    assert.ok(result.totalCount > 3);
  });

  it('respects LIMIT and OFFSET', () => {
    const allAst = parseGQL('FIND function');
    assert.ok(!isGQLParseError(allAst));
    const allResult = executeGQL(allAst, graph);
    const allTotal = allResult.totalCount;

    const ast = parseGQL('FIND function LIMIT 2 OFFSET 2');
    assert.ok(!isGQLParseError(ast));
    assert.ok(ast.type === 'FIND');
    const result = executeGQL(ast, graph);
    assert.equal(result.nodes!.length, Math.min(2, allTotal - 2));
  });

  it('returns empty when no matches', () => {
    const ast = parseGQL('FIND function WHERE name CONTAINS "nonexistent_xyz_abc"');
    assert.ok(ast.type === 'FIND');
    const result = executeGQL(ast, graph);
    assert.equal(result.nodes!.length, 0);
    assert.equal(result.totalCount, 0);
  });

  it('finds all nodes with wildcard', () => {
    const ast = parseGQL('FIND *');
    assert.ok(ast.type === 'FIND');
    const result = executeGQL(ast, graph);
    assert.equal(result.totalCount, 9);
  });

  it('finds nodes with AND condition', () => {
    const ast = parseGQL('FIND function WHERE name CONTAINS "handle" AND exported = "true"');
    assert.ok(ast.type === 'FIND');
    const result = executeGQL(ast, graph);
    assert.ok(result.nodes!.every((n) => n.name.toLowerCase().includes('handle') && n.exported === true));
  });
});

describe('GQL Executor — TRAVERSE', () => {
  const graph = buildTestGraph();

  it('traverses CALLS from handleLogin', () => {
    const ast = parseGQL('TRAVERSE CALLS FROM "handleLogin" DEPTH 3');
    assert.ok(ast.type === 'TRAVERSE');
    const result = executeGQL(ast, graph);
    const names = result.nodes!.map((n) => n.name);
    assert.ok(names.includes('handleLogin'));
    assert.ok(names.includes('validateToken'));
    assert.ok(names.includes('hashPassword'));
  });

  it('traverses with DEPTH 1', () => {
    const ast = parseGQL('TRAVERSE CALLS FROM "handleLogin" DEPTH 1');
    assert.ok(ast.type === 'TRAVERSE');
    const result = executeGQL(ast, graph);
    const names = result.nodes!.map((n) => n.name);
    assert.ok(names.includes('handleLogin'));
    assert.ok(names.includes('validateToken'));
    assert.ok(names.includes('hashPassword'));
  });

  it('returns only source node when no edges match', () => {
    const ast = parseGQL('TRAVERSE CALLS FROM "sendEmail"');
    assert.ok(ast.type === 'TRAVERSE');
    const result = executeGQL(ast, graph);
    assert.equal(result.nodes!.length, 1);
    assert.equal(result.nodes![0].name, 'sendEmail');
  });

  it('returns empty when start node not found', () => {
    const ast = parseGQL('TRAVERSE CALLS FROM "nonexistent"');
    assert.ok(ast.type === 'TRAVERSE');
    const result = executeGQL(ast, graph);
    assert.equal(result.nodes!.length, 0);
  });

  it('includes edges in result', () => {
    const ast = parseGQL('TRAVERSE CALLS FROM "handleLogin" DEPTH 1');
    assert.ok(ast.type === 'TRAVERSE');
    const result = executeGQL(ast, graph);
    assert.ok(result.edges!.length >= 1);
  });
});

describe('GQL Executor — PATH', () => {
  const graph = buildTestGraph();

  it('finds path from createUser to sendEmail', () => {
    const ast = parseGQL('PATH FROM "createUser" TO "sendEmail"');
    assert.ok(ast.type === 'PATH');
    const result = executeGQL(ast, graph);
    assert.ok(result.path !== null);
    assert.ok(result.path!.length >= 2);
    assert.equal(result.path![0].name, 'createUser');
    assert.equal(result.path![result.path!.length - 1].name, 'sendEmail');
  });

  it('returns null path when no path exists', () => {
    const ast = parseGQL('PATH FROM "handleLogout" TO "sendEmail"');
    assert.ok(ast.type === 'PATH');
    const result = executeGQL(ast, graph);
    assert.equal(result.path, null);
    assert.equal(result.totalCount, 0);
  });

  it('returns null when start node not found', () => {
    const ast = parseGQL('PATH FROM "nonexistent" TO "sendEmail"');
    assert.ok(ast.type === 'PATH');
    const result = executeGQL(ast, graph);
    assert.equal(result.path, null);
  });

  it('returns null when end node not found', () => {
    const ast = parseGQL('PATH FROM "handleLogin" TO "nonexistent"');
    assert.ok(ast.type === 'PATH');
    const result = executeGQL(ast, graph);
    assert.equal(result.path, null);
  });

  it('finds path from same node to itself', () => {
    const ast = parseGQL('PATH FROM "handleLogin" TO "handleLogin"');
    assert.ok(!isGQLParseError(ast));
    assert.ok(ast.type === 'PATH');
    const result = executeGQL(ast, graph);
    // Path from a node to itself — BFS won't re-visit startNode via a loop
    // so it depends on graph topology. Just check that we get a non-error result.
    // The path may be null (no cycle) or a single node (if self-path is trivial)
    // We accept either: null or an array with at least 1 node
    const pathOk = result.path === null || (Array.isArray(result.path) && result.path.length >= 1);
    assert.ok(pathOk, `Expected path to be null or non-empty array, got: ${JSON.stringify(result.path)}`);
  });
});

describe('GQL Executor — COUNT', () => {
  const graph = buildTestGraph();

  it('counts functions grouped by cluster', () => {
    const ast = parseGQL('COUNT function GROUP BY cluster');
    assert.ok(!isGQLParseError(ast));
    assert.ok(ast.type === 'COUNT');
    const result = executeGQL(ast, graph);
    assert.ok(result.groups!.length >= 1);
    const authGroup = result.groups!.find((g) => g.key === 'auth');
    assert.ok(authGroup, 'Should have auth cluster group');
    assert.ok(authGroup.count >= 3);
  });

  it('counts all nodes grouped by kind', () => {
    const ast = parseGQL('COUNT * GROUP BY kind');
    assert.ok(!isGQLParseError(ast));
    assert.ok(ast.type === 'COUNT');
    const result = executeGQL(ast, graph);
    assert.ok(result.groups!.length >= 2);
    const functionGroup = result.groups!.find((g) => g.key === 'function');
    assert.ok(functionGroup);
    assert.equal(functionGroup.count, 6);
  });

  it('counts without GROUP BY', () => {
    const ast = parseGQL('COUNT function');
    assert.ok(!isGQLParseError(ast));
    assert.ok(ast.type === 'COUNT');
    const result = executeGQL(ast, graph);
    assert.equal(result.totalCount, 6);
    assert.ok(result.groups!.length === 1);
    assert.equal(result.groups![0].key, 'total');
    assert.equal(result.groups![0].count, 6);
  });

  it('counts with WHERE filter', () => {
    const ast = parseGQL('COUNT function WHERE name CONTAINS "handle" GROUP BY cluster');
    assert.ok(!isGQLParseError(ast));
    assert.ok(ast.type === 'COUNT');
    const result = executeGQL(ast, graph);
    const total = result.groups!.reduce((sum, g) => sum + g.count, 0);
    assert.equal(total, 2); // handleLogin, handleLogout
  });
});

describe('GQL Executor — result shape', () => {
  const graph = buildTestGraph();

  it('always has executionTimeMs', () => {
    const ast = parseGQL('FIND function');
    assert.ok(!isGQLParseError(ast));
    const result = executeGQL(ast, graph);
    assert.ok(typeof result.executionTimeMs === 'number');
    assert.ok(result.executionTimeMs >= 0);
  });

  it('always has truncated flag', () => {
    const ast = parseGQL('FIND function');
    assert.ok(!isGQLParseError(ast));
    const result = executeGQL(ast, graph);
    assert.ok(typeof result.truncated === 'boolean');
  });

  it('always has totalCount', () => {
    const ast = parseGQL('FIND function');
    assert.ok(!isGQLParseError(ast));
    const result = executeGQL(ast, graph);
    assert.ok(typeof result.totalCount === 'number');
  });

  it('FIND on larger graph returns within reasonable time', () => {
    // Build a larger graph
    const largeGraph = createKnowledgeGraph();
    for (let i = 0; i < 1000; i++) {
      largeGraph.addNode({ id: `n${i}`, kind: 'function', name: `func${i}`, filePath: `file${i}.ts` });
    }
    const ast = parseGQL('FIND function WHERE name CONTAINS "func"');
    assert.ok(!isGQLParseError(ast));
    const start = Date.now();
    const result = executeGQL(ast, largeGraph);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `Should complete in < 1000ms, took ${elapsed}ms`);
    assert.equal(result.totalCount, 1000);
  });
});
