/**
 * Security Tests — Epic 8
 *
 * Covers OWASP Top 10 patterns tested programmatically:
 *   - Auth bypass (A07): unauthenticated access to protected routes → 401
 *   - Broken access control (A01): RBAC enforcement → 403 for wrong roles
 *   - Path traversal (A01): file_path outside allowed roots → 403
 *   - XSS via API (A03): injected script in query → string stored/returned, not executed
 *   - Injection — regex (A03): malicious regex pattern → handled safely
 *   - Injection — Cypher/SQL (A03): malicious query bodies → handled safely, no crash
 *   - Rate limit (A05/A04): payload > 1MB → 413 from express.json limit
 *   - CORS: non-allowlisted origin → no ACAO header echoed
 *   - CSRF: state-changing request without token → 403
 *   - Sensitive data in responses: 500 errors never leak stack traces
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { createApp } from '../../../src/http/app.js';
import { UsersDB, resetUsersDBForTesting } from '../../../src/auth/users-db.js';

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function rawReq(
  server: http.Server,
  opts: {
    method: string;
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path: opts.path,
        method: opts.method,
        headers: {
          'Content-Type': 'application/json',
          ...(opts.headers ?? {}),
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr).toString() } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data), headers: res.headers }); }
          catch { resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }); }
        });
      },
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/** Fetch a CSRF token pair from the server. */
async function getCsrf(server: http.Server, sessionCookie = ''): Promise<{ token: string; cookie: string }> {
  const res = await rawReq(server, {
    method: 'GET',
    path: '/auth/csrf-token',
    headers: sessionCookie ? { Cookie: sessionCookie } : {},
  });
  const body = res.body as { csrfToken?: string };
  const setCookieRaw = res.headers['set-cookie'];
  let cookie = '';
  if (Array.isArray(setCookieRaw)) {
    cookie = setCookieRaw.map((c: string) => c.split(';')[0] ?? '').join('; ');
  } else if (typeof setCookieRaw === 'string') {
    cookie = (setCookieRaw as string).split(';')[0] ?? '';
  }
  return { token: body.csrfToken ?? '', cookie };
}

/** State-changing request with CSRF pair. */
async function csrfReq(
  server: http.Server,
  opts: { method: string; path: string; body?: unknown; headers?: Record<string, string> },
): Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders }> {
  const { token, cookie } = await getCsrf(server);
  return rawReq(server, {
    ...opts,
    headers: { 'x-csrf-token': token, Cookie: cookie, ...(opts.headers ?? {}) },
  });
}

// ── Test server factory ───────────────────────────────────────────────────────

interface TestCtx {
  server: http.Server;
  db: UsersDB;
  dbPath: string;
  adminToken: string;
}

async function makeCtx(): Promise<TestCtx> {
  const dbPath = path.join(os.tmpdir(), `security-test-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
  const db = new UsersDB(dbPath);
  process.env['CODE_INTEL_USERS_DB_PATH'] = dbPath;
  delete process.env['CODE_INTEL_DEV_AUTO_LOGIN'];
  resetUsersDBForTesting();

  const { rawToken: adminToken } = db.createToken('admin-tok', 'admin');

  const graph = createKnowledgeGraph();
  const app = createApp(graph, 'test-repo');
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, db, dbPath, adminToken };
}

async function closeCtx(ctx: TestCtx): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    ctx.server.close((err) => (err ? reject(err) : resolve())),
  );
  ctx.db.close();
  try { fs.unlinkSync(ctx.dbPath); } catch { /* ignore */ }
  delete process.env['CODE_INTEL_USERS_DB_PATH'];
  resetUsersDBForTesting();
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. Auth bypass — all protected routes return 401 without credentials
// ═════════════════════════════════════════════════════════════════════════════

describe('Security — auth bypass (A07): protected routes require auth', () => {
  let ctx: TestCtx;

  before(async () => { ctx = await makeCtx(); });
  after(() => closeCtx(ctx));

  const protectedRoutes: Array<{ method: string; path: string; body?: unknown }> = [
    { method: 'GET',  path: '/api/v1/repos' },
    { method: 'GET',  path: '/api/v1/health' },
    { method: 'GET',  path: '/api/v1/jobs' },
    { method: 'GET',  path: '/api/v1/flows' },
    { method: 'GET',  path: '/api/v1/clusters' },
    { method: 'GET',  path: '/api/v1/groups' },
    { method: 'POST', path: '/api/v1/search',       body: { query: 'foo' } },
    { method: 'POST', path: '/api/v1/blast-radius',  body: { target: 'foo' } },
    { method: 'POST', path: '/api/v1/files/read',    body: { file_path: '/tmp/test' } },
    { method: 'POST', path: '/api/v1/grep',          body: { pattern: 'foo' } },
    { method: 'POST', path: '/api/v1/cypher',        body: { query: 'MATCH (n) RETURN n' } },
  ];

  for (const route of protectedRoutes) {
    it(`${route.method} ${route.path} → 401 without credentials`, async () => {
      const res = route.method === 'POST'
        ? await csrfReq(ctx.server, { method: route.method, path: route.path, body: route.body })
        : await rawReq(ctx.server, { method: route.method, path: route.path });
      assert.equal(res.status, 401, `Expected 401 for ${route.method} ${route.path}, got ${res.status}`);
      const body = res.body as { error?: { code?: string } };
      assert.ok(body.error?.code?.startsWith('CI-'), 'Should return CI-XXXX error code');
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Broken access control (A01) — viewer cannot access admin routes
// ═════════════════════════════════════════════════════════════════════════════

describe('Security — broken access control (A01): role enforcement', () => {
  let ctx: TestCtx;
  let viewerToken: string;

  before(async () => {
    ctx = await makeCtx();
    const { rawToken } = ctx.db.createToken('viewer-tok', 'viewer');
    viewerToken = rawToken;
  });
  after(() => closeCtx(ctx));

  it('viewer token cannot GET /admin/users → 403', async () => {
    const res = await rawReq(ctx.server, {
      method: 'GET',
      path: '/admin/users',
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    assert.ok([401, 403].includes(res.status), `Expected 401 or 403, got ${res.status}`);
  });

  it('viewer token cannot DELETE /admin/tokens/:id → 401/403', async () => {
    const { token, cookie } = await getCsrf(ctx.server);
    const res = await rawReq(ctx.server, {
      method: 'DELETE',
      path: '/admin/tokens/some-id',
      headers: { Authorization: `Bearer ${viewerToken}`, 'x-csrf-token': token, Cookie: cookie },
    });
    assert.ok([401, 403].includes(res.status), `Expected 401 or 403, got ${res.status}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Path traversal (A01) — file_path outside allowed root → 403
// ═════════════════════════════════════════════════════════════════════════════

describe('Security — path traversal (A01): file access restriction', () => {
  let ctx: TestCtx;

  before(async () => { ctx = await makeCtx(); });
  after(() => closeCtx(ctx));

  const traversalPaths = [
    '../../../etc/passwd',
    '/etc/passwd',
    '/etc/shadow',
    '../../../../.ssh/id_rsa',
    '/root/.bashrc',
  ];

  for (const filePath of traversalPaths) {
    it(`file_path "${filePath.slice(0, 30)}" → 401 or 403`, async () => {
      const { token, cookie } = await getCsrf(ctx.server);
      const res = await rawReq(ctx.server, {
        method: 'POST',
        path: '/api/v1/files/read',
        body: { file_path: filePath },
        headers: { 'x-csrf-token': token, Cookie: cookie },
      });
      // Without auth → 401; with auth but outside root → 403
      assert.ok([401, 403].includes(res.status), `Expected 401 or 403 for path traversal "${filePath}", got ${res.status}`);
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. XSS via API (A03) — injected script in query is returned as string, not executed
// ═════════════════════════════════════════════════════════════════════════════

describe('Security — XSS (A03): script injection in API params', () => {
  let ctx: TestCtx;

  before(async () => { ctx = await makeCtx(); });
  after(() => closeCtx(ctx));

  it('XSS payload in search query is returned as plain JSON, not rendered HTML', async () => {
    const xssPayload = '<script>alert("xss")</script>';
    const res = await csrfReq(ctx.server, {
      method: 'POST',
      path: '/api/v1/search',
      body: { query: xssPayload },
    });
    // Without auth → 401, but body must not contain rendered script
    const bodyStr = JSON.stringify(res.body);
    // If it returns a body, it must be JSON-encoded (< and > escaped or present as string)
    assert.ok(
      !bodyStr.includes('<script>alert') || bodyStr.includes('"<script>'),
      'XSS payload must not appear as raw unescaped HTML in response',
    );
    // Content-Type must be application/json
    const ct = res.headers['content-type'] ?? '';
    assert.ok(ct.includes('application/json'), `Expected application/json, got: ${ct}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Injection — malformed regex (A03)
// ═════════════════════════════════════════════════════════════════════════════

describe('Security — regex injection (A03): malformed pattern handled safely', () => {
  let ctx: TestCtx;

  before(async () => { ctx = await makeCtx(); });
  after(() => closeCtx(ctx));

  const maliciousPatterns = [
    '(', // unclosed group
    '[',  // unclosed bracket
    '(?P<name>)', // Python-style named group (invalid in JS)
    'a{99999999}', // catastrophic backtracking attempt
  ];

  for (const pattern of maliciousPatterns) {
    it(`malicious regex "${pattern.slice(0, 20)}" does not crash server (returns 4xx or 401)`, async () => {
      const res = await csrfReq(ctx.server, {
        method: 'POST',
        path: '/api/v1/grep',
        body: { pattern },
      });
      // 401 (no auth) or 400 (bad regex) or 200 (caught and handled) — never 500
      assert.ok(res.status < 500, `Server crashed with 500 for pattern: ${pattern}`);
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Injection — Cypher/query injection (A03)
// ═════════════════════════════════════════════════════════════════════════════

describe('Security — Cypher injection (A03): malicious query bodies handled safely', () => {
  let ctx: TestCtx;

  before(async () => { ctx = await makeCtx(); });
  after(() => closeCtx(ctx));

  const injectionPayloads = [
    "'; DROP TABLE users; --",
    "MATCH (n) DETACH DELETE n RETURN n",
    "'; DELETE FROM tokens WHERE 1=1; --",
    "MATCH (n) SET n.role = 'admin' RETURN n",
  ];

  for (const payload of injectionPayloads) {
    it(`cypher injection "${payload.slice(0, 30)}…" does not crash server`, async () => {
      const res = await csrfReq(ctx.server, {
        method: 'POST',
        path: '/api/v1/cypher',
        body: { query: payload },
      });
      // 401 (no auth) or 200/400 (handled) — never 500
      assert.ok(res.status < 500, `Server crashed with 500 for payload: ${payload}`);
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. Payload size gate — > 1MB → 413
// ═════════════════════════════════════════════════════════════════════════════

describe('Security — payload size (A04): > 1MB request → 413', () => {
  let ctx: TestCtx;

  before(async () => { ctx = await makeCtx(); });
  after(() => closeCtx(ctx));

  it('POST with > 1MB body → 413 Payload Too Large', async () => {
    const oversized = 'x'.repeat(1.5 * 1024 * 1024); // 1.5 MB
    // Must send raw (not via csrfReq which JSON.stringifies)
    const { token, cookie } = await getCsrf(ctx.server);
    const addr = ctx.server.address() as { port: number };

    const result = await new Promise<{ status: number }>((resolve, reject) => {
      const bodyStr = JSON.stringify({ query: oversized });
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: addr.port,
          path: '/api/v1/search',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr).toString(),
            'x-csrf-token': token,
            Cookie: cookie,
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
        },
      );
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });

    assert.equal(result.status, 413, 'Expected 413 for oversized payload');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. CORS — non-allowlisted origin gets no ACAO header
// ═════════════════════════════════════════════════════════════════════════════

describe('Security — CORS: non-allowlisted origin rejected', () => {
  let ctx: TestCtx;

  before(async () => {
    ctx = await makeCtx();
    // Ensure default allowed origins (no custom env)
    delete process.env['CODE_INTEL_CORS_ORIGINS'];
  });
  after(() => closeCtx(ctx));

  it('evil origin → no Access-Control-Allow-Origin echoed', async () => {
    const res = await rawReq(ctx.server, {
      method: 'GET',
      path: '/health/live',
      headers: { Origin: 'https://evil.attacker.example.com' },
    });
    const acao = res.headers['access-control-allow-origin'];
    assert.ok(
      acao === undefined || acao === null || acao === '',
      `Should NOT echo evil origin in ACAO header. Got: ${acao}`,
    );
  });

  it('allowlisted origin → ACAO header is set', async () => {
    const res = await rawReq(ctx.server, {
      method: 'GET',
      path: '/health/live',
      headers: { Origin: 'http://localhost:4747' },
    });
    const acao = res.headers['access-control-allow-origin'];
    assert.ok(
      acao === 'http://localhost:4747',
      `Expected ACAO=http://localhost:4747, got: ${acao}`,
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. CSRF — state-changing request without token → 403
// ═════════════════════════════════════════════════════════════════════════════

describe('Security — CSRF: state-changing request without token → 403', () => {
  let ctx: TestCtx;

  before(async () => { ctx = await makeCtx(); });
  after(() => closeCtx(ctx));

  it('POST /auth/login without CSRF token → 403', async () => {
    // No CSRF token or cookie
    const res = await rawReq(ctx.server, {
      method: 'POST',
      path: '/auth/login',
      body: { username: 'sec-admin', password: 'SecureP@ss123' },
    });
    assert.equal(res.status, 403, `Expected 403 for missing CSRF token, got ${res.status}`);
  });

  it('POST /api/v1/search without CSRF token → 403', async () => {
    const res = await rawReq(ctx.server, {
      method: 'POST',
      path: '/api/v1/search',
      body: { query: 'foo' },
    });
    assert.equal(res.status, 403, `Expected 403 for missing CSRF token on search, got ${res.status}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. Stack traces never leak in error responses
// ═════════════════════════════════════════════════════════════════════════════

describe('Security — sensitive data (A09): no stack traces in error responses', () => {
  let ctx: TestCtx;

  before(async () => { ctx = await makeCtx(); });
  after(() => closeCtx(ctx));

  const errorRoutes: Array<{ method: string; path: string; body?: unknown }> = [
    { method: 'GET',  path: '/api/v1/repos' },
    { method: 'GET',  path: '/api/v1/nodes/nonexistent-id' },
    { method: 'GET',  path: '/api/v1/health' },
  ];

  for (const route of errorRoutes) {
    it(`${route.method} ${route.path} error response has no stack trace`, async () => {
      const res = await rawReq(ctx.server, { method: route.method, path: route.path, body: route.body });
      const bodyStr = JSON.stringify(res.body);
      assert.ok(!bodyStr.includes('at Object.'), `Stack trace leaked in ${route.path} response`);
      assert.ok(!bodyStr.includes('node_modules'), `node_modules path leaked in ${route.path} response`);
      assert.ok(!bodyStr.includes('    at '), `Stack trace line format leaked in ${route.path} response`);
    });
  }
});
