import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { createApp } from '../../../src/http/app.js';
import { getOrCreateUsersDB, resetUsersDBForTesting } from '../../../src/auth/users-db.js';
import { getOrCreateSessionStore, resetSessionStoreForTesting } from '../../../src/auth/session-store.js';

interface HttpResult {
  status: number;
  body: unknown;
  headers: http.IncomingHttpHeaders;
}

function rawRequest(
  server: http.Server,
  options: { method: string; path: string; body?: unknown; headers?: Record<string, string> },
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const address = server.address() as { port: number };
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const request = http.request({
      hostname: '127.0.0.1',
      port: address.port,
      method: options.method,
      path: options.path,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
      },
    }, (response) => {
      let data = '';
      response.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      response.on('end', () => {
        let body: unknown = data;
        try { body = data ? JSON.parse(data) : {}; } catch { /* keep text */ }
        resolve({ status: response.statusCode ?? 0, body, headers: response.headers });
      });
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function cookiePair(setCookie: string | string[] | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values.map((value) => value.split(';')[0] ?? '').filter(Boolean).join('; ');
}

async function csrfPost(
  server: http.Server,
  pathName: string,
  body: unknown,
  sessionCookie = '',
): Promise<HttpResult> {
  const tokenResponse = await rawRequest(server, {
    method: 'GET',
    path: '/auth/csrf-token',
    headers: sessionCookie ? { Cookie: sessionCookie } : undefined,
  });
  const csrfToken = (tokenResponse.body as { csrfToken: string }).csrfToken;
  const csrfCookie = cookiePair(tokenResponse.headers['set-cookie']);
  const cookie = [sessionCookie, csrfCookie].filter(Boolean).join('; ');
  return rawRequest(server, {
    method: 'POST',
    path: pathName,
    body,
    headers: {
      'x-csrf-token': csrfToken,
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
}

function startServer(): Promise<http.Server> {
  const app = createApp(createKnowledgeGraph(), 'session-restart-test');
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe('persistent remembered session restart regression', () => {
  const previousNodeEnv = process.env['NODE_ENV'];
  const dbPath = path.join(
    os.tmpdir(),
    `persistent-session-restart-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`,
  );

  after(() => {
    resetSessionStoreForTesting();
    resetUsersDBForTesting();
    delete process.env['CODE_INTEL_USERS_DB_PATH'];
    if (previousNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = previousNodeEnv;
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore */ }
    }
  });

  it('survives restart and remains revoked after logout plus another restart', async () => {
    process.env['CODE_INTEL_USERS_DB_PATH'] = dbPath;
    process.env['NODE_ENV'] = 'test';
    resetSessionStoreForTesting();
    resetUsersDBForTesting();
    getOrCreateUsersDB().createUser('remember-user', 'remember-password-123', 'admin');

    const serverA = await startServer();
    const login = await csrfPost(serverA, '/auth/login', {
      username: 'remember-user',
      password: 'remember-password-123',
      rememberMe: true,
    });
    assert.equal(login.status, 200);
    const setCookies = login.headers['set-cookie'] ?? [];
    assert.ok(setCookies.some((value) => value.includes('Max-Age=43200')));
    const sessionCookie = cookiePair(setCookies);
    assert.match(sessionCookie, /code_intel_session=/);
    await stopServer(serverA);

    resetSessionStoreForTesting();
    resetUsersDBForTesting();
    const serverB = await startServer();
    const statusAfterRestart = await rawRequest(serverB, {
      method: 'GET',
      path: '/auth/status',
      headers: { Cookie: sessionCookie },
    });
    assert.equal(statusAfterRestart.status, 200);
    assert.equal((statusAfterRestart.body as { authenticated: boolean }).authenticated, true);

    const logout = await csrfPost(serverB, '/auth/logout', {}, sessionCookie);
    assert.equal(logout.status, 200);
    await stopServer(serverB);

    resetSessionStoreForTesting();
    resetUsersDBForTesting();
    const serverC = await startServer();
    const statusAfterLogoutRestart = await rawRequest(serverC, {
      method: 'GET',
      path: '/auth/status',
      headers: { Cookie: sessionCookie },
    });
    assert.equal(statusAfterLogoutRestart.status, 401);
    await stopServer(serverC);
  });

  it('rejects an expired remembered cookie after restart', async () => {
    process.env['CODE_INTEL_USERS_DB_PATH'] = dbPath;
    process.env['NODE_ENV'] = 'test';
    resetSessionStoreForTesting();
    resetUsersDBForTesting();
    if (!getOrCreateUsersDB().findUserByUsername('remember-user')) {
      getOrCreateUsersDB().createUser('remember-user', 'remember-password-123', 'admin');
    }

    const serverA = await startServer();
    const login = await csrfPost(serverA, '/auth/login', {
      username: 'remember-user',
      password: 'remember-password-123',
      rememberMe: true,
    });
    assert.equal(login.status, 200);
    const sessionCookie = cookiePair(login.headers['set-cookie']);
    const rawToken = /code_intel_session=([^;]+)/.exec(sessionCookie)?.[1];
    assert.ok(rawToken);
    getOrCreateSessionStore().setExpiresAtForTesting(decodeURIComponent(rawToken!), Date.now() - 1);
    await stopServer(serverA);

    resetSessionStoreForTesting();
    resetUsersDBForTesting();
    const serverB = await startServer();
    const status = await rawRequest(serverB, {
      method: 'GET',
      path: '/auth/status',
      headers: { Cookie: sessionCookie },
    });
    assert.equal(status.status, 401);
    await stopServer(serverB);
  });
});
