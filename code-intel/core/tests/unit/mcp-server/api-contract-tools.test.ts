import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { KnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { DbManager } from '../../../src/storage/db-manager.js';
import { loadGraphToDB } from '../../../src/storage/graph-loader.js';
import { saveMetadata } from '../../../src/storage/metadata.js';
import { saveRegistry } from '../../../src/storage/repo-registry.js';
import { dispatchTool, resetRepoGraphCacheForTests } from '../../../src/mcp-server/server.js';
import { saveGroup, saveSyncResult } from '../../../src/multi-repo/group-registry.js';
import { CURRENT_SCHEMA_VERSION } from '../../../src/migrations/migration-runner.js';
import { projectFactBundle } from '../../../src/semantic/graph-projector.js';
import { createFactBundle, FACT_SCHEMA_VERSION } from '../../../src/semantic/fact-bundle.js';
import { expressFrameworkAdapter } from '../../../src/frameworks/adapters/express.js';
import { fetchConsumerAdapter } from '../../../src/semantic/api-contracts/consumers/fetch.js';
import { Language } from '../../../src/shared/languages.js';

function mkRepo(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  fs.mkdirSync(path.join(dir, '.code-intel'), { recursive: true });
  return dir;
}

function graphFromSource(filePath: string, source: string): KnowledgeGraph {
  const graph = createKnowledgeGraph();
  const view = { workspaceRoot: '/repo', filePaths: [filePath], fileCache: new Map([[filePath, source]]) };
  const routeBundle = expressFrameworkAdapter.extract(view);
  const consumerBundle = fetchConsumerAdapter.extract(view);
  const merged = createFactBundle({
    schema: { version: FACT_SCHEMA_VERSION, language: Language.JavaScript, adapterId: 'test' },
    facts: [...routeBundle.facts, ...consumerBundle.facts],
    diagnostics: [],
  });
  const { nodes, edges } = projectFactBundle(merged);
  for (const node of nodes) graph.addNode(node);
  for (const edge of edges) graph.addEdge(edge);
  return graph;
}

async function writeRepoIndex(repoPath: string, graph: KnowledgeGraph): Promise<void> {
  const db = new DbManager(path.join(repoPath, '.code-intel', 'graph.db'));
  await db.init();
  await loadGraphToDB(graph, db);
  db.close();
  saveMetadata(repoPath, {
    indexedAt: new Date().toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    indexVersion: 'v1',
    stats: { nodes: graph.size.nodes, edges: graph.size.edges, files: 1, duration: 0 },
  });
}

async function writeSnapshotGraph(repoPath: string, snapshotId: string, graph: KnowledgeGraph): Promise<void> {
  const dir = path.join(repoPath, '.code-intel', 'snapshots', snapshotId);
  fs.mkdirSync(dir, { recursive: true });
  const db = new DbManager(path.join(dir, 'graph.db'));
  await db.init();
  await loadGraphToDB(graph, db);
  db.close();
}

function routeGraph(responseFields: readonly string[]): KnowledgeGraph {
  const graph = createKnowledgeGraph();
  const shapeId = `shape-fact:${responseFields.join(',')}`;
  graph.addNode({
    id: 'route-node',
    identityId: 'route-fact',
    kind: 'route',
    name: 'GET /users',
    filePath: 'src/routes.ts',
    metadata: { apiContract: { factId: 'route-fact', language: 'typescript', method: 'GET', path: '/users', normalizedPath: '/users', framework: 'express', coverage: { complete: true, boundaryReasons: [] }, responses: [{ status: 200, responseShapeRef: shapeId, evidence: 'exact' }] } },
  });
  graph.addNode({
    id: shapeId,
    identityId: shapeId,
    kind: 'api_shape',
    name: 'UsersResponse',
    filePath: 'src/routes.ts',
    metadata: { semantic: { factId: shapeId, language: 'typescript', shapeFactKind: 'http-response-shape', shapeFingerprint: shapeId, status: 200, origin: { kind: 'inline', fields: responseFields.map((key) => ({ key, required: true })) }, coverage: { complete: true, boundaryReasons: [] } } },
  });
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

const HEAD_SERVER_SOURCE = [
  "const express = require('express');",
  'const app = express();',
  "app.get('/users/:id', getUser);",
  'function getUser(req, res) {',
  "  res.status(200).json({ id: req.params.id, name: 'x' });", // ssn removed
  '}',
].join('\n');

const CLIENT_SOURCE = [
  'async function loadUser(id) {',
  "  const response = await fetch(`/users/${id}`);",
  '  const { id: userId, ssn } = await response.json();',
  '  return { userId, ssn };',
  '}',
].join('\n');

describe('MCP api_contract / api_impact / api_drift tools', () => {
  beforeEach(() => {
    resetRepoGraphCacheForTests();
  });

  it('api_contract returns the route shape and its known consumer', async () => {
    const repoPath = mkRepo('mcp-api-contract');
    saveRegistry([{ id: 'repo-id', name: 'repo', path: repoPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 1, files: 1 } }]);
    await writeRepoIndex(repoPath, graphFromSource('src/app.js', SERVER_SOURCE + '\n' + CLIENT_SOURCE));

    const result = await dispatchTool('api_contract', { repoId: 'repo-id', method: 'GET', path: '/users/{}' }, createKnowledgeGraph(), 'fallback', repoPath);
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0]?.text ?? '[]') as Array<{ route: { method: string }; consumers: Array<{ consumedKeys: string[] }> }>;
    assert.equal(payload.length, 1);
    assert.equal(payload[0]!.route.method, 'GET');
    assert.deepEqual([...payload[0]!.consumers[0]!.consumedKeys].sort(), ['id', 'ssn']);
  });

  it('api_impact reports the resolved consumer as blast radius', async () => {
    const repoPath = mkRepo('mcp-api-impact');
    saveRegistry([{ id: 'repo-id', name: 'repo', path: repoPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 1, files: 1 } }]);
    await writeRepoIndex(repoPath, graphFromSource('src/app.js', SERVER_SOURCE + '\n' + CLIENT_SOURCE));

    const result = await dispatchTool('api_impact', { repoId: 'repo-id', path: '/users/{}' }, createKnowledgeGraph(), 'fallback', repoPath);
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as { routes: unknown[]; consumers: unknown[] };
    assert.equal(payload.routes.length, 1);
    assert.equal(payload.consumers.length, 1);
  });

  it('api_drift flags a removed, consumed response field as breaking across two repos', async () => {
    const basePath = mkRepo('mcp-api-drift-base');
    const headPath = mkRepo('mcp-api-drift-head');
    saveRegistry([
      { id: 'base-repo', name: 'base', path: basePath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 1, files: 1 } },
      { id: 'head-repo', name: 'head', path: headPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 1, files: 1 } },
    ]);
    await writeRepoIndex(basePath, graphFromSource('src/app.js', SERVER_SOURCE + '\n' + CLIENT_SOURCE));
    await writeRepoIndex(headPath, graphFromSource('src/app.js', HEAD_SERVER_SOURCE + '\n' + CLIENT_SOURCE));

    const result = await dispatchTool(
      'api_drift',
      { repoId: 'head-repo', base_repo_id: 'base-repo' },
      createKnowledgeGraph(),
      'fallback',
      headPath,
    );
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as { findings: Array<{ rule: string; fieldKey?: string; verdict: string }> };
    const breaking = payload.findings.find((f) => f.rule === 'response-field-removed' && f.fieldKey === 'ssn');
    assert.ok(breaking, `expected a response-field-removed finding among: ${JSON.stringify(payload.findings)}`);
    assert.equal(breaking.verdict, 'breaking');
  });

  it('api_drift returns an error result (not a thrown exception) for an unknown base_repo_id', async () => {
    const repoPath = mkRepo('mcp-api-drift-missing');
    saveRegistry([{ id: 'repo-id', name: 'repo', path: repoPath, indexedAt: new Date().toISOString(), stats: { nodes: 0, edges: 0, files: 0 } }]);
    await writeRepoIndex(repoPath, createKnowledgeGraph());

    const result = await dispatchTool('api_drift', { repoId: 'repo-id', base_repo_id: 'does-not-exist' }, createKnowledgeGraph(), 'fallback', repoPath);
    assert.equal(result.isError, true);
    assert.match(result.content[0]?.text ?? '', /not found/i);
  });

  it('api_drift fails closed (400-equivalent error result) for a malformed scope missing base_repo_id', async () => {
    const repoPath = mkRepo('mcp-api-drift-malformed');
    saveRegistry([{ id: 'repo-id', name: 'repo', path: repoPath, indexedAt: new Date().toISOString(), stats: { nodes: 0, edges: 0, files: 0 } }]);
    await writeRepoIndex(repoPath, createKnowledgeGraph());

    const result = await dispatchTool('api_drift', { repoId: 'repo-id' }, createKnowledgeGraph(), 'fallback', repoPath);
    assert.equal(result.isError, true);
    assert.match(result.content[0]?.text ?? '', /base_repo_id is required/i);
  });

  it('api_contract/api_impact return an empty result (not an error) for a selector matching no route', async () => {
    const repoPath = mkRepo('mcp-api-contract-empty');
    saveRegistry([{ id: 'repo-id', name: 'repo', path: repoPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 1, files: 1 } }]);
    await writeRepoIndex(repoPath, graphFromSource('src/app.js', SERVER_SOURCE + '\n' + CLIENT_SOURCE));

    const contractResult = await dispatchTool('api_contract', { repoId: 'repo-id', method: 'DELETE', path: '/does/not/exist' }, createKnowledgeGraph(), 'fallback', repoPath);
    assert.equal(contractResult.isError, undefined);
    assert.deepEqual(JSON.parse(contractResult.content[0]?.text ?? '[]'), []);

    const impactResult = await dispatchTool('api_impact', { repoId: 'repo-id', method: 'DELETE', path: '/does/not/exist' }, createKnowledgeGraph(), 'fallback', repoPath);
    assert.equal(impactResult.isError, undefined);
    const impactBody = JSON.parse(impactResult.content[0]?.text ?? '{}') as { routes: unknown[] };
    assert.deepEqual(impactBody.routes, []);
  });

  it('group_contract_drift returns synchronized cross-repo findings across refs', async () => {
    const backendPath = mkRepo('mcp-group-drift-backend');
    fs.mkdirSync(path.join(backendPath, '.code-intel', 'snapshots'), { recursive: true });
    await writeSnapshotGraph(backendPath, 'base-backend', routeGraph(['id', 'ssn']));
    await writeSnapshotGraph(backendPath, 'head-backend', routeGraph(['id']));
    saveRegistry([{ id: 'backend', name: 'backend', path: backendPath, indexedAt: new Date().toISOString(), stats: { nodes: 2, edges: 0, files: 1 } }]);
    saveGroup({ name: 'mcp-group-drift', createdAt: new Date().toISOString(), members: [{ groupPath: 'backend', repoId: 'backend', registryName: 'backend' }] });
    saveSyncResult({
      groupName: 'mcp-group-drift',
      syncedAt: new Date().toISOString(),
      memberCount: 1,
      contracts: [{ repoName: 'backend', repoPath: backendPath, repositoryId: 'backend', kind: 'route', name: 'GET /users', nodeId: 'route-node', nodeKind: 'route', filePath: 'src/routes.ts', method: 'GET', normalizedPath: '/users', sourceCanonicalId: 'route-fact', contractId: 'backend-route', snapshotId: 'head-backend', semanticFingerprint: 'fp-route', role: 'producer', certainty: 'exact', coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } }],
      links: [],
      consumerIndex: { byContractId: { 'backend-route': [{ repositoryId: 'frontend', consumerId: 'consumer:ssn', sourceCanonicalId: 'consumer:ssn', certainty: 'exact', consumedFields: ['ssn'], callSites: ['consumer:ssn'], coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } }] }, bySemanticFingerprint: {} },
    });

    const result = await dispatchTool('group_contract_drift', { name: 'mcp-group-drift', base_snapshot_ids: { backend: 'base-backend' }, head_snapshot_ids: { backend: 'head-backend' } }, createKnowledgeGraph(), 'fallback', backendPath);
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as { findings: Array<{ changeKind: string; compatibility: string }> };
    assert.equal(payload.findings.some((finding) => finding.changeKind === 'response-field-removed' && finding.compatibility === 'breaking'), true);
  });

  it('group_contract_drift returns an error result (not a thrown exception) for an unknown group name', async () => {
    const result = await dispatchTool('group_contract_drift', { name: 'no-such-group', base_ref: 'main', head_ref: 'HEAD' }, createKnowledgeGraph(), 'fallback', undefined);
    assert.equal(result.isError, true);
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as { error?: string };
    assert.match(payload.error ?? '', /no-such-group/);
  });

  it('group_contract_drift fails closed (error result) for a malformed scope missing both refs and snapshot ids', async () => {
    const result = await dispatchTool('group_contract_drift', { name: 'mcp-group-drift' }, createKnowledgeGraph(), 'fallback', undefined);
    assert.equal(result.isError, true);
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as { error?: string };
    assert.match(payload.error ?? '', /base_ref|base_snapshot_ids/);
  });
});
