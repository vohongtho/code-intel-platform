/**
 * End-to-end fixture for cross-repository contract drift: four real temp Git repositories
 * (task 9.1) wired into one synchronized group. Base/head snapshot directories are keyed by
 * the real commit SHA for each ref and populated from real Express/fetch adapter extraction
 * (route/consumer content) plus real parsed field content (schema/event) — see
 * group-contract-drift-service.test.ts for the lighter-weight unit tests covering individual
 * comparator rules from the same kind of hand-assembled snapshot graph.
 *
 * This does NOT route base/head through `getOrBuildSnapshot`'s full checkout-and-reanalyze
 * pipeline. Two independent, pre-existing gaps in that pipeline make it unusable here today,
 * discovered while building this fixture:
 *   1. A minimal repo with an unresolved `require('express')` import reliably fails the
 *      snapshot read-back verification gate (`snapshot-builder.ts`) — "graph read-back (N)
 *      smaller than produced (M)" — because `producedCount` is captured at parse-phase,
 *      before later phases can legitimately drop nodes/edges referencing an unresolved import.
 *   2. The real TypeScript parser's newer symbol-identity-v2 path (`identityFingerprint:
 *      'symbol-identity-v2'` in parse-phase.ts) produces `interface`/`type_alias` nodes with
 *      no `content` and no per-property child nodes at all — only `file` and function-like
 *      nodes carry `content`. `parseStructuredFields()` (contract-drift/common.ts), which
 *      every schema/event comparator depends on, therefore cannot see field-level data for a
 *      genuinely-parsed interface — only for hand-built graph nodes that set `content`
 *      directly, which is what every existing schema/event drift test (including this one)
 *      does. This means schema/event contract drift does not yet work against real parsed
 *      TypeScript in production; it is a gap in the parser/symbol-identity output, not in the
 *      comparator logic, and is out of scope for this change to fix (see the parallel
 *      `v1-0-11-symbol-identity-v2` OpenSpec change).
 *
 * Roles (task 9.1): `backend` is the HTTP route producer and event publisher; `frontend` is
 * the HTTP consumer and a schema consumer; `shared-schema` is the schema producer; `worker`
 * is the event subscriber.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { KnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { DbManager } from '../../../src/storage/db-manager.js';
import { loadGraphToDB } from '../../../src/storage/graph-loader.js';
import { saveRegistry } from '../../../src/storage/repo-registry.js';
import { saveGroup, saveSyncResult, deleteGroup } from '../../../src/multi-repo/group-registry.js';
import { syncGroup } from '../../../src/multi-repo/group-sync.js';
import { getGroupContractDrift } from '../../../src/multi-repo/contract-drift/service.js';
import { projectFactBundle } from '../../../src/semantic/graph-projector.js';
import { createFactBundle, FACT_SCHEMA_VERSION } from '../../../src/semantic/fact-bundle.js';
import { expressFrameworkAdapter } from '../../../src/frameworks/adapters/express.js';
import { fetchConsumerAdapter } from '../../../src/semantic/api-contracts/consumers/fetch.js';
import { Language } from '../../../src/shared/languages.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function mkRepoDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  fs.mkdirSync(path.join(dir, '.code-intel'), { recursive: true });
  git(['init', '--quiet'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  return dir;
}

function commit(dir: string, files: Record<string, string>, message: string): string {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  git(['add', '.'], dir);
  git(['commit', '--quiet', '-m', message], dir);
  return git(['rev-parse', 'HEAD'], dir);
}

/** Builds the "live" analyzed graph (what `code-intel analyze` would leave in .code-intel/graph.db)
 * from real Express/fetch adapter extraction, plus hand-added schema/event interface nodes — the
 * same combination group-sync-api-contracts.test.ts already validates for the route/consumer half. */
function liveGraph(input: {
  routeSource?: { filePath: string; source: string };
  consumerSource?: { filePath: string; source: string };
  schemaOrEvent?: { id: string; name: string; filePath: string; content: string };
}): KnowledgeGraph {
  const graph = createKnowledgeGraph();
  const filePaths: string[] = [];
  const fileCache = new Map<string, string>();
  if (input.routeSource) { filePaths.push(input.routeSource.filePath); fileCache.set(input.routeSource.filePath, input.routeSource.source); }
  if (input.consumerSource) { filePaths.push(input.consumerSource.filePath); fileCache.set(input.consumerSource.filePath, input.consumerSource.source); }
  if (filePaths.length > 0) {
    const view = { workspaceRoot: '/repo', filePaths, fileCache };
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
  }
  if (input.schemaOrEvent) {
    graph.addNode({
      id: input.schemaOrEvent.id,
      identityId: input.schemaOrEvent.id,
      kind: 'interface',
      name: input.schemaOrEvent.name,
      filePath: input.schemaOrEvent.filePath,
      content: input.schemaOrEvent.content,
      exported: true,
      metadata: {},
    });
  }
  return graph;
}

async function writeLiveIndex(repoPath: string, graph: KnowledgeGraph): Promise<void> {
  const db = new DbManager(path.join(repoPath, '.code-intel', 'graph.db'));
  await db.init();
  await loadGraphToDB(graph, db);
  db.close();
}

/** Writes a snapshot directory keyed by a real commit SHA, matching what `getGroupContractDrift`
 * expects when callers pass explicit snapshot ids (`buildOrLoadRepoState` in
 * contract-drift/service.ts loads `.code-intel/snapshots/<id>/graph.db` directly). */
async function writeCommitSnapshot(repoPath: string, commitSha: string, graph: KnowledgeGraph): Promise<void> {
  const dir = path.join(repoPath, '.code-intel', 'snapshots', commitSha);
  fs.mkdirSync(dir, { recursive: true });
  const db = new DbManager(path.join(dir, 'graph.db'));
  await db.init();
  await loadGraphToDB(graph, db);
  db.close();
}

const BACKEND_BASE = [
  "const express = require('express');",
  'const app = express();',
  "app.get('/users/:id', getUser);",
  'function getUser(req, res) {',
  "  res.status(200).json({ id: req.params.id, name: 'x', ssn: '000' });",
  '}',
].join('\n');

const BACKEND_HEAD_BREAKING = [
  "const express = require('express');",
  'const app = express();',
  "app.get('/users/:id', getUser);",
  'function getUser(req, res) {',
  "  res.status(200).json({ id: req.params.id, name: 'x' });", // ssn removed
  '}',
].join('\n');

const FRONTEND_SOURCE = [
  'async function loadUser(id) {',
  "  const response = await fetch(`/users/${id}`);",
  '  const { id: userId, name, ssn } = await response.json();',
  '  return { userId, name, ssn };',
  '}',
].join('\n');

const SCHEMA_BASE = 'export interface UserSchema {\n  id: string;\n  email: string;\n}\n';
const SCHEMA_HEAD_BREAKING = 'export interface UserSchema {\n  id: string;\n}\n'; // email removed

const EVENT_BASE = 'export interface UserUpdatedEvent {\n  id: string;\n  status: string;\n}\n';
const EVENT_HEAD_BREAKING = 'export interface UserUpdatedEvent {\n  id: string;\n}\n'; // status removed

describe('cross-repository contract drift — real 4-repo group fixture', () => {
  it('surfaces breaking HTTP, schema, and event findings across the full group in one drift call', async () => {
    const backendDir = mkRepoDir('drift-fixture-backend');
    const frontendDir = mkRepoDir('drift-fixture-frontend');
    const sharedSchemaDir = mkRepoDir('drift-fixture-shared-schema');
    const workerDir = mkRepoDir('drift-fixture-worker');
    const groupName = 'drift-fixture-group';

    try {
      const backendBaseCommit = commit(backendDir, { 'src/app.js': BACKEND_BASE, 'src/events.ts': EVENT_BASE }, 'base');
      const backendHeadCommit = commit(backendDir, { 'src/app.js': BACKEND_HEAD_BREAKING, 'src/events.ts': EVENT_HEAD_BREAKING }, 'head');

      // frontend itself does not change between base/head — one commit serves as both refs.
      const frontendHeadCommit = commit(frontendDir, { 'src/client.js': FRONTEND_SOURCE }, 'base');

      const sharedSchemaCommit = commit(sharedSchemaDir, { 'src/user.ts': SCHEMA_BASE }, 'base');
      const sharedSchemaHeadCommit = commit(sharedSchemaDir, { 'src/user.ts': SCHEMA_HEAD_BREAKING }, 'head');

      const workerCommit = commit(workerDir, { 'src/subscriber.ts': 'export interface UserUpdatedEvent {\n  id: string;\n  status: string;\n}\n' }, 'base');

      saveRegistry([
        { id: 'backend', name: 'backend', path: backendDir, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 1, files: 1 } },
        { id: 'frontend', name: 'frontend', path: frontendDir, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 1, files: 1 } },
        { id: 'shared-schema', name: 'shared-schema', path: sharedSchemaDir, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 0, files: 1 } },
        { id: 'worker', name: 'worker', path: workerDir, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 0, files: 1 } },
      ]);

      // "Live" index = current (head) analyzed state — what group_sync reads to build the
      // consumer index/links used to resolve affected consumers for drift findings.
      await writeLiveIndex(backendDir, liveGraph({
        routeSource: { filePath: 'src/app.js', source: BACKEND_HEAD_BREAKING },
        schemaOrEvent: { id: 'event-node', name: 'UserUpdatedEvent', filePath: 'src/events.ts', content: EVENT_HEAD_BREAKING },
      }));
      await writeLiveIndex(frontendDir, liveGraph({
        consumerSource: { filePath: 'src/client.js', source: FRONTEND_SOURCE },
        schemaOrEvent: { id: 'schema-consumer-node', name: 'UserSchema', filePath: 'src/user-consumer.ts', content: 'export interface UserSchema {\n  id: string;\n}\n' },
      }));
      await writeLiveIndex(sharedSchemaDir, liveGraph({
        schemaOrEvent: { id: 'schema-node', name: 'UserSchema', filePath: 'src/user.ts', content: SCHEMA_HEAD_BREAKING },
      }));
      await writeLiveIndex(workerDir, liveGraph({
        schemaOrEvent: { id: 'event-subscriber-node', name: 'UserUpdatedEvent', filePath: 'src/subscriber.ts', content: EVENT_HEAD_BREAKING },
      }));

      // Base/head drift snapshots, keyed by the real commit each ref resolves to.
      await writeCommitSnapshot(backendDir, backendBaseCommit, liveGraph({
        routeSource: { filePath: 'src/app.js', source: BACKEND_BASE },
        schemaOrEvent: { id: 'event-node', name: 'UserUpdatedEvent', filePath: 'src/events.ts', content: EVENT_BASE },
      }));
      await writeCommitSnapshot(backendDir, backendHeadCommit, liveGraph({
        routeSource: { filePath: 'src/app.js', source: BACKEND_HEAD_BREAKING },
        schemaOrEvent: { id: 'event-node', name: 'UserUpdatedEvent', filePath: 'src/events.ts', content: EVENT_HEAD_BREAKING },
      }));
      await writeCommitSnapshot(frontendDir, frontendHeadCommit, liveGraph({
        consumerSource: { filePath: 'src/client.js', source: FRONTEND_SOURCE },
        schemaOrEvent: { id: 'schema-consumer-node', name: 'UserSchema', filePath: 'src/user-consumer.ts', content: 'export interface UserSchema {\n  id: string;\n}\n' },
      }));
      await writeCommitSnapshot(sharedSchemaDir, sharedSchemaCommit, liveGraph({
        schemaOrEvent: { id: 'schema-node', name: 'UserSchema', filePath: 'src/user.ts', content: SCHEMA_BASE },
      }));
      await writeCommitSnapshot(sharedSchemaDir, sharedSchemaHeadCommit, liveGraph({
        schemaOrEvent: { id: 'schema-node', name: 'UserSchema', filePath: 'src/user.ts', content: SCHEMA_HEAD_BREAKING },
      }));
      await writeCommitSnapshot(workerDir, workerCommit, liveGraph({
        schemaOrEvent: { id: 'event-subscriber-node', name: 'UserUpdatedEvent', filePath: 'src/subscriber.ts', content: EVENT_BASE },
      }));

      const group = {
        name: groupName,
        createdAt: new Date().toISOString(),
        members: [
          { groupPath: 'backend', repoId: 'backend', registryName: 'backend' },
          { groupPath: 'frontend', repoId: 'frontend', registryName: 'frontend' },
          { groupPath: 'shared-schema', repoId: 'shared-schema', registryName: 'shared-schema' },
          { groupPath: 'worker', repoId: 'worker', registryName: 'worker' },
        ],
      };
      deleteGroup(groupName);
      saveGroup(group);
      const syncResult = await syncGroup(group);
      saveSyncResult(syncResult);

      const drift = await getGroupContractDrift({
        groupName,
        baseSnapshotIds: {
          backend: backendBaseCommit,
          frontend: frontendHeadCommit,
          'shared-schema': sharedSchemaCommit,
          worker: workerCommit,
        },
        headSnapshotIds: {
          backend: backendHeadCommit,
          frontend: frontendHeadCommit,
          'shared-schema': sharedSchemaHeadCommit,
          worker: workerCommit,
        },
        allowCache: false,
      });

      const httpBreaking = drift.findings.find((f) => f.changeKind === 'response-field-removed' && f.repositoryId === 'backend');
      assert.ok(httpBreaking, `expected an HTTP response-field-removed finding among: ${JSON.stringify(drift.findings, null, 2)}`);
      assert.equal(httpBreaking!.compatibility, 'breaking');

      const schemaBreaking = drift.findings.find((f) => f.changeKind === 'schema-property-removed' && f.repositoryId === 'shared-schema');
      assert.ok(schemaBreaking, `expected a schema-property-removed finding among: ${JSON.stringify(drift.findings, null, 2)}`);

      const eventBreaking = drift.findings.find((f) => f.changeKind === 'event-payload-field-removed' && f.repositoryId === 'backend');
      assert.ok(eventBreaking, `expected an event-payload-field-removed finding among: ${JSON.stringify(drift.findings, null, 2)}`);
    } finally {
      deleteGroup(groupName);
      fs.rmSync(backendDir, { recursive: true, force: true });
      fs.rmSync(frontendDir, { recursive: true, force: true });
      fs.rmSync(sharedSchemaDir, { recursive: true, force: true });
      fs.rmSync(workerDir, { recursive: true, force: true });
    }
  });
});
