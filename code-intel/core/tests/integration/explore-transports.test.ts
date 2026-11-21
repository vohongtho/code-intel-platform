/**
 * Explore transports — MCP, HTTP and CLI must all call the one orchestrator
 * (query/explore.ts) rather than re-implementing any pipeline step.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeGraph } from '../../src/graph/knowledge-graph.js';
import { createApp } from '../../src/http/app.js';
import { dispatchTool } from '../../src/mcp-server/server.js';
import { MCP_TOOL_DEFINITIONS } from '../../src/mcp-server/tool-definitions.js';
import { UsersDB, resetUsersDBForTesting } from '../../src/auth/users-db.js';
import { DbManager } from '../../src/storage/db-manager.js';
import { loadGraphToDB } from '../../src/storage/graph-loader.js';
import { saveMetadata } from '../../src/storage/metadata.js';
import { Bm25Index, getBm25DbPath } from '../../src/search/bm25-index.js';
import { CURRENT_SCHEMA_VERSION } from '../../src/migrations/migration-runner.js';

// A temp workspace with a published (legacy-layout) index. It is deliberately not added to the
// global repo registry, so the test never touches that shared state.
const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), 'explore-transport-'));
after(() => fs.rmSync(WORKSPACE, { recursive: true, force: true }));

function makeGraph() {
  const graph = createKnowledgeGraph();
  const body = (name: string) => `export function ${name}() {\n${Array.from({ length: 10 }, (_, i) => `  const v${i} = step${i}();`).join('\n')}\n  return ${name}Done();\n}`;
  graph.addNode({ id: 'login', kind: 'function', name: 'loginUser', filePath: 'src/auth/login.ts', startLine: 1, content: body('loginUser') });
  graph.addNode({ id: 'session', kind: 'function', name: 'persistSession', filePath: 'src/auth/session.ts', startLine: 1, content: body('persistSession') });
  graph.addEdge({ id: 'e1', source: 'login', target: 'session', kind: 'calls', certainty: 'exact' });
  return graph;
}

type Json = Record<string, any>;

function requestJson(server: http.Server, opts: { method: string; route: string; payload?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: Json; setCookie: string[] }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const payload = opts.payload === undefined ? undefined : JSON.stringify(opts.payload);
    const r = http.request({
      hostname: '127.0.0.1', port: addr.port, path: opts.route, method: opts.method,
      headers: { 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}), ...(opts.headers ?? {}) },
    }, (res) => {
      let out = '';
      res.on('data', (c: Buffer) => { out += c.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: out ? JSON.parse(out) : {}, setCookie: res.headers['set-cookie'] ?? [] }));
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

// Credential for the isolated users DB created in the HTTP suite's `before`.
let apiBearer = '';

async function postJson(server: http.Server, route: string, payload: unknown): Promise<{ status: number; body: Json }> {
  const guard = await requestJson(server, { method: 'GET', route: '/auth/csrf-token' });
  const guardCookie = guard.setCookie.map((c) => c.split(';')[0]).join('; ');
  return requestJson(server, {
    method: 'POST', route, payload,
    headers: { 'x-csrf-token': String(guard.body['csrfToken'] ?? ''), Cookie: guardCookie, Authorization: `Bearer ${apiBearer}` },
  });
}

async function publishWorkspaceIndex(): Promise<void> {
  const graph = makeGraph();
  fs.mkdirSync(path.join(WORKSPACE, '.code-intel'), { recursive: true });
  const db = new DbManager(path.join(WORKSPACE, '.code-intel', 'graph.db'));
  await db.init();
  await loadGraphToDB(graph, db);
  db.close();
  saveMetadata(WORKSPACE, {
    indexedAt: new Date().toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    indexVersion: 'v1',
    stats: { nodes: graph.size.nodes, edges: graph.size.edges, files: 2, duration: 0 },
  });
  new Bm25Index(getBm25DbPath(WORKSPACE)).build(graph);
}

describe('explore — MCP transport', () => {
  before(publishWorkspaceIndex);

  it('registers the explore tool with the documented schema', () => {
    const tool = MCP_TOOL_DEFINITIONS.find((t) => t.name === 'explore') as { inputSchema: { required: string[]; properties: Record<string, unknown> } } | undefined;
    assert.ok(tool);
    assert.deepEqual(tool!.inputSchema.required, ['task']);
    for (const key of ['task', 'intent', 'max_tokens', 'compression', 'explain_ranking']) assert.ok(key in tool!.inputSchema.properties, key);
  });

  it('returns a bounded explore result through dispatchTool', async () => {
    const res = await dispatchTool('explore', { task: 'loginUser persistSession', max_tokens: 1500 }, makeGraph(), 'test-repo', WORKSPACE);
    assert.ok(!res.isError);
    const out = JSON.parse(res.content[0]!.text);
    assert.equal(out.intent, 'understand');
    assert.ok(out.seeds.length >= 1);
    assert.ok(out.context.blockTokens.total <= 1500);
    assert.equal(out.ranking, undefined);
  });

  it('reports invalid requests as structured errors', async () => {
    const missing = await dispatchTool('explore', {}, makeGraph(), 'test-repo', WORKSPACE);
    assert.equal(missing.isError, true);
    assert.match(JSON.parse(missing.content[0]!.text).error, /Missing task/);
    const bad = await dispatchTool('explore', { task: 'x', intent: 'nope' }, makeGraph(), 'test-repo', WORKSPACE);
    assert.equal(bad.isError, true);
  });
});

describe('explore — HTTP transport', () => {
  let server: http.Server;
  let usersDb: UsersDB;
  let previousUsersDbPath: string | undefined;

  before(() => {
    // Isolated users DB + credential: never depend on whatever account the machine's real home has.
    previousUsersDbPath = process.env['CODE_INTEL_USERS_DB_PATH'];
    process.env['CODE_INTEL_USERS_DB_PATH'] = path.join(WORKSPACE, 'users.db');
    resetUsersDBForTesting();
    usersDb = new UsersDB(path.join(WORKSPACE, 'users.db'));
    apiBearer = usersDb.createToken('explore-transport-test', 'analyst').rawToken;
    server = http.createServer(createApp(makeGraph(), 'test-repo'));
    return new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(() => {
    if (previousUsersDbPath === undefined) delete process.env['CODE_INTEL_USERS_DB_PATH'];
    else process.env['CODE_INTEL_USERS_DB_PATH'] = previousUsersDbPath;
    resetUsersDBForTesting();
    usersDb.close();
    return new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  });

  it('POST /api/v1/explore returns the orchestrator result', async () => {
    const res = await postJson(server, '/api/v1/explore', { task: 'loginUser persistSession', max_tokens: 1500 });
    assert.equal(res.status, 200);
    assert.ok(res.body['seeds'].length >= 1);
    assert.ok(res.body['context'].blockTokens.total <= 1500);
    assert.equal(res.body['capabilities'].alternateRef, 'unavailable');
  });

  it('matches the MCP transport for the same graph and task', async () => {
    const task = 'loginUser persistSession';
    const viaHttp = await postJson(server, '/api/v1/explore', { task, max_tokens: 2000 });
    const mcp = JSON.parse((await dispatchTool('explore', { task, max_tokens: 2000 }, makeGraph(), 'test-repo', WORKSPACE)).content[0]!.text);
    const symbols = (out: Json): string[] => out['seeds'].map((seed: { symbol: string }) => seed.symbol).sort();
    assert.deepEqual(symbols(viaHttp.body), symbols(mcp));
    assert.equal(viaHttp.body['intent'], mcp.intent);
    assert.deepEqual(Object.keys(viaHttp.body).sort(), Object.keys(mcp).sort());
  });

  it('rejects missing task, bad intent and group scope with 400', async () => {
    assert.equal((await postJson(server, '/api/v1/explore', {})).status, 400);
    assert.equal((await postJson(server, '/api/v1/explore', { task: 'x', intent: 'nope' })).status, 400);
    assert.equal((await postJson(server, '/api/v1/explore', { task: 'x', scope: { type: 'group', name: 'g' } })).status, 400);
  });
});

describe('explore — single orchestrator', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

  for (const rel of ['src/mcp-server/server.ts', 'src/http/app.ts', 'src/cli/app.ts']) {
    it(`${rel} calls runExplore and does not re-implement pipeline steps`, () => {
      const source = read(rel);
      assert.match(source, /from '\.\.\/query\/explore\.js'/);
      assert.match(source, /runExplore\(/);
      assert.doesNotMatch(source, /rerankCandidates|planRender\(|graph-reranker|render-policy/);
    });
  }
});
