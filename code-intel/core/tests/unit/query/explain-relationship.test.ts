import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { KnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { explainRelationship } from '../../../src/query/explain-relationship.js';
import type { ExplainRelationshipResult } from '../../../src/query/explain-relationship.js';

function buildTestGraph(): KnowledgeGraph {
  const graph = createKnowledgeGraph();

  graph.addNode({ id: 'user', kind: 'class', name: 'UserService', filePath: 'user/service.ts' });
  graph.addNode({ id: 'email', kind: 'class', name: 'EmailService', filePath: 'email/service.ts' });
  graph.addNode({ id: 'createUser', kind: 'function', name: 'createUser', filePath: 'user/create.ts' });
  graph.addNode({ id: 'sendWelcome', kind: 'function', name: 'sendWelcome', filePath: 'email/welcome.ts' });
  graph.addNode({ id: 'mailer', kind: 'file', name: 'mailer', filePath: 'shared/mailer.ts' });
  graph.addNode({ id: 'base', kind: 'class', name: 'BaseService', filePath: 'base/service.ts' });
  graph.addNode({ id: 'unrelated', kind: 'function', name: 'unrelatedFn', filePath: 'other/fn.ts' });

  // Direct call: UserService → createUser → sendWelcome → EmailService (3-hop path)
  graph.addEdge({ id: 'e1', source: 'user', target: 'createUser', kind: 'calls' });
  graph.addEdge({ id: 'e2', source: 'createUser', target: 'sendWelcome', kind: 'calls' });
  graph.addEdge({ id: 'e3', source: 'sendWelcome', target: 'email', kind: 'calls' });

  // Shared import: both UserService and EmailService import mailer
  graph.addEdge({ id: 'e4', source: 'user', target: 'mailer', kind: 'imports' });
  graph.addEdge({ id: 'e5', source: 'email', target: 'mailer', kind: 'imports' });

  // Heritage: UserService extends BaseService
  graph.addEdge({ id: 'e6', source: 'user', target: 'base', kind: 'extends' });

  // EmailService implements BaseService
  graph.addEdge({ id: 'e7', source: 'email', target: 'base', kind: 'implements' });

  return graph;
}

describe('explainRelationship', () => {
  const graph = buildTestGraph();

  it('finds a direct (1-hop) path between connected symbols', () => {
    const result = explainRelationship(graph, 'UserService', 'createUser');
    assert.ok(!('error' in result), 'should not return error');
    const r = result as ExplainRelationshipResult;
    assert.ok(r.paths.length >= 1, 'should find at least one path');
    assert.equal(r.paths[0].hops, 1);
    assert.deepEqual(r.paths[0].nodes, ['UserService', 'createUser']);
    assert.equal(r.paths[0].edgeKind, 'calls');
  });

  it('finds a multi-hop (3-hop) indirect path', () => {
    const result = explainRelationship(graph, 'UserService', 'EmailService');
    assert.ok(!('error' in result), 'should not return error');
    const r = result as ExplainRelationshipResult;
    assert.ok(r.paths.length >= 1, 'should find at least one path');
    const threeHopPath = r.paths.find((p) => p.hops === 3);
    assert.ok(threeHopPath !== undefined, 'should include a 3-hop path');
    assert.deepEqual(threeHopPath!.nodes, ['UserService', 'createUser', 'sendWelcome', 'EmailService']);
  });

  it('returns empty paths when there is no connection', () => {
    const result = explainRelationship(graph, 'UserService', 'unrelatedFn');
    assert.ok(!('error' in result), 'should not return error');
    const r = result as ExplainRelationshipResult;
    assert.equal(r.paths.length, 0, 'should find no paths to unrelated symbol');
    assert.ok(r.summary.includes('No connection found'), `summary should mention no connection, got: ${r.summary}`);
  });

  it('finds shared imports correctly', () => {
    const result = explainRelationship(graph, 'UserService', 'EmailService');
    assert.ok(!('error' in result));
    const r = result as ExplainRelationshipResult;
    assert.ok(r.sharedImports.includes('mailer'), `should include 'mailer' as shared import, got: ${JSON.stringify(r.sharedImports)}`);
  });

  it('detects heritage (extends) relationship', () => {
    const result = explainRelationship(graph, 'UserService', 'BaseService');
    assert.ok(!('error' in result));
    const r = result as ExplainRelationshipResult;
    assert.ok(r.heritage !== null, 'should detect heritage');
    assert.ok(r.heritage!.includes('extends'), `heritage should mention extends, got: ${r.heritage}`);
  });

  it('detects heritage (implements) relationship in reverse direction', () => {
    const result = explainRelationship(graph, 'EmailService', 'BaseService');
    assert.ok(!('error' in result));
    const r = result as ExplainRelationshipResult;
    assert.ok(r.heritage !== null, 'should detect heritage');
    assert.ok(r.heritage!.includes('implements'), `heritage should mention implements, got: ${r.heritage}`);
  });

  it('returns error and suggestions when source symbol is not found', () => {
    const result = explainRelationship(graph, 'UnknownSvc', 'EmailService');
    assert.ok('error' in result, 'should return error for unknown symbol');
    const r = result as { error: string; suggestions: string[] };
    assert.ok(r.error.includes('UnknownSvc'));
    assert.ok(Array.isArray(r.suggestions));
  });

  it('returns error and suggestions when destination symbol is not found', () => {
    const result = explainRelationship(graph, 'UserService', 'GhostService');
    assert.ok('error' in result, 'should return error for unknown target');
    const r = result as { error: string; suggestions: string[] };
    assert.ok(r.error.includes('GhostService'));
  });

  it('summary includes path count and shared imports', () => {
    const result = explainRelationship(graph, 'UserService', 'EmailService');
    assert.ok(!('error' in result));
    const r = result as ExplainRelationshipResult;
    assert.ok(r.summary.includes('path'), `summary should mention paths, got: ${r.summary}`);
    assert.ok(r.summary.includes('mailer') || r.summary.includes('Shared'), `summary should mention shared imports, got: ${r.summary}`);
  });
});
