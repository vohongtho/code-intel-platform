import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { KnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { explainRelationship } from '../../../src/query/explain-relationship.js';
import type { ExplainRelationshipResult } from '../../../src/query/explain-relationship.js';
import { createEvidenceStore } from '../../../src/evidence/store.js';

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'explain-relationship-'));
}

function buildTestGraph(repoDir: string): KnowledgeGraph {
  const graph = createKnowledgeGraph();

  graph.addNode({ id: 'user', kind: 'class', name: 'UserService', filePath: 'user/service.ts' });
  graph.addNode({ id: 'email', kind: 'class', name: 'EmailService', filePath: 'email/service.ts' });
  graph.addNode({ id: 'createUser', kind: 'function', name: 'createUser', filePath: 'user/create.ts' });
  graph.addNode({ id: 'sendWelcome', kind: 'function', name: 'sendWelcome', filePath: 'email/welcome.ts' });
  graph.addNode({ id: 'mailer', kind: 'file', name: 'mailer', filePath: 'shared/mailer.ts' });
  graph.addNode({ id: 'base', kind: 'class', name: 'BaseService', filePath: 'base/service.ts' });
  graph.addNode({ id: 'unrelated', kind: 'function', name: 'unrelatedFn', filePath: 'other/fn.ts' });

  const store = createEvidenceStore(repoDir);
  store.put({
    id: 'ev:path-1',
    version: 1,
    referenceId: 'callsite:test:1',
    resolverVersion: 'evidence-based-v1',
    strategy: 'semantic-call',
    confidence: 0.95,
    certainty: 'exact',
    coverage: { complete: false, examinedCount: 1, totalKnownCount: 3, incompleteReasons: ['analysis-limit'] },
    boundaries: [{ kind: 'analysis-limit', evidenceRefs: ['ev:path-1'] }],
    recordedAt: '2025-01-01T00:00:00.000Z',
  });
  store.close();

  graph.addEdge({ id: 'e1', source: 'user', target: 'createUser', kind: 'calls', label: 'framework:nest | 0.1.0 | @Get', evidenceRef: 'ev:path-1', certainty: 'exact', strategy: 'semantic-call' });
  graph.addEdge({ id: 'e2', source: 'createUser', target: 'sendWelcome', kind: 'calls' });
  graph.addEdge({ id: 'e3', source: 'sendWelcome', target: 'email', kind: 'calls' });
  graph.addEdge({ id: 'e4', source: 'user', target: 'mailer', kind: 'imports' });
  graph.addEdge({ id: 'e5', source: 'email', target: 'mailer', kind: 'imports' });
  graph.addEdge({ id: 'e6', source: 'user', target: 'base', kind: 'extends' });
  graph.addEdge({ id: 'e7', source: 'email', target: 'base', kind: 'implements' });

  return graph;
}

describe('explainRelationship', () => {
  const repoDir = tempRepo();
  const graph = buildTestGraph(repoDir);

  it('finds a direct (1-hop) path between connected symbols', () => {
    const result = explainRelationship(graph, 'UserService', 'createUser', repoDir);
    assert.ok(!('error' in result), 'should not return error');
    const r = result as ExplainRelationshipResult;
    assert.ok(r.paths.length >= 1, 'should find at least one path');
    assert.equal(r.paths[0].hops, 1);
    assert.deepEqual(r.paths[0].nodes, ['UserService', 'createUser']);
    assert.equal(r.paths[0].edgeKind, 'calls');
  });

  it('finds a multi-hop (3-hop) indirect path', () => {
    const result = explainRelationship(graph, 'UserService', 'EmailService', repoDir);
    assert.ok(!('error' in result), 'should not return error');
    const r = result as ExplainRelationshipResult;
    assert.ok(r.paths.length >= 1, 'should find at least one path');
    const threeHopPath = r.paths.find((p) => p.hops === 3);
    assert.ok(threeHopPath !== undefined, 'should include a 3-hop path');
    assert.deepEqual(threeHopPath!.nodes, ['UserService', 'createUser', 'sendWelcome', 'EmailService']);
  });

  it('returns empty paths when there is no connection', () => {
    const result = explainRelationship(graph, 'UserService', 'unrelatedFn', repoDir);
    assert.ok(!('error' in result), 'should not return error');
    const r = result as ExplainRelationshipResult;
    assert.equal(r.paths.length, 0, 'should find no paths to unrelated symbol');
    assert.equal(r.coverage?.complete, false);
    assert.ok(r.summary.includes('No connection found'), `summary should mention no connection, got: ${r.summary}`);
    assert.ok(r.summary.includes('Certainty: [lower-bound]'), `summary should mention lower-bound certainty, got: ${r.summary}`);
  });

  it('finds shared imports correctly', () => {
    const result = explainRelationship(graph, 'UserService', 'EmailService', repoDir);
    assert.ok(!('error' in result));
    const r = result as ExplainRelationshipResult;
    assert.ok(r.sharedImports.includes('mailer'), `should include 'mailer' as shared import, got: ${JSON.stringify(r.sharedImports)}`);
  });

  it('detects heritage (extends) relationship', () => {
    const result = explainRelationship(graph, 'UserService', 'BaseService', repoDir);
    assert.ok(!('error' in result));
    const r = result as ExplainRelationshipResult;
    assert.ok(r.heritage !== null, 'should detect heritage');
    assert.ok(r.heritage!.includes('extends'), `heritage should mention extends, got: ${r.heritage}`);
  });

  it('detects heritage (implements) relationship in reverse direction', () => {
    const result = explainRelationship(graph, 'EmailService', 'BaseService', repoDir);
    assert.ok(!('error' in result));
    const r = result as ExplainRelationshipResult;
    assert.ok(r.heritage !== null, 'should detect heritage');
    assert.ok(r.heritage!.includes('implements'), `heritage should mention implements, got: ${r.heritage}`);
  });

  it('returns error and suggestions when source symbol is not found', () => {
    const result = explainRelationship(graph, 'UnknownSvc', 'EmailService', repoDir);
    assert.ok('error' in result, 'should return error for unknown symbol');
    const r = result as { error: string; suggestions: string[] };
    assert.ok(r.error.includes('UnknownSvc'));
    assert.ok(Array.isArray(r.suggestions));
  });

  it('returns error and suggestions when destination symbol is not found', () => {
    const result = explainRelationship(graph, 'UserService', 'GhostService', repoDir);
    assert.ok('error' in result, 'should return error for unknown target');
    const r = result as { error: string; suggestions: string[] };
    assert.ok(r.error.includes('GhostService'));
  });

  it('summary includes path count and shared imports', () => {
    const result = explainRelationship(graph, 'UserService', 'EmailService', repoDir);
    assert.ok(!('error' in result));
    const r = result as ExplainRelationshipResult;
    assert.ok(r.summary.includes('path'), `summary should mention paths, got: ${r.summary}`);
    assert.ok(r.summary.includes('mailer') || r.summary.includes('Shared'), `summary should mention shared imports, got: ${r.summary}`);
  });

  it('loads certainty, strategy, coverage, boundaries from evidence store', () => {
    const result = explainRelationship(graph, 'UserService', 'createUser', repoDir);
    assert.ok(!('error' in result));
    const r = result as ExplainRelationshipResult;
    assert.equal(r.paths[0]?.evidence, 'ev:path-1');
    assert.equal(r.paths[0]?.certainty, 'exact');
    assert.equal(r.paths[0]?.strategy, 'semantic-call');
    assert.equal(r.paths[0]?.coverage?.complete, false);
    assert.deepEqual(r.paths[0]?.boundaries?.map((item) => item.kind), ['analysis-limit']);
    assert.equal(r.coverage?.complete, false);
    assert.ok(r.summary.includes('Coverage: incomplete'), `summary should mention coverage, got: ${r.summary}`);
    assert.ok(r.summary.includes('Boundaries: [analysis-limit]'), `summary should mention boundaries, got: ${r.summary}`);
  });

  it('downgrades certainty to truncated when max path depth cuts traversal', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'a', kind: 'function', name: 'a', filePath: 'a.ts' });
    graph.addNode({ id: 'b', kind: 'function', name: 'b', filePath: 'b.ts' });
    graph.addNode({ id: 'c', kind: 'function', name: 'c', filePath: 'c.ts' });
    graph.addNode({ id: 'd', kind: 'function', name: 'd', filePath: 'd.ts' });
    graph.addNode({ id: 'e', kind: 'function', name: 'e', filePath: 'e.ts' });
    graph.addNode({ id: 'f', kind: 'function', name: 'f', filePath: 'f.ts' });
    graph.addNode({ id: 'g', kind: 'function', name: 'g', filePath: 'g.ts' });
    graph.addEdge({ id: 'e1', source: 'a', target: 'b', kind: 'calls', certainty: 'exact' });
    graph.addEdge({ id: 'e2', source: 'b', target: 'c', kind: 'calls', certainty: 'exact' });
    graph.addEdge({ id: 'e3', source: 'c', target: 'd', kind: 'calls', certainty: 'exact' });
    graph.addEdge({ id: 'e4', source: 'd', target: 'e', kind: 'calls', certainty: 'exact' });
    graph.addEdge({ id: 'e5', source: 'e', target: 'f', kind: 'calls', certainty: 'exact' });
    graph.addEdge({ id: 'e6', source: 'f', target: 'g', kind: 'calls', certainty: 'exact' });

    const result = explainRelationship(graph, 'a', 'g');
    assert.ok(!('error' in result));
    const r = result as ExplainRelationshipResult;
    assert.equal(r.paths.length, 0);
    assert.equal(r.certainty, 'truncated');
    assert.equal(r.coverage?.complete, false);
    assert.ok(r.coverage?.incompleteReasons.includes('analysis-limit'));
  });
});
