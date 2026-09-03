import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { KnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { DbManager } from '../../../src/storage/db-manager.js';
import { loadGraphToDB } from '../../../src/storage/graph-loader.js';
import { saveMetadata } from '../../../src/storage/metadata.js';
import { CURRENT_SCHEMA_VERSION } from '../../../src/migrations/migration-runner.js';
import { projectFactBundle } from '../../../src/semantic/graph-projector.js';
import { createFactBundle, FACT_SCHEMA_VERSION } from '../../../src/semantic/fact-bundle.js';
import { expressFrameworkAdapter } from '../../../src/frameworks/adapters/express.js';
import { fetchConsumerAdapter } from '../../../src/semantic/api-contracts/consumers/fetch.js';
import { Language } from '../../../src/shared/languages.js';

const CORE_ROOT = path.resolve(import.meta.dirname, '../../../..');
const CLI_MAIN = path.join(CORE_ROOT, 'dist-tests', 'src', 'cli', 'main.js');
const created: string[] = [];

function mkRepo(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  created.push(dir);
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

function runCli(args: string[]) {
  return spawnSync(process.execPath, [CLI_MAIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 15000,
  });
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

afterEach(() => {
  while (created.length > 0) fs.rmSync(created.pop()!, { recursive: true, force: true });
});

describe('CLI api-contract / api-impact / api-drift', () => {
  it('api-contract --format json prints the route shape and its known consumer', async () => {
    const repoPath = mkRepo('cli-api-contract');
    await writeRepoIndex(repoPath, graphFromSource('src/app.js', SERVER_SOURCE + '\n' + CLIENT_SOURCE));

    const child = runCli(['api-contract', '--method', 'GET', '--route-path', '/users/{}', '--dir', repoPath, '--format', 'json']);
    assert.equal(child.status, 0, child.stderr);
    const payload = JSON.parse(child.stdout) as Array<{ route: { method: string }; consumers: Array<{ consumedKeys: string[] }> }>;
    assert.equal(payload.length, 1);
    assert.equal(payload[0]!.route.method, 'GET');
    assert.deepEqual([...payload[0]!.consumers[0]!.consumedKeys].sort(), ['id', 'ssn']);
  });

  it('api-contract --format json prints an empty array for a route that does not exist', async () => {
    const repoPath = mkRepo('cli-api-contract-empty');
    await writeRepoIndex(repoPath, graphFromSource('src/app.js', SERVER_SOURCE));

    const child = runCli(['api-contract', '--method', 'DELETE', '--route-path', '/does/not/exist', '--dir', repoPath, '--format', 'json']);
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), []);
  });

  it('api-impact --format json reports the resolved consumer as blast radius', async () => {
    const repoPath = mkRepo('cli-api-impact');
    await writeRepoIndex(repoPath, graphFromSource('src/app.js', SERVER_SOURCE + '\n' + CLIENT_SOURCE));

    const child = runCli(['api-impact', '--route-path', '/users/{}', '--dir', repoPath, '--format', 'json']);
    assert.equal(child.status, 0, child.stderr);
    const payload = JSON.parse(child.stdout) as { routes: unknown[]; consumers: unknown[] };
    assert.equal(payload.routes.length, 1);
    assert.equal(payload.consumers.length, 1);
  });

  it('api-drift --format json flags a removed, consumed response field as breaking across two repo checkouts', async () => {
    const basePath = mkRepo('cli-api-drift-base');
    const headPath = mkRepo('cli-api-drift-head');
    await writeRepoIndex(basePath, graphFromSource('src/app.js', SERVER_SOURCE + '\n' + CLIENT_SOURCE));
    await writeRepoIndex(headPath, graphFromSource('src/app.js', HEAD_SERVER_SOURCE + '\n' + CLIENT_SOURCE));

    const child = runCli(['api-drift', '--base-dir', basePath, '--head-dir', headPath, '--format', 'json']);
    assert.equal(child.status, 0, child.stderr);
    const payload = JSON.parse(child.stdout) as { findings: Array<{ rule: string; fieldKey?: string; verdict: string }> };
    const breaking = payload.findings.find((f) => f.rule === 'response-field-removed' && f.fieldKey === 'ssn');
    assert.ok(breaking, `expected a response-field-removed finding among: ${JSON.stringify(payload.findings)}`);
    assert.equal(breaking.verdict, 'breaking');
  });

  it('api-contract --verbose --format json includes matcher instrumentation counters', async () => {
    const repoPath = mkRepo('cli-api-contract-verbose');
    await writeRepoIndex(repoPath, graphFromSource('src/app.js', SERVER_SOURCE + '\n' + CLIENT_SOURCE));

    const child = runCli(['api-contract', '--method', 'GET', '--route-path', '/users/{}', '--dir', repoPath, '--format', 'json', '--verbose']);
    assert.equal(child.status, 0, child.stderr);
    const payload = JSON.parse(child.stdout) as { result: unknown[]; instrumentation: { producerFactCount: number; consumerFactCount: number } };
    assert.equal(payload.result.length, 1);
    assert.equal(payload.instrumentation.producerFactCount, 1);
    assert.equal(payload.instrumentation.consumerFactCount, 1);
  });
});
