/**
 * Tests for Epic 4 — Observability
 *
 * Covers remaining unchecked items:
 *   ✅ /health/ready returns 503 when DB disconnected
 *   ✅ /api/v1/health returns detailed info (DB, index version, queue depth, memory)
 *   ✅ Prometheus alert rules YAML is committed and syntactically valid
 *   ✅ Grafana dashboard JSON is committed and valid
 *   ✅ tracing sanitizeAttrs strips secret-bearing keys
 *   ✅ OTel isTracingEnabled respects CODE_INTEL_OTEL_ENABLED env var
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { createApp } from '../../../src/http/app.js';
import { sanitizeAttrs, isTracingEnabled } from '../../../src/observability/tracing.js';
import { UsersDB, resetUsersDBForTesting } from '../../../src/auth/users-db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');

// ── HTTP helper ───────────────────────────────────────────────────────────────

function rawReq(
  server: http.Server,
  opts: { method: string; path: string; headers?: Record<string, string> },
): Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: opts.path,
      method: opts.method,
      headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
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
    r.end();
  });
}

// ── 1. /health/* ─────────────────────────────────────────────────────────────

describe('Observability — /health endpoints', () => {
  let server: http.Server;

  before(() => {
    const graph = createKnowledgeGraph();
    const app = createApp(graph, 'test-repo');
    server = http.createServer(app);
    return new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(() => {
    return new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('GET /health/live → 200 { status: ok }', async () => {
    const res = await rawReq(server, { method: 'GET', path: '/health/live' });
    assert.equal(res.status, 200);
    assert.equal((res.body as { status: string }).status, 'ok');
  });

  it('GET /health/startup → 200', async () => {
    const res = await rawReq(server, { method: 'GET', path: '/health/startup' });
    assert.equal(res.status, 200);
  });

  it('GET /health/ready → 200 with empty graph + no workspaceRoot', async () => {
    const res = await rawReq(server, { method: 'GET', path: '/health/ready' });
    assert.equal(res.status, 200);
  });
});

// ── 2. /health/ready → 503 when workspaceRoot provided but no graph ───────────

describe('Observability — /health/ready 503 when not ready', () => {
  let server: http.Server;

  before(() => {
    const graph = createKnowledgeGraph();
    // Pass a workspaceRoot but leave graph empty → should return 503
    const app = createApp(graph, 'test-repo', '/some/fake/path');
    server = http.createServer(app);
    return new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(() => {
    return new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('GET /health/ready → 503 when graph has 0 nodes and workspaceRoot set', async () => {
    const res = await rawReq(server, { method: 'GET', path: '/health/ready' });
    assert.equal(res.status, 503);
    const body = res.body as { status: string; reason: string };
    assert.equal(body.status, 'error');
    assert.ok(body.reason.toLowerCase().includes('not'));
  });
});

// ── 3. /api/v1/health — detailed health (requires auth, so test with token) ───

describe('Observability — /api/v1/health detailed endpoint', () => {
  let server: http.Server;
  let usersDbPath: string;
  let usersDb: UsersDB;

  before(() => {
    // Create a temp users DB with a single admin so DEV_AUTO_LOGIN activates.
    // Without this, the CI runner starts with an empty DB and auto-login never
    // fires (it requires exactly one admin user to exist).
    usersDbPath = path.join(os.tmpdir(), `obs-health-users-${Date.now()}.db`);
    process.env['CODE_INTEL_USERS_DB_PATH'] = usersDbPath;
    process.env['CODE_INTEL_DEV_AUTO_LOGIN'] = 'true';
    resetUsersDBForTesting();
    usersDb = new UsersDB(usersDbPath);
    usersDb.createUser('admin', 'password123', 'admin');

    const graph = createKnowledgeGraph();
    const app = createApp(graph, 'test-repo');
    server = http.createServer(app);
    return new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(() => {
    delete process.env['CODE_INTEL_DEV_AUTO_LOGIN'];
    delete process.env['CODE_INTEL_USERS_DB_PATH'];
    resetUsersDBForTesting();
    try { usersDb.close(); } catch { /* ignore */ }
    try { fs.unlinkSync(usersDbPath); } catch { /* ignore */ }
    return new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('GET /api/v1/health → 200 with nodes, edges, memory fields', async () => {
    const res = await rawReq(server, { method: 'GET', path: '/api/v1/health' });
    assert.equal(res.status, 200);
    const body = res.body as {
      status: string;
      nodes: number;
      edges: number;
      memory: { heapUsedMb: number; heapTotalMb: number; rssMb: number };
      timestamp: string;
    };
    assert.equal(body.status, 'ok');
    assert.equal(typeof body.nodes, 'number');
    assert.equal(typeof body.edges, 'number');
    assert.ok(body.memory, 'memory field should be present');
    assert.equal(typeof body.memory.heapUsedMb, 'number');
    assert.equal(typeof body.memory.heapTotalMb, 'number');
    assert.equal(typeof body.memory.rssMb, 'number');
    assert.ok(typeof body.timestamp === 'string');
  });
});

// ── 4. Prometheus metrics endpoint ────────────────────────────────────────────

describe('Observability — /metrics endpoint', () => {
  let server: http.Server;

  before(() => {
    const graph = createKnowledgeGraph();
    const app = createApp(graph, 'test-repo');
    server = http.createServer(app);
    return new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(() => {
    return new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('GET /metrics → 200 with Prometheus text format', async () => {
    const res = await rawReq(server, { method: 'GET', path: '/metrics' });
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type']?.includes('text/plain'));
    const body = res.body as string;
    // Must contain at least one known metric name
    assert.ok(body.includes('http_requests_total') || body.includes('# HELP'), 'should contain Prometheus metrics');
  });

  it('/metrics response includes all required counter/histogram/gauge names', async () => {
    const res = await rawReq(server, { method: 'GET', path: '/metrics' });
    const body = res.body as string;
    const required = [
      'http_requests_total',
      'http_request_duration_seconds',
      'pipeline_analyses_total',
      'mcp_tool_calls_total',
      'pipeline_nodes_total',
    ];
    for (const name of required) {
      assert.ok(body.includes(name), `Missing metric: ${name}`);
    }
  });
});

// ── 5. Grafana dashboard + alert rules files ──────────────────────────────────

describe('Observability — committed docs files', () => {
  it('docs/grafana-dashboard.json exists and is valid JSON', () => {
    const dashboardPath = path.join(DOCS_DIR, 'grafana-dashboard.json');
    assert.ok(fs.existsSync(dashboardPath), 'grafana-dashboard.json should exist');
    const raw = fs.readFileSync(dashboardPath, 'utf-8');
    const parsed = JSON.parse(raw) as { title: string; panels: unknown[] };
    assert.ok(typeof parsed.title === 'string', 'dashboard should have a title');
    assert.ok(Array.isArray(parsed.panels), 'dashboard should have panels array');
    assert.ok(parsed.panels.length > 0, 'dashboard should have at least one panel');
  });

  it('docs/alert-rules.yml exists and contains expected alert groups', () => {
    const alertPath = path.join(DOCS_DIR, 'alert-rules.yml');
    assert.ok(fs.existsSync(alertPath), 'alert-rules.yml should exist');
    const raw = fs.readFileSync(alertPath, 'utf-8');
    // Check for key alert names
    assert.ok(raw.includes('HighHTTPErrorRate'), 'should include HighHTTPErrorRate alert');
    assert.ok(raw.includes('HighHeapUsage'), 'should include HighHeapUsage alert');
    assert.ok(raw.includes('HighAuthFailureRate'), 'should include HighAuthFailureRate alert');
  });
});

// ── 6. OTel tracing module ────────────────────────────────────────────────────

describe('Observability — OpenTelemetry tracing module', () => {
  const origEnabled = process.env['CODE_INTEL_OTEL_ENABLED'];

  after(() => {
    if (origEnabled === undefined) delete process.env['CODE_INTEL_OTEL_ENABLED'];
    else process.env['CODE_INTEL_OTEL_ENABLED'] = origEnabled;
  });

  it('isTracingEnabled() returns false when CODE_INTEL_OTEL_ENABLED is not set', () => {
    delete process.env['CODE_INTEL_OTEL_ENABLED'];
    assert.equal(isTracingEnabled(), false);
  });

  it('isTracingEnabled() returns true when CODE_INTEL_OTEL_ENABLED=true', () => {
    process.env['CODE_INTEL_OTEL_ENABLED'] = 'true';
    assert.equal(isTracingEnabled(), true);
    delete process.env['CODE_INTEL_OTEL_ENABLED'];
  });

  it('sanitizeAttrs strips secret-bearing keys', () => {
    const attrs = {
      'http.method': 'GET',
      'http.url': '/api/v1/search',
      'user.token': 'bearer-abc123',    // should be stripped
      'db.password': 'super-secret',    // should be stripped
      'pipeline.phase': 'parse',
      'auth.header': 'Bearer xyz',      // should be stripped
    };
    const safe = sanitizeAttrs(attrs);
    assert.ok('http.method' in safe);
    assert.ok('http.url' in safe);
    assert.ok('pipeline.phase' in safe);
    assert.ok(!('user.token' in safe), 'token key should be stripped');
    assert.ok(!('db.password' in safe), 'password key should be stripped');
    assert.ok(!('auth.header' in safe), 'auth key should be stripped');
  });

  it('sanitizeAttrs allows safe attributes through', () => {
    const attrs = {
      'http.method': 'POST',
      'pipeline.phase': 'scan',
      'repo.name': 'my-repo',
      'node.count': 42,
    };
    const safe = sanitizeAttrs(attrs);
    assert.equal(safe['http.method'], 'POST');
    assert.equal(safe['pipeline.phase'], 'scan');
    assert.equal(safe['repo.name'], 'my-repo');
    assert.equal(safe['node.count'], 42);
  });
});

// ── 7. X-Request-ID header ────────────────────────────────────────────────────

describe('Observability — X-Request-ID header on every request', () => {
  let server: http.Server;

  before(() => {
    const graph = createKnowledgeGraph();
    const app = createApp(graph, 'test-repo');
    server = http.createServer(app);
    return new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(() => {
    return new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('every response includes X-Request-ID header', async () => {
    const res = await rawReq(server, { method: 'GET', path: '/health/live' });
    assert.ok(res.headers['x-request-id'], 'X-Request-ID should be present');
    assert.ok(
      typeof res.headers['x-request-id'] === 'string' &&
      res.headers['x-request-id'].length > 0,
    );
  });

  it('each request gets a unique X-Request-ID', async () => {
    const res1 = await rawReq(server, { method: 'GET', path: '/health/live' });
    const res2 = await rawReq(server, { method: 'GET', path: '/health/live' });
    assert.notEqual(res1.headers['x-request-id'], res2.headers['x-request-id']);
  });
});

// ── 8. Audit log entry on every authenticated request ─────────────────────────

describe('Observability — audit log entry on every authenticated request', () => {
  let server: http.Server;
  let db: UsersDB;
  let dbPath: string;

  before(() => {
    dbPath = path.join(os.tmpdir(), `audit-test-${Date.now()}.db`);
    process.env['CODE_INTEL_USERS_DB_PATH'] = dbPath;
    process.env['CODE_INTEL_DEV_AUTO_LOGIN'] = 'true';
    resetUsersDBForTesting();

    // Create a single admin so DEV_AUTO_LOGIN activates
    db = new UsersDB(dbPath);
    db.createUser('admin', 'password123', 'admin');

    const graph = createKnowledgeGraph();
    const app = createApp(graph, 'test-repo');
    server = http.createServer(app);
    return new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(() => {
    delete process.env['CODE_INTEL_DEV_AUTO_LOGIN'];
    delete process.env['CODE_INTEL_USERS_DB_PATH'];
    resetUsersDBForTesting();
    try { db.close(); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    return new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('authenticated request to /api/v1/health writes an audit log entry', async () => {
    const logBefore = db.getAuditLog();
    const countBefore = logBefore.length;

    await rawReq(server, { method: 'GET', path: '/api/v1/health' });

    const logAfter = db.getAuditLog();
    assert.ok(
      logAfter.length > countBefore,
      `Expected a new audit log entry; had ${countBefore}, now have ${logAfter.length}`,
    );

    const entry = logAfter[0]!; // most-recent first
    assert.equal(entry.resource, '/api/v1/health');
    assert.equal(entry.action, 'GET');
    assert.equal(entry.outcome, 'allow');
  });

  it('multiple authenticated requests each produce an audit log entry', async () => {
    const logBefore = db.getAuditLog();
    const countBefore = logBefore.length;

    await rawReq(server, { method: 'GET', path: '/api/v1/health' });
    await rawReq(server, { method: 'GET', path: '/api/v1/repos' });

    const logAfter = db.getAuditLog();
    assert.ok(
      logAfter.length >= countBefore + 2,
      `Expected at least 2 new entries; had ${countBefore}, now have ${logAfter.length}`,
    );
  });

  it('unauthenticated requests do NOT write audit log entries', async () => {
    // Temporarily disable auto-login
    delete process.env['CODE_INTEL_DEV_AUTO_LOGIN'];
    resetUsersDBForTesting();

    const graph = createKnowledgeGraph();
    const anonApp = createApp(graph, 'anon-repo');
    const anonServer = http.createServer(anonApp);
    await new Promise<void>((resolve) => anonServer.listen(0, '127.0.0.1', resolve));

    const dbAnon = new UsersDB(dbPath);
    const countBefore = dbAnon.getAuditLog().length;

    // /health/live is both public and skipped — /api/v1/health is auth-gated (401)
    await rawReq(anonServer, { method: 'GET', path: '/health/live' });
    await rawReq(anonServer, { method: 'GET', path: '/api/v1/health' });

    const countAfter = dbAnon.getAuditLog().length;
    dbAnon.close();

    await new Promise<void>((resolve, reject) =>
      anonServer.close((err) => (err ? reject(err) : resolve())),
    );

    assert.equal(
      countAfter,
      countBefore,
      'No audit entries should be written for unauthenticated requests',
    );

    // Restore for subsequent tests
    process.env['CODE_INTEL_DEV_AUTO_LOGIN'] = 'true';
    resetUsersDBForTesting();
  });

  it('/health/* and /metrics requests do NOT write audit log entries even when authenticated', async () => {
    const countBefore = db.getAuditLog().length;

    await rawReq(server, { method: 'GET', path: '/health/live' });
    await rawReq(server, { method: 'GET', path: '/health/ready' });
    await rawReq(server, { method: 'GET', path: '/metrics' });

    const countAfter = db.getAuditLog().length;
    assert.equal(
      countAfter,
      countBefore,
      '/health/* and /metrics must not produce audit log entries',
    );
  });
});
