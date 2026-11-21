import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createKnowledgeGraph } from '../../src/graph/knowledge-graph.js';
import { createApp } from '../../src/http/app.js';
import { UsersDB, resetUsersDBForTesting } from '../../src/auth/users-db.js';
import { dispatchTool } from '../../src/mcp-server/server.js';
import { openApiSpec } from '../../src/http/openapi.js';
import { MCP_TOOL_DEFINITIONS } from '../../src/mcp-server/tool-definitions.js';

const CORE_ROOT = path.resolve(import.meta.dirname, '../../..');
const CLI_MAIN = path.join(CORE_ROOT, 'dist-tests', 'src', 'cli', 'main.js');

const SOURCE = `import * as child_process from 'child_process';

export function direct() {
  const input = process.argv[2];
  child_process.execSync(input);
}

export function quiet() {
  const value = 'ls';
  child_process.execSync(value);
}
`;

function get(server: http.Server, route: string, token: string): Promise<{ status: number; body: Record<string, any> }> {
  return new Promise((resolve, reject) => {
    const address = server.address() as { port: number };
    const req = http.request({ host: '127.0.0.1', port: address.port, path: route, method: 'GET', headers: { Authorization: `Bearer ${token}` } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : {} }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('taint-trace CLI/HTTP/MCP surfaces on a real index', () => {
  let root: string;
  let repoDir: string;
  let home: string;
  let server: http.Server;
  let usersDb: UsersDB;
  let token: string;
  let previousUsersDbPath: string | undefined;

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'taint-surfaces-'));
    home = path.join(root, 'home');
    fs.mkdirSync(home);
    repoDir = path.join(root, 'repo');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'taint-repo', private: true }));
    fs.writeFileSync(path.join(repoDir, 'src/app.ts'), SOURCE);
    if (!fs.existsSync(path.join(CORE_ROOT, 'dist-tests', 'package.json'))) fs.copyFileSync(path.join(CORE_ROOT, 'package.json'), path.join(CORE_ROOT, 'dist-tests', 'package.json'));
    const analyzed = spawnSync(process.execPath, [CLI_MAIN, 'analyze', repoDir, '--skip-agents-md'], { cwd: CORE_ROOT, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test', HOME: home, USERPROFILE: home } });
    if (analyzed.status !== 0) throw new Error(`analyze failed\n${analyzed.stdout}\n${analyzed.stderr}`);

    previousUsersDbPath = process.env['CODE_INTEL_USERS_DB_PATH'];
    process.env['CODE_INTEL_USERS_DB_PATH'] = path.join(root, 'users.db');
    resetUsersDBForTesting();
    usersDb = new UsersDB(path.join(root, 'users.db'));
    token = usersDb.createToken('analyst', 'analyst').rawToken;
  });

  after(async () => {
    if (previousUsersDbPath === undefined) delete process.env['CODE_INTEL_USERS_DB_PATH'];
    else process.env['CODE_INTEL_USERS_DB_PATH'] = previousUsersDbPath;
    resetUsersDBForTesting();
    usersDb?.close();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  function cli(...args: string[]) {
    return spawnSync(process.execPath, [CLI_MAIN, 'taint-trace', '--dir', repoDir, ...args], { cwd: CORE_ROOT, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test', HOME: home, USERPROFILE: home } });
  }

  it('CLI returns findings as JSON with models, locations and coverage', () => {
    const run = cli('--symbol', 'direct', '--format', 'json');
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout.slice(run.stdout.indexOf('{')));
    assert.equal(result.verdict, 'findings');
    assert.equal(result.findings[0].sink.matcherId, 'child-process-exec-sync');
    assert.equal(result.findings[0].source.line, 4);
    assert.equal(result.coverage.interprocedural.requested, true);
  });

  it('CLI text output never calls a no-finding result safe', () => {
    const run = cli('--symbol', 'quiet');
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /verdict: no-findings-/);
    assert.doesNotMatch(run.stdout, /verdict: safe/i);
    assert.match(run.stdout, /not a proof|must not be read as the code being safe/);
  });

  it('HTTP GET /api/v1/taint-trace returns the same service result', async () => {
    server = http.createServer(createApp(createKnowledgeGraph(), 'taint-repo', repoDir));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const response = await get(server, '/api/v1/taint-trace?symbol=nope', token);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body['verdict'], 'not-found');
    assert.equal(response.body['version'], 'taint-trace-v1');
  });

  it('MCP taint_trace dispatches to the service', async () => {
    const { loadGraphSnapshotFromDbPath } = await import('../../src/multi-repo/graph-from-db.js');
    const { resolvePublishedArtifactPath } = await import('../../src/storage/index-generation.js');
    const graph = await loadGraphSnapshotFromDbPath(resolvePublishedArtifactPath(repoDir, 'graph.db'));
    const result = await dispatchTool('taint_trace', { symbol: 'direct' }, graph, 'taint-repo', repoDir);
    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    assert.equal(payload.version, 'taint-trace-v1');
    assert.equal(payload.verdict, 'findings', JSON.stringify(payload));
    assert.equal(payload.findings[0].sink.category, 'command');
    // A freshly analyzed index is trusted, so the gate allows cross-function propagation.
    assert.equal(payload.coverage.interprocedural.allowed, true);
  });

  it('is declared in the OpenAPI spec and MCP tool definitions', () => {
    assert.ok((openApiSpec.paths as Record<string, unknown>)['/taint-trace']);
    const tool = MCP_TOOL_DEFINITIONS.find((item) => item.name === 'taint_trace');
    assert.ok(tool);
    assert.match(tool.description, /never a safety proof/);
  });
});
