import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createKnowledgeGraph } from '../../src/graph/knowledge-graph.js';
import { createApp } from '../../src/http/app.js';
import { UsersDB, resetUsersDBForTesting } from '../../src/auth/users-db.js';
import { startWorkflow } from '../../src/agents/workflows/session-service.js';

const CORE_ROOT = path.resolve(import.meta.dirname, '../../..');
const CLI_MAIN = path.join(CORE_ROOT, 'dist-tests', 'src', 'cli', 'main.js');

type Json = Record<string, any>;

function request(server: http.Server, opts: { method: string; route: string; payload?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: Json; setCookie: string[] }> {
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

describe('change workflow — HTTP transport with ownership', () => {
  let root: string;
  let repoDir: string;
  let server: http.Server;
  let usersDb: UsersDB;
  let previousUsersDbPath: string | undefined;
  const bearer: Record<string, string> = {};

  async function call(who: string, method: string, route: string, payload?: unknown) {
    const headers: Record<string, string> = { Authorization: `Bearer ${bearer[who]}` };
    if (method !== 'GET') {
      const guard = await request(server, { method: 'GET', route: '/auth/csrf-token' });
      headers['x-csrf-token'] = String(guard.body['csrfToken'] ?? '');
      headers['Cookie'] = guard.setCookie.map((c) => c.split(';')[0]).join('; ');
    }
    return request(server, { method, route, payload, headers });
  }

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-http-'));
    const home = path.join(root, 'home');
    fs.mkdirSync(home);
    repoDir = path.join(root, 'shop');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'shop', private: true }));
    fs.writeFileSync(path.join(repoDir, '.gitignore'), '.code-intel/\nAGENTS.md\nCLAUDE.md\n.codeintelignore.local\nusers.db*\n');
    fs.writeFileSync(path.join(repoDir, 'src/total.ts'), 'export function total(n: number): number {\n  return n * 2;\n}\n');
    const git = (...args: string[]) => execFileSync('git', ['-C', repoDir, '-c', 'user.email=t@e', '-c', 'user.name=t', ...args]);
    git('init', '-q', '-b', 'main');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    if (!fs.existsSync(path.join(CORE_ROOT, 'dist-tests', 'package.json'))) fs.copyFileSync(path.join(CORE_ROOT, 'package.json'), path.join(CORE_ROOT, 'dist-tests', 'package.json'));
    const analyzed = spawnSync(process.execPath, [CLI_MAIN, 'analyze', repoDir, '--skip-agents-md'], { cwd: CORE_ROOT, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test', HOME: home, USERPROFILE: home } });
    if (analyzed.status !== 0) throw new Error(`analyze failed\n${analyzed.stdout}\n${analyzed.stderr}`);

    previousUsersDbPath = process.env['CODE_INTEL_USERS_DB_PATH'];
    process.env['CODE_INTEL_USERS_DB_PATH'] = path.join(root, 'users.db');
    resetUsersDBForTesting();
    usersDb = new UsersDB(path.join(root, 'users.db'));
    bearer['alice'] = usersDb.createToken('alice', 'analyst').rawToken;
    bearer['bob'] = usersDb.createToken('bob', 'analyst').rawToken;
    bearer['viewer'] = usersDb.createToken('viewer', 'viewer').rawToken;
    bearer['scoped'] = usersDb.createToken('scoped', 'repo-owner', undefined, ['some-other-repo']).rawToken;
    bearer['admin'] = usersDb.createToken('admin', 'admin').rawToken;
    bearer['toolScoped'] = usersDb.createToken('tool-scoped', 'analyst', undefined, undefined, ['search']).rawToken;
    server = http.createServer(createApp(createKnowledgeGraph(), 'shop', repoDir));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(async () => {
    if (previousUsersDbPath === undefined) delete process.env['CODE_INTEL_USERS_DB_PATH'];
    else process.env['CODE_INTEL_USERS_DB_PATH'] = previousUsersDbPath;
    resetUsersDBForTesting();
    usersDb?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('owner can start, read, checkpoint and verify; other users cannot', async () => {
    const started = await call('alice', 'POST', '/api/v1/workflows', { task: 'double the total', targets: ['total'] });
    assert.equal(started.status, 201, JSON.stringify(started.body));
    const id = started.body['sessionId'] as string;
    assert.equal(started.body['phase'], 'ready-for-change');

    const status = await call('alice', 'GET', `/api/v1/workflows/${id}`);
    assert.equal(status.status, 200);
    assert.equal(status.body['sessionId'], id);

    const bobRead = await call('bob', 'GET', `/api/v1/workflows/${id}`);
    assert.equal(bobRead.status, 403);
    assert.match(bobRead.body.error.message, /another user/);
    assert.equal(bobRead.body['plan'], undefined, 'no session content leaks to non-owners');
    assert.equal((await call('bob', 'POST', `/api/v1/workflows/${id}/verify`, {})).status, 403);

    const listedForBob = await call('bob', 'GET', '/api/v1/workflows');
    assert.deepEqual(listedForBob.body['sessions'], []);
    const listedForAlice = await call('alice', 'GET', '/api/v1/workflows');
    assert.ok((listedForAlice.body['sessions'] as Array<{ id: string }>).some((s) => s.id === id));

    const checkpoint = await call('alice', 'POST', `/api/v1/workflows/${id}/checkpoint`, { note: 'about to edit', expected_revision: status.body['revision'] });
    assert.equal(checkpoint.status, 200, JSON.stringify(checkpoint.body));
    const stale = await call('alice', 'POST', `/api/v1/workflows/${id}/checkpoint`, { note: 'stale', expected_revision: status.body['revision'] });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.workflowCode, 'REVISION_CONFLICT');

    const verify = await call('alice', 'POST', `/api/v1/workflows/${id}/verify`, {});
    assert.equal(verify.status, 200, JSON.stringify(verify.body));
    assert.ok(verify.body['verification']);

    // Admins can read any session.
    assert.equal((await call('admin', 'GET', `/api/v1/workflows/${id}`)).status, 200);
  });

  it('enforces role, repository scope and tool scope', async () => {
    assert.equal((await call('viewer', 'POST', '/api/v1/workflows', { task: 'double the total' })).status, 403, 'mutations need analyst');
    const scoped = await call('scoped', 'GET', '/api/v1/workflows');
    assert.equal(scoped.status, 403, 'repo-scoped token without this repo');
    assert.match(scoped.body.error.message, /repository/);
    assert.equal((await call('toolScoped', 'GET', '/api/v1/workflows')).status, 403, 'token not scoped to change_workflow');
  });

  it('sessions created by local transports (CLI/MCP) have no owner and are admin-only over HTTP', async () => {
    const local = await startWorkflow({ task: 'local session', scope: { type: 'repo', repoDir } });
    assert.equal(local.session.owner, undefined);
    const aliceRead = await call('alice', 'GET', `/api/v1/workflows/${local.session.id}`);
    assert.equal(aliceRead.status, 403);
    assert.match(aliceRead.body.error.message, /local transport/);
    assert.equal((await call('admin', 'GET', `/api/v1/workflows/${local.session.id}`)).status, 200);
  });

  it('maps workflow errors to HTTP statuses without exposing internals', async () => {
    assert.equal((await call('alice', 'GET', '/api/v1/workflows/not-an-id')).status, 400);
    assert.equal((await call('alice', 'GET', `/api/v1/workflows/wf_${'0'.repeat(32)}`)).status, 404);
    assert.equal((await call('alice', 'POST', '/api/v1/workflows', {})).status, 400);
    assert.equal((await call('alice', 'GET', '/api/v1/workflows?group=no-such-group')).status, 404);
  });

  it('system flows endpoint requires the group to exist', async () => {
    assert.equal((await call('alice', 'GET', '/api/v1/groups/no-such-group/system-flows')).status, 404);
  });

  it('explore enforces repository access for repo-scoped tokens', async () => {
    const res = await call('scoped', 'POST', '/api/v1/explore', { task: 'double total', repoId: 'shop' });
    assert.equal(res.status, 403);
    const mismatch = await call('alice', 'POST', '/api/v1/explore', { task: 'double total', repoId: 'a', scope: { repoId: 'b' } });
    assert.equal(mismatch.status, 400);
  });
});
