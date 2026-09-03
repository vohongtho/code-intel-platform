import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { KnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { DbManager } from '../../../src/storage/db-manager.js';
import { loadGraphToDB } from '../../../src/storage/graph-loader.js';
import { saveRegistry } from '../../../src/storage/repo-registry.js';
import { syncGroup } from '../../../src/multi-repo/group-sync.js';
import { saveSyncResult, deleteGroup } from '../../../src/multi-repo/group-registry.js';
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

async function writeRepoGraph(repoPath: string, graph: KnowledgeGraph): Promise<void> {
  const db = new DbManager(path.join(repoPath, '.code-intel', 'graph.db'));
  await db.init();
  await loadGraphToDB(graph, db);
  db.close();
}

const BACKEND_SOURCE = [
  "const express = require('express');",
  'const app = express();',
  "app.get('/users/:id', getUser);",
  'function getUser(req, res) {',
  "  res.status(200).json({ id: req.params.id, name: 'x' });",
  '}',
].join('\n');

const FRONTEND_SOURCE = [
  'async function loadUser(id) {',
  "  const response = await fetch(`/users/${id}`);",
  '  const { id: userId, name } = await response.json();',
  '  return { userId, name };',
  '}',
].join('\n');

describe('syncGroup — evidence-based route matching', () => {
  it('links a frontend consumer to the backend route it calls via method+normalized-path evidence, not name matching', async () => {
    const backendPath = mkRepo('group-sync-backend');
    const frontendPath = mkRepo('group-sync-frontend');
    await writeRepoGraph(backendPath, graphFromSource('src/app.js', BACKEND_SOURCE));
    await writeRepoGraph(frontendPath, graphFromSource('src/client.js', FRONTEND_SOURCE));

    saveRegistry([
      { id: 'backend', name: 'backend', path: backendPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 1, files: 1 } },
      { id: 'frontend', name: 'frontend', path: frontendPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 1, files: 1 } },
    ]);

    const result = await syncGroup({
      name: 'test-group',
      createdAt: new Date().toISOString(),
      members: [
        { groupPath: 'backend', repoId: 'backend', registryName: 'backend' },
        { groupPath: 'frontend', repoId: 'frontend', registryName: 'frontend' },
      ],
    });

    const routeLink = result.links.find(
      (link) => link.matchKind === 'route-match' && link.providerRepo === 'backend' && link.consumerRepo === 'frontend',
    );
    assert.ok(routeLink, `expected a route-match link among: ${JSON.stringify(result.links)}`);
    assert.ok(routeLink.providerContract.startsWith('GET '));
    assert.ok(routeLink.consumerContract.includes('src/client.js'));
    assert.ok(routeLink.confidence > 0);
    assert.ok(routeLink.providerSourceCanonicalId);
    assert.ok(routeLink.consumerSourceCanonicalId);
    assert.ok(result.contractVersions && result.contractVersions.length > 0);
    const backendRoute = result.contracts.find((contract) => contract.repoName === 'backend' && contract.kind === 'route');
    assert.ok(backendRoute?.contractId);
    assert.ok(backendRoute?.semanticFingerprint);
    assert.ok(backendRoute?.snapshotId);
    assert.ok(result.consumerIndex?.byContractId[backendRoute!.contractId!]);
    assert.equal(result.consumerIndex?.byContractId[backendRoute!.contractId!]?.[0]?.repositoryId, 'frontend');

    fs.rmSync(backendPath, { recursive: true, force: true });
    fs.rmSync(frontendPath, { recursive: true, force: true });
  });

  it('does not link routes across repos by name alone when no consumer resolves to them', async () => {
    // Two repos each define a route with the exact same name/path but neither is a consumer
    // of the other — the old name-equality matcher would have linked them; the evidence-based
    // matcher must not, since there is no fetch/Axios/Angular call resolving to either.
    const repoAPath = mkRepo('group-sync-repo-a');
    const repoBPath = mkRepo('group-sync-repo-b');
    await writeRepoGraph(repoAPath, graphFromSource('src/app.js', BACKEND_SOURCE));
    await writeRepoGraph(repoBPath, graphFromSource('src/app.js', BACKEND_SOURCE));

    saveRegistry([
      { id: 'repo-a', name: 'repo-a', path: repoAPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 1, files: 1 } },
      { id: 'repo-b', name: 'repo-b', path: repoBPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 1, files: 1 } },
    ]);

    const result = await syncGroup({
      name: 'test-group-2',
      createdAt: new Date().toISOString(),
      members: [
        { groupPath: 'repo-a', repoId: 'repo-a', registryName: 'repo-a' },
        { groupPath: 'repo-b', repoId: 'repo-b', registryName: 'repo-b' },
      ],
    });

    assert.equal(result.links.some((link) => link.matchKind === 'route-match'), false);
    assert.equal(result.schemaVersion, '1.0.11');

    fs.rmSync(repoAPath, { recursive: true, force: true });
    fs.rmSync(repoBPath, { recursive: true, force: true });
  });

  it('reports changedContractIds relative to the previous sync, and everything-changed with no baseline', async () => {
    const backendPath = mkRepo('group-sync-changed-backend');
    await writeRepoGraph(backendPath, graphFromSource('src/app.js', BACKEND_SOURCE));
    saveRegistry([{ id: 'backend-changed', name: 'backend-changed', path: backendPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 1, files: 1 } }]);

    const group = {
      name: 'changed-ids-group',
      createdAt: new Date().toISOString(),
      members: [{ groupPath: 'backend', repoId: 'backend-changed', registryName: 'backend-changed' }],
    };
    // Group state persists in ~/.code-intel/groups across test runs (it is not sandboxed to a
    // temp dir) — clear any leftover sync result from a prior run before asserting "no baseline".
    deleteGroup(group.name);

    const first = await syncGroup(group);
    assert.ok(first.changedContractIds && first.changedContractIds.length > 0, 'no previous baseline — every contract must be reported as changed');
    saveSyncResult(first);

    const second = await syncGroup(group);
    assert.deepEqual(second.changedContractIds, [], 'identical source re-synced — nothing changed');
    saveSyncResult(second);

    await writeRepoGraph(backendPath, graphFromSource('src/app.js', BACKEND_SOURCE.replace('/users/:id', '/users/:id/details')));
    const third = await syncGroup(group);
    assert.ok(third.changedContractIds && third.changedContractIds.length > 0, 'route path changed — old route removed, new route added');

    deleteGroup(group.name);
    fs.rmSync(backendPath, { recursive: true, force: true });
  });
});
