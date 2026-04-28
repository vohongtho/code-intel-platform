/**
 * E2E Test — analyze → serve → query → backup → restore
 *
 * This test exercises the full platform lifecycle in a single in-process flow:
 *   1. Analyze: run the pipeline on code-intel/shared (real TypeScript source)
 *   2. Serve:   start the HTTP API server with the populated graph
 *   3. Query:   POST /api/v1/search and verify real results
 *   4. Backup:  create an encrypted backup of the analysis artifacts
 *   5. Restore: restore the backup and verify all files are intact
 *
 * No external processes or Docker are required — everything runs in-process.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── 1. Analyze ────────────────────────────────────────────────────────────────
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { runPipeline } from '../../../src/pipeline/orchestrator.js';
import {
  scanPhase,
  structurePhase,
  parsePhase,
  resolvePhase,
} from '../../../src/pipeline/phases/index.js';
import type { PipelineContext } from '../../../src/pipeline/types.js';

// ── 2. Serve ──────────────────────────────────────────────────────────────────
import { createApp } from '../../../src/http/app.js';

// ── 4–5. Backup & Restore ─────────────────────────────────────────────────────
import { BackupService } from '../../../src/backup/backup-service.js';

// ── Auth ──────────────────────────────────────────────────────────────────────
import { UsersDB, resetUsersDBForTesting } from '../../../src/auth/users-db.js';

// ─────────────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist-tests/tests/integration/e2e → 6 levels up = monorepo root
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const SHARED_ROOT = path.join(REPO_ROOT, 'code-intel', 'shared');

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function rawReq(
  server: http.Server,
  opts: { method: string; path: string; body?: unknown; headers?: Record<string, string> },
): Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const bodyStr = opts.body ? JSON.stringify(opts.body) : undefined;
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: opts.path,
      method: opts.method,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers ?? {}),
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr).toString() } : {}),
      },
    };
    const r = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        try { resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : {}, headers: res.headers }); }
        catch { resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }); }
      });
    });
    r.on('error', reject);
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

/**
 * CSRF-aware request helper.
 * For state-changing methods (POST/PUT/DELETE/PATCH) it first fetches a CSRF
 * token from /auth/csrf-token and attaches it via x-csrf-token header + cookie,
 * matching the pattern used in all other integration tests.
 */
async function req(
  server: http.Server,
  opts: { method: string; path: string; body?: unknown; headers?: Record<string, string> },
): Promise<{ status: number; body: unknown }> {
  const stateChanging = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(opts.method.toUpperCase());
  let csrfToken = '';
  let csrfCookie = '';

  if (stateChanging) {
    const csrfRes = await rawReq(server, { method: 'GET', path: '/auth/csrf-token' });
    const csrfBody = csrfRes.body as { csrfToken?: string };
    csrfToken = csrfBody.csrfToken ?? '';
    const setCookie = csrfRes.headers['set-cookie'];
    if (Array.isArray(setCookie)) {
      csrfCookie = setCookie.map((c: string) => c.split(';')[0] ?? '').join('; ');
    } else if (typeof setCookie === 'string') {
      csrfCookie = (setCookie as string).split(';')[0] ?? '';
    }
  }

  const extraHeaders: Record<string, string> = {};
  if (csrfToken) extraHeaders['x-csrf-token'] = csrfToken;
  if (csrfCookie) extraHeaders['Cookie'] = csrfCookie;

  const result = await rawReq(server, {
    ...opts,
    headers: { ...(opts.headers ?? {}), ...extraHeaders },
  });
  return { status: result.status, body: result.body };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('E2E — analyze → serve → query → backup → restore', () => {
  let graph: ReturnType<typeof createKnowledgeGraph>;
  let server: http.Server;
  let repoDir: string;
  let backupDir: string;
  let backupId: string;
  let metaContent: string;
  let usersDbPath: string;
  let usersDb: UsersDB;

  before(() => {
    // Set up a temp users DB with a single admin so DEV_AUTO_LOGIN activates
    usersDbPath = path.join(os.tmpdir(), `e2e-users-${Date.now()}.db`);
    process.env['CODE_INTEL_USERS_DB_PATH'] = usersDbPath;
    process.env['CODE_INTEL_DEV_AUTO_LOGIN'] = 'true';
    resetUsersDBForTesting();
    usersDb = new UsersDB(usersDbPath);
    usersDb.createUser('admin', 'password123', 'admin');
  });

  // ── Step 1: Analyze ─────────────────────────────────────────────────────────
  it('step 1: analyze pipeline runs successfully on real TypeScript source', async () => {
    graph = createKnowledgeGraph();
    const context: PipelineContext = {
      workspaceRoot: SHARED_ROOT,
      graph,
      filePaths: [],
    };

    const phases = [scanPhase, structurePhase, parsePhase, resolvePhase];
    const result = await runPipeline(phases, context);

    assert.equal(result.success, true, 'Pipeline should succeed');
    assert.ok(graph.size.nodes > 0, `Graph should have nodes, got ${graph.size.nodes}`);
    assert.ok(graph.size.edges > 0, `Graph should have edges, got ${graph.size.edges}`);

    // Confirm real symbols were parsed (Language enum exists in shared)
    let foundLanguage = false;
    for (const node of graph.allNodes()) {
      if (node.name === 'Language' && node.kind === 'enum') {
        foundLanguage = true;
        break;
      }
    }
    assert.ok(foundLanguage, 'Should parse the Language enum from code-intel/shared');
  });

  // ── Step 2: Serve ────────────────────────────────────────────────────────────
  it('step 2: HTTP server starts and /health/live responds 200', async () => {
    const app = createApp(graph, 'e2e-shared', SHARED_ROOT);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    const res = await rawReq(server, { method: 'GET', path: '/health/live' });
    assert.equal(res.status, 200, '/health/live should return 200');
    assert.equal((res.body as { status: string }).status, 'ok');
  });

  // ── Step 3: Query ────────────────────────────────────────────────────────────
  it('step 3: text search returns results for a known symbol', async () => {
    const res = await req(server, {
      method: 'POST',
      path: '/api/v1/search',
      body: { query: 'Language', limit: 10 },
    });

    assert.equal(res.status, 200, `Search should return 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { results: Array<{ name: string; kind: string }> };
    assert.ok(Array.isArray(body.results), 'results should be an array');
    assert.ok(body.results.length > 0, 'Search for "Language" should return at least 1 result');

    const found = body.results.some((r) => r.name === 'Language');
    assert.ok(found, 'The "Language" symbol should appear in search results');
  });

  it('step 3b: /api/v1/repos returns repo list', async () => {
    const res = await rawReq(server, { method: 'GET', path: '/api/v1/repos' });
    assert.equal(res.status, 200, `/api/v1/repos should return 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    // /api/v1/repos returns a bare array (not wrapped in { repos: [] })
    const body = res.body as Array<{ name: string }>;
    assert.ok(Array.isArray(body), 'response should be an array of repos');
    assert.ok(body.length > 0, 'should have at least one repo entry');
  });

  // ── Step 4: Backup ───────────────────────────────────────────────────────────
  it('step 4: backup created from analysis artifacts', () => {
    repoDir = path.join(os.tmpdir(), `e2e-repo-${Date.now()}`);
    backupDir = path.join(os.tmpdir(), `e2e-backups-${Date.now()}`);
    fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });

    // Write realistic artifacts to .code-intel/
    const codeIntelDir = path.join(repoDir, '.code-intel');
    fs.mkdirSync(codeIntelDir, { recursive: true });

    const meta = {
      indexedAt: new Date().toISOString(),
      indexVersion: 'e2e-test-version',
      stats: {
        nodes: graph.size.nodes,
        edges: graph.size.edges,
        files: 10,
        duration: 500,
      },
    };
    metaContent = JSON.stringify(meta);
    fs.writeFileSync(path.join(codeIntelDir, 'meta.json'), metaContent);
    fs.writeFileSync(path.join(codeIntelDir, 'graph.db'), Buffer.from('e2e-fake-graph-bytes'));

    const svc = new BackupService(backupDir);
    const entry = svc.createBackup(repoDir);

    backupId = entry.id;
    assert.ok(backupId.length > 0, 'backup should have an ID');
    assert.ok(entry.size > 0, 'backup file should have non-zero size');
    assert.ok(fs.existsSync(entry.path), 'backup file should exist on disk');

    // Verify it is encrypted (does not contain raw meta.json content)
    const raw = fs.readFileSync(entry.path, 'utf-8');
    assert.ok(!raw.includes('indexVersion'), 'backup file must not contain plaintext metadata');

    // Listing should include the new backup
    const listed = svc.listBackups();
    assert.ok(listed.some((e) => e.id === backupId), 'backup should appear in list');
  });

  // ── Step 5: Restore ──────────────────────────────────────────────────────────
  it('step 5: backup restores correctly — files match original', () => {
    const codeIntelDir = path.join(repoDir, '.code-intel');

    // Remove original artifacts
    fs.rmSync(codeIntelDir, { recursive: true, force: true });
    assert.ok(!fs.existsSync(codeIntelDir), 'should have been removed before restore');

    const svc = new BackupService(backupDir);
    svc.restoreBackup(backupId, repoDir);

    // meta.json should be restored verbatim
    const restoredMeta = fs.readFileSync(path.join(codeIntelDir, 'meta.json'), 'utf-8');
    assert.equal(restoredMeta, metaContent, 'Restored meta.json must match original content');

    // graph.db should also be restored
    const restoredDb = fs.readFileSync(path.join(codeIntelDir, 'graph.db'));
    assert.ok(restoredDb.equals(Buffer.from('e2e-fake-graph-bytes')), 'Restored graph.db must match original bytes');
  });

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  after(() => {
    delete process.env['CODE_INTEL_DEV_AUTO_LOGIN'];
    delete process.env['CODE_INTEL_USERS_DB_PATH'];
    resetUsersDBForTesting();

    try { usersDb.close(); } catch { /* ignore */ }
    try { fs.unlinkSync(usersDbPath); } catch { /* ignore */ }

    if (server) {
      server.close(() => { /* ignore */ });
    }
    if (repoDir) {
      try { fs.rmSync(repoDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    if (backupDir) {
      try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
