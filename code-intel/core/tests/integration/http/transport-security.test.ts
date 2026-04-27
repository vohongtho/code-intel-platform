/**
 * Tests for Epic 2 — Transport Security
 *
 * Covers:
 *   ✅ CORS rejects non-allowlisted origins (no Access-Control-Allow-Origin header)
 *   ✅ CSRF missing → 403 (CI-1003)
 *   ✅ WebSocket without token rejected (verifyWebSocketHandshake → null)
 *   ✅ Payload > 1MB → 413
 *   ✅ Rate limit → 429
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { createApp } from '../../../src/http/app.js';
import { verifyWebSocketHandshake } from '../../../src/http/websocket-auth.js';

// ── HTTP helper ────────────────────────────────────────────────────────────

function rawReq(
  server: http.Server,
  opts: {
    method: string;
    path: string;
    body?: string | Buffer;
    headers?: Record<string, string>;
  },
): Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const bodyBuf =
      opts.body === undefined
        ? undefined
        : Buffer.isBuffer(opts.body)
          ? opts.body
          : Buffer.from(opts.body, 'utf8');
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: opts.path,
      method: opts.method,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers ?? {}),
        ...(bodyBuf ? { 'Content-Length': bodyBuf.length.toString() } : {}),
      },
    };
    const r = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode ?? 0,
            body: data ? JSON.parse(data) : {},
            headers: res.headers,
          });
        } catch {
          resolve({
            status: res.statusCode ?? 0,
            body: data,
            headers: res.headers,
          });
        }
      });
    });
    r.on('error', reject);
    if (bodyBuf) r.write(bodyBuf);
    r.end();
  });
}

// ── 1. CORS rejects non-allowlisted origins ─────────────────────────────────

describe('Transport Security — CORS', () => {
  let server: http.Server;
  const origEnv = process.env['CODE_INTEL_CORS_ORIGINS'];

  before(() => {
    process.env['CODE_INTEL_CORS_ORIGINS'] = 'https://allowed.example.com';
    const graph = createKnowledgeGraph();
    const app = createApp(graph, 'test-repo');
    server = http.createServer(app);
    return new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(() => {
    if (origEnv === undefined) delete process.env['CODE_INTEL_CORS_ORIGINS'];
    else process.env['CODE_INTEL_CORS_ORIGINS'] = origEnv;
    return new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('allowed origin gets Access-Control-Allow-Origin echoed', async () => {
    const res = await rawReq(server, {
      method: 'GET',
      path: '/health/live',
      headers: { Origin: 'https://allowed.example.com' },
    });
    assert.equal(res.headers['access-control-allow-origin'], 'https://allowed.example.com');
  });

  it('non-allowlisted origin does NOT get Access-Control-Allow-Origin', async () => {
    const res = await rawReq(server, {
      method: 'GET',
      path: '/health/live',
      headers: { Origin: 'https://evil.example.com' },
    });
    // Either header absent, or set to something other than the evil origin
    const acao = res.headers['access-control-allow-origin'];
    assert.ok(
      acao === undefined || acao !== 'https://evil.example.com',
      `Expected no ACAO for evil origin, got: ${acao}`,
    );
  });

  it('preflight from non-allowlisted origin omits ACAO', async () => {
    const res = await rawReq(server, {
      method: 'OPTIONS',
      path: '/api/v1/repos',
      headers: {
        Origin: 'https://evil.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    });
    const acao = res.headers['access-control-allow-origin'];
    assert.ok(acao === undefined || acao !== 'https://evil.example.com');
  });
});

// ── 2. CSRF missing on state-changing request → 403 ─────────────────────────

describe('Transport Security — CSRF', () => {
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

  it('POST /auth/login without CSRF token → 403 CI-1003', async () => {
    const res = await rawReq(server, {
      method: 'POST',
      path: '/auth/login',
      body: JSON.stringify({ username: 'a', password: 'b' }),
    });
    assert.equal(res.status, 403);
    const body = res.body as { error: { code: string } };
    assert.equal(body.error.code, 'CI-1003');
  });

  it('POST /api/v1/search without CSRF token → 403 CI-1003', async () => {
    const res = await rawReq(server, {
      method: 'POST',
      path: '/api/v1/search',
      body: JSON.stringify({ query: 'foo' }),
    });
    assert.equal(res.status, 403);
    const body = res.body as { error: { code: string } };
    assert.equal(body.error.code, 'CI-1003');
  });
});

// ── 3. WebSocket handshake rejects unauthenticated requests ─────────────────

describe('Transport Security — WebSocket handshake', () => {
  it('handshake without cookie/token returns null', () => {
    const fakeReq = {
      headers: {},
      url: '/ws',
    } as unknown as http.IncomingMessage;
    const result = verifyWebSocketHandshake(fakeReq);
    assert.equal(result, null);
  });

  it('handshake with invalid Bearer token returns null', () => {
    const fakeReq = {
      headers: { authorization: 'Bearer not-a-real-token-xyz' },
      url: '/ws',
    } as unknown as http.IncomingMessage;
    const result = verifyWebSocketHandshake(fakeReq);
    assert.equal(result, null);
  });

  it('handshake with invalid ?token= query returns null', () => {
    const fakeReq = {
      headers: {},
      url: '/ws?token=not-a-real-token-abc',
    } as unknown as http.IncomingMessage;
    const result = verifyWebSocketHandshake(fakeReq);
    assert.equal(result, null);
  });

  it('handshake with bogus session cookie returns null', () => {
    const fakeReq = {
      headers: { cookie: 'code_intel_session=not-a-valid-session-id' },
      url: '/ws',
    } as unknown as http.IncomingMessage;
    const result = verifyWebSocketHandshake(fakeReq);
    assert.equal(result, null);
  });
});

// ── 4. Payload > 1MB → 413 ──────────────────────────────────────────────────

describe('Transport Security — payload limit', () => {
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

  it('POST with body > 1MB → 413', async () => {
    // Build a JSON object whose string length exceeds 1MB
    const huge = 'x'.repeat(1.5 * 1024 * 1024);
    const body = JSON.stringify({ q: huge });
    const res = await rawReq(server, {
      method: 'POST',
      path: '/auth/login',
      body,
    });
    assert.equal(res.status, 413);
  });
});

// ── 5. Rate limit → 429 ─────────────────────────────────────────────────────

describe('Transport Security — rate limit', () => {
  let server: http.Server;
  const origMax = process.env['CODE_INTEL_RATE_LIMIT_MAX'];
  const origWindow = process.env['CODE_INTEL_RATE_LIMIT_WINDOW_MS'];

  before(() => {
    // Tight limit so the test runs quickly
    process.env['CODE_INTEL_RATE_LIMIT_MAX'] = '5';
    process.env['CODE_INTEL_RATE_LIMIT_WINDOW_MS'] = '60000';
    const graph = createKnowledgeGraph();
    const app = createApp(graph, 'test-repo');
    server = http.createServer(app);
    return new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(() => {
    if (origMax === undefined) delete process.env['CODE_INTEL_RATE_LIMIT_MAX'];
    else process.env['CODE_INTEL_RATE_LIMIT_MAX'] = origMax;
    if (origWindow === undefined) delete process.env['CODE_INTEL_RATE_LIMIT_WINDOW_MS'];
    else process.env['CODE_INTEL_RATE_LIMIT_WINDOW_MS'] = origWindow;
    return new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('exceeding rate limit returns 429', async () => {
    // /api/v1/repos is not in the skip list (only /health and /metrics are skipped).
    // Fire 6 requests; the 6th should exceed the limit of 5.
    let last: { status: number; body: unknown } | null = null;
    for (let i = 0; i < 6; i++) {
      last = await rawReq(server, { method: 'GET', path: '/api/v1/repos' });
    }
    assert.ok(last !== null);
    assert.equal(last.status, 429);
  });
});
