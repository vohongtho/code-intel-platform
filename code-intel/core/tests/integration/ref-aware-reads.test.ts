/**
 * Ref-aware reads — an optional `ref` serves read tools from that committed ref's
 * semantic snapshot. These tests prove the isolation contract end to end:
 * two refs can be queried concurrently, results come from the right snapshot,
 * the checkout/HEAD/current index never change, active-generation vectors are
 * never consulted, and failures are boundaries rather than current-state fallbacks.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createKnowledgeGraph } from '../../src/graph/knowledge-graph.js';
import { createApp } from '../../src/http/app.js';
import { dispatchTool, resetRepoGraphCacheForTests } from '../../src/mcp-server/server.js';
import { MCP_TOOL_DEFINITIONS, REF_SELECTABLE_TOOL_NAMES } from '../../src/mcp-server/tool-definitions.js';
import { UsersDB, resetUsersDBForTesting } from '../../src/auth/users-db.js';
import { DbManager } from '../../src/storage/db-manager.js';
import { loadGraphToDB } from '../../src/storage/graph-loader.js';
import { saveMetadata } from '../../src/storage/metadata.js';
import { Bm25Index } from '../../src/search/bm25-index.js';
import { CURRENT_SCHEMA_VERSION } from '../../src/migrations/migration-runner.js';
import { executeSearchRequest } from '../../src/search/execute-scoped-search.js';
import { snapshotIndexView } from '../../src/storage/index-view.js';
import { FULL_SNAPSHOT_CAPABILITIES } from '../../src/snapshots/types.js';
import { getSnapshotsRoot, SNAPSHOT_READ_PINS_DIR } from '../../src/snapshots/paths.js';
import { computeSemanticGraphDiff, summarizeSnapshotBuild } from '../../src/snapshots/service.js';
import { saveGroup } from '../../src/multi-repo/group-registry.js';

type Json = Record<string, any>;

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function parse(result: { content: { text: string }[] }): Json {
  return JSON.parse(result.content[0]!.text) as Json;
}

const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-aware-'));
let base = '';
let head = '';

/** Base has `alphaBase`; head adds `betaHead`. The *current* index has only `currentOnly`. */
async function setupRepo(): Promise<void> {
  git(['init', '--quiet'], REPO);
  git(['config', 'user.email', 'test@example.com'], REPO);
  git(['config', 'user.name', 'Test'], REPO);
  fs.writeFileSync(path.join(REPO, '.gitignore'), '.code-intel/\nusers.db*\n');
  fs.writeFileSync(path.join(REPO, 'index.ts'), 'export function alphaBase() { return 1; }\n');
  git(['add', '.'], REPO);
  git(['commit', '--quiet', '-m', 'base'], REPO);
  base = git(['rev-parse', 'HEAD'], REPO);
  fs.writeFileSync(path.join(REPO, 'index.ts'), 'export function alphaBase() { return 1; }\nexport function betaHead() { return alphaBase(); }\n');
  git(['add', '.'], REPO);
  git(['commit', '--quiet', '-m', 'head'], REPO);
  head = git(['rev-parse', 'HEAD'], REPO);
  git(['branch', 'feature/x', head], REPO);

  const graph = createKnowledgeGraph();
  graph.addNode({ id: 'cur', kind: 'function', name: 'currentOnly', filePath: 'index.ts', startLine: 1, content: 'export function currentOnly() {}' });
  const indexDir = path.join(REPO, '.code-intel');
  fs.mkdirSync(indexDir, { recursive: true });
  const db = new DbManager(path.join(indexDir, 'graph.db'));
  await db.init();
  await loadGraphToDB(graph, db);
  db.close();
  new Bm25Index(path.join(indexDir, 'bm25.db')).build(graph);
  // A deliberately corrupt active vector index: consulting it would surface as a
  // vector *query failure*, which is distinguishable from "this view has no vectors".
  fs.writeFileSync(path.join(indexDir, 'vector.db'), 'not a sqlite database');
  saveMetadata(REPO, {
    indexedAt: new Date().toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    indexVersion: 'current-v1',
    stats: { nodes: graph.size.nodes, edges: graph.size.edges, files: 1, duration: 0 },
    embeddings: { enabled: true, status: 'ready', model: 'test', dimension: 4 } as never,
  });
}

function repoState() {
  return {
    head: git(['rev-parse', 'HEAD'], REPO),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], REPO),
    status: git(['status', '--porcelain'], REPO),
    graphDb: sha256(path.join(REPO, '.code-intel', 'graph.db')),
    bm25Db: sha256(path.join(REPO, '.code-intel', 'bm25.db')),
    meta: sha256(path.join(REPO, '.code-intel', 'meta.json')),
    hasGenerationPointer: fs.existsSync(path.join(REPO, '.code-intel', 'current.json')),
  };
}

before(setupRepo);
after(() => fs.rmSync(REPO, { recursive: true, force: true }));

describe('MCP ref-aware reads', { timeout: 300_000 }, () => {
  it('advertises ref only on ref-capable read tools', () => {
    for (const tool of MCP_TOOL_DEFINITIONS) {
      const props = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      assert.equal('ref' in props, REF_SELECTABLE_TOOL_NAMES.has(tool.name), tool.name);
    }
    for (const name of ['graph_diff', 'pr_impact', 'detect_changes', 'taint_trace', 'secrets', 'change_workflow']) {
      assert.equal(REF_SELECTABLE_TOOL_NAMES.has(name), false, name);
    }
  });

  it('queries two refs concurrently from their own snapshots without touching checkout or current index', async () => {
    resetRepoGraphCacheForTests();
    const before = repoState();
    const graph = createKnowledgeGraph();
    const call = (args: Json) => dispatchTool('search', args, graph, 'ref-aware', REPO);

    const [baseRes, headRes, branchRes] = await Promise.all([
      call({ query: 'betaHead alphaBase', ref: base, mode: 'vector' }),
      call({ query: 'betaHead alphaBase', ref: head, mode: 'vector' }),
      call({ query: 'betaHead', ref: 'feature/x', mode: 'hybrid' }),
    ]);
    for (const res of [baseRes, headRes, branchRes]) assert.notEqual(res.isError, true, res.content[0]?.text);
    const [b, h, f] = [parse(baseRes), parse(headRes), parse(branchRes)];
    const names = (body: Json) => (body.results as Json[]).map((r) => r.name);

    assert.ok(names(b).includes('alphaBase'));
    assert.equal(names(b).includes('betaHead'), false, 'base snapshot must not contain head-only symbols');
    assert.ok(names(h).includes('betaHead'));
    assert.ok(names(f).includes('betaHead'));
    for (const body of [b, h, f]) assert.equal(names(body).includes('currentOnly'), false, 'no current-index results in a ref view');

    assert.equal(b.indexView.kind, 'semantic-snapshot');
    assert.equal(b.indexView.commit, base);
    assert.equal(h.indexView.commit, head);
    assert.notEqual(b.indexView.identity, h.indexView.identity);
    assert.equal(f.indexView.identity, h.indexView.identity, 'same tree ⇒ same snapshot');

    // Requested vs actual mode: the snapshot has no vectors and the active one is never consulted.
    for (const body of [b, h]) {
      assert.equal(body.requestedMode, 'vector');
      assert.equal(body.actualMode, 'bm25');
      assert.equal(body.vectorReady, false);
      assert.equal(body.fallbackReason, 'VECTOR_INDEX_UNAVAILABLE');
      assert.equal(body.indexView.capabilities.vector, false);
    }

    assert.deepEqual(repoState(), before, 'checkout, HEAD and current index must be unchanged');
    const pins = path.join(getSnapshotsRoot(REPO), SNAPSHOT_READ_PINS_DIR);
    assert.deepEqual(fs.existsSync(pins) ? fs.readdirSync(pins) : [], [], 'every read pin is released');
  });

  it('omitting ref keeps current-index behavior', async () => {
    resetRepoGraphCacheForTests();
    const res = await dispatchTool('search', { query: 'currentOnly' }, createKnowledgeGraph(), 'ref-aware', REPO);
    const body = parse(res);
    assert.ok((body.results as Json[]).some((r) => r.name === 'currentOnly'));
    assert.equal(body.indexView, undefined);
  });

  it('serves graph tools at a ref and attaches indexView', async () => {
    const graph = createKnowledgeGraph();
    const inspect = parse(await dispatchTool('inspect', { symbol_name: 'betaHead', ref: head }, graph, 'ref-aware', REPO));
    assert.equal(inspect.node.name, 'betaHead');
    assert.equal(inspect.indexView.commit, head);
    const missing = await dispatchTool('inspect', { symbol_name: 'betaHead', ref: base }, graph, 'ref-aware', REPO);
    assert.match(missing.content[0]!.text, /not found/);
    assert.equal(JSON.parse(missing.content.at(-1)!.text).indexView.commit, base);
    const overview = parse(await dispatchTool('overview', { ref: base }, graph, 'ref-aware', REPO));
    assert.equal(overview.indexView.commit, base);
  });

  it('unknown ref and unsupported tools fail as boundaries, never current-state answers', async () => {
    const graph = createKnowledgeGraph();
    const unknown = await dispatchTool('search', { query: 'currentOnly', ref: 'no-such-branch' }, graph, 'ref-aware', REPO);
    assert.equal(unknown.isError, true);
    assert.equal(parse(unknown).boundary, 'unknown-ref');
    assert.doesNotMatch(unknown.content[0]!.text, /currentOnly"/);

    const unsupported = await dispatchTool('graph_diff', { base_ref: base, head_ref: head, ref: head }, graph, 'ref-aware', REPO);
    assert.equal(unsupported.isError, true);
    assert.match(parse(unsupported).error, /does not accept ref/);

    const group = await dispatchTool('search', { query: 'x', ref: head, scope: { type: 'group', name: 'g' } }, graph, 'ref-aware', REPO);
    assert.equal(group.isError, true);
  });
});

describe('graph diff selected-index identity', { timeout: 300_000 }, () => {
  it('summarizes each usable side in the same indexView shape read tools use', async () => {
    const { diff, base: b, head: h } = await computeSemanticGraphDiff({ repoDir: REPO, base, head: 'feature/x', includeContracts: false });
    assert.ok(diff);
    const baseView = summarizeSnapshotBuild(b, base);
    const headView = summarizeSnapshotBuild(h, 'feature/x');
    assert.equal(baseView?.identity, diff.base.snapshotId);
    assert.equal(headView?.identity, diff.head.snapshotId);
    assert.equal(headView?.ref, 'feature/x');
    assert.equal(headView?.privacyProfile, 'full');
    assert.equal(summarizeSnapshotBuild({ ...b, status: 'failed', artifactsDir: null }, base), undefined);
  });
});

describe('search isolation for snapshot views', () => {
  it('never reads the active generation BM25/vectors for an isolated view', async () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'n', kind: 'function', name: 'needle', filePath: 'a.ts' });
    const view = snapshotIndexView({
      repositoryRoot: REPO,
      ref: 'x',
      artifactsDir: path.join(os.tmpdir(), 'no-such-snapshot'),
      descriptor: { snapshotId: 'f'.repeat(64) } as never,
      capabilities: { ...FULL_SNAPSHOT_CAPABILITIES, bm25: false, bm25Content: 'none', vector: false },
      resolution: 'cached',
      release: () => {},
    });
    const deps = (indexView: typeof view | undefined) => ({
      repoName: 'ref-aware',
      workspaceRoot: REPO,
      ensureBm25Index: () => { if (indexView) throw new Error('active BM25 consulted'); return null; },
      getGraphForRepo: async () => graph,
      // The active generation's (corrupt) vector path is offered; an isolated view must ignore it.
      getRepoSearchContext: async () => ({ graph, bm25Index: null, vectorDbPath: path.join(REPO, '.code-intel', 'vector.db'), indexView }),
    });

    const isolated = await executeSearchRequest({ query: 'needle', mode: 'vector' }, deps(view));
    assert.ok('body' in isolated && isolated.body);
    assert.equal(isolated.body.actualMode, 'bm25');
    assert.equal(isolated.body.fallbackReason, 'VECTOR_INDEX_UNAVAILABLE');
    assert.equal((isolated.body as Json).indexView.identity, 'f'.repeat(64));

    // Control: without the view the same offered vector path *is* consulted (and fails).
    const control = await executeSearchRequest({ query: 'needle', mode: 'vector' }, deps(undefined));
    assert.ok('body' in control && control.body);
    assert.notEqual(control.body.fallbackReason, 'VECTOR_INDEX_UNAVAILABLE', 'probe must distinguish consulted vs ignored');
  });
});

describe('HTTP ref-aware reads', { timeout: 300_000 }, () => {
  let server: http.Server;
  let analyst = '';
  let viewer = '';
  let scopedOther = '';
  let scopedSelf = '';
  let previousUsersDbPath: string | undefined;

  function request(method: string, route: string, bearer: string, payload?: unknown, extraHeaders: Record<string, string> = {}): Promise<{ status: number; body: Json; setCookie: string[] }> {
    return new Promise((resolve, reject) => {
      const addr = server.address() as { port: number };
      const data = payload === undefined ? undefined : JSON.stringify(payload);
      const r = http.request({
        hostname: '127.0.0.1', port: addr.port, path: route, method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}`, ...(data ? { 'Content-Length': Buffer.byteLength(data).toString() } : {}), ...extraHeaders },
      }, (res) => {
        let out = '';
        res.on('data', (c: Buffer) => { out += c.toString(); });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: out ? JSON.parse(out) : {}, setCookie: res.headers['set-cookie'] ?? [] }));
      });
      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });
  }

  async function post(route: string, bearer: string, payload: unknown) {
    const guard = await request('GET', '/auth/csrf-token', bearer);
    const cookie = guard.setCookie.map((c) => c.split(';')[0]).join('; ');
    return request('POST', route, bearer, payload, { 'x-csrf-token': String(guard.body['csrfToken'] ?? ''), Cookie: cookie });
  }

  before(() => {
    previousUsersDbPath = process.env['CODE_INTEL_USERS_DB_PATH'];
    process.env['CODE_INTEL_USERS_DB_PATH'] = path.join(REPO, 'users.db');
    resetUsersDBForTesting();
    const usersDb = new UsersDB(path.join(REPO, 'users.db'));
    analyst = usersDb.createToken('ref-analyst', 'analyst').rawToken;
    viewer = usersDb.createToken('ref-viewer', 'viewer').rawToken;
    scopedOther = usersDb.createToken('ref-scoped-other', 'viewer', undefined, ['some-other-repo']).rawToken;
    scopedSelf = usersDb.createToken('ref-scoped-self', 'viewer', undefined, ['ref-aware']).rawToken;
    // The served in-memory graph mirrors the current index (only `currentOnly`).
    const currentGraph = createKnowledgeGraph();
    currentGraph.addNode({ id: 'cur', kind: 'function', name: 'currentOnly', filePath: 'index.ts', startLine: 1 });
    server = http.createServer(createApp(currentGraph, 'ref-aware', REPO));
    return new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });
  after(() => {
    server.close();
    if (previousUsersDbPath === undefined) delete process.env['CODE_INTEL_USERS_DB_PATH'];
    else process.env['CODE_INTEL_USERS_DB_PATH'] = previousUsersDbPath;
    resetUsersDBForTesting();
  });

  it('viewers get cache-only refs; analysts may build; responses carry indexView', async () => {
    const flowsViewer = await request('GET', `/api/v1/flows?ref=${encodeURIComponent('feature/x')}`, viewer);
    assert.equal(flowsViewer.status, 200, JSON.stringify(flowsViewer.body));
    assert.equal(flowsViewer.body.indexView.commit, head, 'cached snapshot (built by MCP suite) is served to viewers');

    const unknown = await request('GET', '/api/v1/clusters?ref=no-such-branch', analyst);
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error.boundary, 'unknown-ref');

    const nodes = await request('GET', `/api/v1/graph/ref-aware/nodes?ref=${base}`, analyst);
    assert.equal(nodes.status, 200, JSON.stringify(nodes.body));
    assert.ok((nodes.body.nodes as Json[]).some((n) => n.name === 'alphaBase'));
    assert.equal((nodes.body.nodes as Json[]).some((n) => n.name === 'currentOnly'), false);
    assert.equal(nodes.body.indexView.commit, base);

    const current = await request('GET', '/api/v1/flows', viewer);
    assert.equal(current.status, 200);
    assert.equal(current.body.indexView, undefined, 'no ref → unchanged current behavior');
  });

  it('POST search/explore/blast-radius and GET nodes/:id honor ref and never fall back', async () => {
    const searchBase = await post('/api/v1/search', analyst, { query: 'betaHead alphaBase', ref: base, mode: 'vector' });
    assert.equal(searchBase.status, 200, JSON.stringify(searchBase.body));
    const baseNames = (searchBase.body.results as Json[]).map((r) => r.name);
    assert.ok(baseNames.includes('alphaBase'));
    assert.equal(baseNames.includes('betaHead'), false);
    assert.equal(baseNames.includes('currentOnly'), false);
    assert.equal(searchBase.body.indexView.commit, base);
    assert.equal(searchBase.body.actualMode, 'bm25');
    assert.equal(searchBase.body.fallbackReason, 'VECTOR_INDEX_UNAVAILABLE');

    const searchCurrent = await post('/api/v1/search', analyst, { query: 'currentOnly' });
    assert.equal(searchCurrent.status, 200, `searchCurrent ${JSON.stringify(searchCurrent.body)}`);
    assert.ok((searchCurrent.body.results as Json[]).some((r) => r.name === 'currentOnly'));
    assert.equal(searchCurrent.body.indexView, undefined);

    const searchGroup = await post('/api/v1/search', analyst, { query: 'x', ref: base, scope: { type: 'group', name: 'g' } });
    assert.equal(searchGroup.status, 400);
    const searchUnknown = await post('/api/v1/search', analyst, { query: 'x', ref: 'no-such-branch' });
    assert.equal(searchUnknown.status, 404);
    assert.equal(searchUnknown.body.error.boundary, 'unknown-ref');
    const searchBadRef = await post('/api/v1/search', analyst, { query: 'x', ref: '' });
    assert.equal(searchBadRef.status, 400);

    const explore = await post('/api/v1/explore', analyst, { task: 'how does betaHead call alphaBase', ref: head });
    assert.equal(explore.status, 200, JSON.stringify(explore.body));
    assert.equal(explore.body.indexView.commit, head);
    assert.ok((explore.body.capabilities.degraded as string[]).some((d) => d.includes('not the working tree')));
    assert.equal(JSON.stringify(explore.body).includes('currentOnly'), false);

    const node = await request('GET', `/api/v1/nodes/${encodeURIComponent('function:index.ts:betaHead')}?ref=${head}`, analyst);
    assert.equal(node.status, 200, JSON.stringify(node.body));
    assert.equal(node.body.node.name, 'betaHead');
    assert.equal(node.body.indexView.commit, head);
    const nodeAtBase = await request('GET', `/api/v1/nodes/${encodeURIComponent('function:index.ts:betaHead')}?ref=${base}`, analyst);
    assert.equal(nodeAtBase.status, 404, 'betaHead does not exist at base');

    const blast = await post('/api/v1/blast-radius', analyst, { target: 'alphaBase', ref: head });
    assert.equal(blast.status, 200, JSON.stringify(blast.body));
    assert.equal(blast.body.indexView.commit, head);
    const blastBase = await post('/api/v1/blast-radius', analyst, { target: 'betaHead', ref: base });
    assert.equal(blastBase.status, 404, 'symbol missing at base is not answered from the current index');
    const blastCurrent = await post('/api/v1/blast-radius', analyst, { target: 'currentOnly' });
    assert.equal(blastCurrent.status, 200, `blastCurrent ${JSON.stringify(blastCurrent.body)}`);
    assert.equal(blastCurrent.body.indexView, undefined);

    const pins = path.join(getSnapshotsRoot(REPO), SNAPSHOT_READ_PINS_DIR);
    assert.deepEqual(fs.existsSync(pins) ? fs.readdirSync(pins) : [], [], 'every HTTP read pin is released');
  });

  it('a repo-scoped token cannot read another repository at a ref', async () => {
    // Cache the snapshot first, so a missing scope check would actually leak data (200), not 404.
    assert.equal((await request('GET', `/api/v1/flows?ref=${head}`, analyst)).status, 200);
    for (const route of [`/api/v1/flows?ref=${head}`, `/api/v1/clusters?ref=${head}`, `/api/v1/nodes/${encodeURIComponent('function:index.ts:betaHead')}?ref=${head}`]) {
      const denied = await request('GET', route, scopedOther);
      assert.equal(denied.status, 403, `${route}: ${JSON.stringify(denied.body)}`);
      const allowed = await request('GET', route, scopedSelf);
      assert.equal(allowed.status, 200, `${route}: ${JSON.stringify(allowed.body)}`);
    }
    const deniedSearch = await post('/api/v1/search', scopedOther, { query: 'betaHead', ref: head });
    assert.equal(deniedSearch.status, 403);
    const deniedBlast = await post('/api/v1/blast-radius', scopedOther, { target: 'alphaBase', ref: head });
    assert.equal(deniedBlast.status, 403);
    const deniedExplore = await post('/api/v1/explore', scopedOther, { task: 'x', ref: head });
    assert.equal(deniedExplore.status, 403);
  });

  it('a repo-scoped token cannot read another repository\'s current index either', async () => {
    for (const route of ['/api/v1/flows', '/api/v1/clusters', `/api/v1/nodes/${encodeURIComponent('cur')}`]) {
      const denied = await request('GET', route, scopedOther);
      assert.equal(denied.status, 403, `${route}: ${JSON.stringify(denied.body)}`);
      const allowed = await request('GET', route, scopedSelf);
      assert.equal(allowed.status, 200, `${route}: ${JSON.stringify(allowed.body)}`);
    }
    for (const route of ['/api/v1/search', '/api/v1/vector-search']) {
      assert.equal((await post(route, scopedOther, { query: 'currentOnly' })).status, 403, route);
      assert.equal((await post(route, scopedSelf, { query: 'currentOnly' })).status, 200, route);
    }
    assert.equal((await post('/api/v1/search', scopedOther, { query: 'x', scope: { type: 'group', name: 'no-such-group' } })).status, 404, 'unknown group is still 404');
    assert.equal((await post('/api/v1/blast-radius', scopedOther, { target: 'currentOnly' })).status, 403);
    assert.equal((await post('/api/v1/blast-radius', scopedSelf, { target: 'currentOnly' })).status, 200);
    // Unscoped viewers and analysts keep full access (unchanged behavior).
    assert.equal((await request('GET', '/api/v1/flows', viewer)).status, 200);
    assert.equal((await post('/api/v1/search', analyst, { query: 'currentOnly' })).status, 200);
  });

  it('group routes require every member repository to be in a scoped token\'s scope', async () => {
    saveGroup({ name: 'scope-foreign', createdAt: new Date(0).toISOString(), members: [{ repoId: 'some-other-repo', registryName: 'other', groupPath: 'other' }] });
    saveGroup({ name: 'scope-mixed', createdAt: new Date(0).toISOString(), members: [
      { repoId: 'ref-aware', registryName: 'ref-aware', groupPath: 'self' },
      { repoId: 'some-other-repo', registryName: 'other', groupPath: 'other' },
    ] });
    saveGroup({ name: 'scope-own', createdAt: new Date(0).toISOString(), members: [{ repoId: 'ref-aware', registryName: 'ref-aware', groupPath: 'self' }] });

    const gets = (g: string) => [`/api/v1/groups/${g}`, `/api/v1/groups/${g}/contracts`, `/api/v1/groups/${g}/graph`, `/api/v1/groups/${g}/topology`, `/api/v1/groups/${g}/drift?base_ref=a&head_ref=b`];
    for (const g of ['scope-foreign', 'scope-mixed']) {
      for (const route of gets(g)) assert.equal((await request('GET', route, scopedSelf)).status, 403, route);
      assert.equal((await post(`/api/v1/groups/${g}/search`, scopedSelf, { query: 'x' })).status, 403, `${g} search`);
      assert.equal((await post(`/api/v1/groups/${g}/sync`, scopedSelf, {})).status, 403, `${g} sync`);
      assert.equal((await post('/api/v1/search', scopedSelf, { query: 'x', scope: { type: 'group', name: g } })).status, 403, `${g} scoped search`);
    }
    for (const route of gets('scope-own')) assert.notEqual((await request('GET', route, scopedSelf)).status, 403, route);
    assert.notEqual((await post('/api/v1/groups/scope-own/search', scopedSelf, { query: 'x' })).status, 403);
    for (const route of gets('scope-foreign')) assert.notEqual((await request('GET', route, analyst)).status, 403, `analyst ${route}`);
    assert.equal((await request('GET', '/api/v1/groups/no-such-group/graph', scopedSelf)).status, 404, 'unknown group stays 404');
  });

  it('a viewer cannot trigger a snapshot build', async () => {
    fs.writeFileSync(path.join(REPO, 'extra.ts'), 'export const gamma = 3;\n');
    git(['add', 'extra.ts'], REPO);
    git(['commit', '--quiet', '-m', 'gamma'], REPO);
    const gammaCommit = git(['rev-parse', 'HEAD'], REPO);
    const res = await request('GET', `/api/v1/clusters?ref=${gammaCommit}`, viewer);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.boundary, 'snapshot-not-built');
  });
});
