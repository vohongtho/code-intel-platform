import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../../src/graph/knowledge-graph.js';
import { projectFactBundle } from '../../../../src/semantic/graph-projector.js';
import { createFactBundle, FACT_SCHEMA_VERSION } from '../../../../src/semantic/fact-bundle.js';
import { expressFrameworkAdapter } from '../../../../src/frameworks/adapters/express.js';
import { fetchConsumerAdapter } from '../../../../src/semantic/api-contracts/consumers/fetch.js';
import { getApiContract, getApiDrift, getApiImpact } from '../../../../src/semantic/api-contracts/service.js';
import type { KnowledgeGraph } from '../../../../src/graph/knowledge-graph.js';

function graphFromSource(filePath: string, source: string): KnowledgeGraph {
  const graph = createKnowledgeGraph();
  const view = { workspaceRoot: '/repo', filePaths: [filePath], fileCache: new Map([[filePath, source]]) };
  const routeBundle = expressFrameworkAdapter.extract(view);
  const consumerBundle = fetchConsumerAdapter.extract(view);
  const merged = createFactBundle({
    schema: { version: FACT_SCHEMA_VERSION, language: routeBundle.schema.language, adapterId: 'test' },
    facts: [...routeBundle.facts, ...consumerBundle.facts],
    diagnostics: [],
  });
  const { nodes, edges } = projectFactBundle(merged);
  for (const node of nodes) graph.addNode(node);
  for (const edge of edges) graph.addEdge(edge);
  return graph;
}

const SERVER_SOURCE = [
  "const express = require('express');",
  'const app = express();',
  "app.get('/users/:id', getUser);",
  'function getUser(req, res) {',
  "  res.status(200).json({ id: req.params.id, name: 'x', ssn: '000' });",
  '}',
].join('\n');

const CLIENT_SOURCE = [
  'async function loadUser(id) {',
  "  const response = await fetch(`/users/${id}`);",
  '  const { id: userId, ssn } = await response.json();',
  '  return { userId, ssn };',
  '}',
].join('\n');

describe('api-contracts service', () => {
  it('getApiContract returns the route shape and its known consumer', () => {
    const graph = graphFromSource('src/app.js', SERVER_SOURCE + '\n' + CLIENT_SOURCE);
    const results = getApiContract(graph, { normalizedPath: '/users/{}', method: 'GET' });
    assert.equal(results.length, 1);
    assert.equal(results[0]!.route.method, 'GET');
    assert.equal(results[0]!.consumers.length, 1);
    assert.deepEqual([...results[0]!.consumers[0]!.consumedKeys].sort(), ['id', 'ssn']);
  });

  it('getApiImpact reports the same consumer as affected blast radius', () => {
    const graph = graphFromSource('src/app.js', SERVER_SOURCE + '\n' + CLIENT_SOURCE);
    const impact = getApiImpact(graph, { normalizedPath: '/users/{}', method: 'GET' });
    assert.equal(impact.routes.length, 1);
    assert.equal(impact.consumers.length, 1);
    assert.equal(impact.coverage.totalRoutes >= 1, true);
  });

  it('getApiDrift flags removing a consumed response field as breaking', () => {
    const baseGraph = graphFromSource('src/app.js', SERVER_SOURCE + '\n' + CLIENT_SOURCE);
    const HEAD_SERVER_SOURCE = [
      "const express = require('express');",
      'const app = express();',
      "app.get('/users/:id', getUser);",
      'function getUser(req, res) {',
      "  res.status(200).json({ id: req.params.id, name: 'x' });", // ssn removed
      '}',
    ].join('\n');
    const headGraph = graphFromSource('src/app.js', HEAD_SERVER_SOURCE + '\n' + CLIENT_SOURCE);

    const drift = getApiDrift(baseGraph, headGraph);
    const breaking = drift.findings.find((f) => f.rule === 'response-field-removed' && f.fieldKey === 'ssn');
    assert.ok(breaking, `expected a response-field-removed finding for ssn among: ${JSON.stringify(drift.findings)}`);
    assert.equal(breaking.verdict, 'breaking');
    assert.equal(breaking.affectedConsumerFactIds.length, 1);
  });
});
