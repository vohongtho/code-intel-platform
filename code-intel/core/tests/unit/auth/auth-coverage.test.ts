/**
 * Auth module — path coverage tests (Epic 8)
 *
 * Pure unit tests — no DB creation, no bcrypt, no network.
 * Covers branches in middleware.ts and websocket-auth.ts
 * that are not exercised by existing tests.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSession,
  getSession,
  deleteSession,
  sessionStore,
  buildSessionCookie,
  clearSessionCookie,
  parseCookies,
  requireAuth,
  requireRole,
  requireRepoAccess,
  requireToolScope,
  requestIdMiddleware,
} from '../../../src/auth/middleware.js';
import type { Request, Response, NextFunction } from 'express';

// ── Minimal mocks ─────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    requestId: 'test-req-id',
    ...overrides,
  } as unknown as Request;
}

function makeRes() {
  const calls: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  const res = {
    _calls: calls,
    status(code: number) { calls.status = code; return res; },
    json(body: unknown) { calls.body = body; return res; },
    setHeader(name: string, value: string) { calls.headers[name] = value; return res; },
    on(_evt: string, _cb: () => void) { return res; },
  };
  return res as unknown as Response & { _calls: typeof calls };
}

function makeNext(): { isCalled: boolean; fn: NextFunction } {
  const obj = { isCalled: false, fn: (() => {}) as NextFunction };
  obj.fn = () => { obj.isCalled = true; };
  return obj;
}

// ── parseCookies ──────────────────────────────────────────────────────────────

describe('parseCookies — branches', () => {
  it('empty string returns empty object', () => {
    assert.deepEqual(parseCookies(''), {});
  });

  it('parses single cookie', () => {
    assert.equal(parseCookies('session=abc123')['session'], 'abc123');
  });

  it('parses multiple cookies', () => {
    const r = parseCookies('a=1; b=2');
    assert.equal(r['a'], '1');
    assert.equal(r['b'], '2');
  });

  it('handles encoded values', () => {
    const encoded = encodeURIComponent('hello world');
    assert.equal(parseCookies(`session=${encoded}`)['session'], 'hello world');
  });

  it('handles = sign inside value', () => {
    assert.equal(parseCookies('token=a=b=c')['token'], 'a=b=c');
  });
});

// ── Session sliding window renewal ────────────────────────────────────────────

describe('getSession — sliding window', () => {
  after(() => sessionStore.clear());

  it('renews expiresAt when < 75% TTL remains', () => {
    const sid = createSession({ id: 'sw1', username: 'alice', role: 'admin' });
    const entry = sessionStore.get(sid)!;
    const ttlMs = 8 * 60 * 60 * 1000;
    entry.expiresAt = Date.now() + ttlMs * 0.1; // only 10% left → should renew
    const oldExpiry = entry.expiresAt;
    const result = getSession(sid);
    assert.ok(result !== null);
    assert.ok(sessionStore.get(sid)!.expiresAt > oldExpiry, 'expiresAt should renew');
  });

  it('does not renew when > 75% TTL remains', () => {
    const sid = createSession({ id: 'sw2', username: 'bob', role: 'viewer' });
    const entry = sessionStore.get(sid)!;
    const originalExpiry = entry.expiresAt;
    getSession(sid);
    assert.ok(Math.abs(sessionStore.get(sid)!.expiresAt - originalExpiry) <= 2);
  });

  it('returns null and deletes expired session', () => {
    const sid = createSession({ id: 'sw3', username: 'carol', role: 'analyst' });
    sessionStore.get(sid)!.expiresAt = Date.now() - 1;
    assert.equal(getSession(sid), null);
    assert.equal(sessionStore.has(sid), false);
  });
});

// ── deleteSession ─────────────────────────────────────────────────────────────

describe('deleteSession', () => {
  after(() => sessionStore.clear());

  it('removes session from store', () => {
    const sid = createSession({ id: 'del1', username: 'alice', role: 'admin' });
    assert.ok(sessionStore.has(sid));
    deleteSession(sid);
    assert.ok(!sessionStore.has(sid));
  });

  it('no-op for unknown session', () => {
    assert.doesNotThrow(() => deleteSession('unknown-session-xyz'));
  });
});

// ── requireAuth ───────────────────────────────────────────────────────────────

describe('requireAuth', () => {
  it('calls next when req.user is set', () => {
    const req = makeReq({ user: { id: 'u1', username: 'alice', role: 'admin', authMethod: 'session' } } as Partial<Request>);
    const n = makeNext();
    requireAuth(req, makeRes(), n.fn);
    assert.ok(n.isCalled);
  });

  it('returns 401 when req.user is missing', () => {
    const req = makeReq();
    const res = makeRes();
    const n = makeNext();
    requireAuth(req, res, n.fn);
    assert.equal(res._calls.status, 401);
    assert.equal(n.isCalled, false);
  });
});

// ── requireRole ───────────────────────────────────────────────────────────────

describe('requireRole — branches', () => {
  it('calls next when role matches', () => {
    const req = makeReq({ user: { id: 'u1', username: 'a', role: 'admin', authMethod: 'session' } } as Partial<Request>);
    const n = makeNext();
    requireRole('admin')(req, makeRes(), n.fn);
    assert.ok(n.isCalled);
  });

  it('returns 403 when role does not match', () => {
    const req = makeReq({ user: { id: 'u2', username: 'v', role: 'viewer', authMethod: 'session' } } as Partial<Request>);
    const res = makeRes();
    const n = makeNext();
    requireRole('admin')(req, res, n.fn);
    assert.equal(res._calls.status, 403);
  });

  it('returns 401 when no user', () => {
    const res = makeRes();
    const n = makeNext();
    requireRole('admin')(makeReq(), res, n.fn);
    assert.equal(res._calls.status, 401);
  });

  it('accepts any of multiple roles', () => {
    const req = makeReq({ user: { id: 'u3', username: 'b', role: 'analyst', authMethod: 'session' } } as Partial<Request>);
    const n = makeNext();
    requireRole('admin', 'analyst')(req, makeRes(), n.fn);
    assert.ok(n.isCalled);
  });
});

// ── requireRepoAccess — all branches ─────────────────────────────────────────

describe('requireRepoAccess — all branches', () => {
  it('401 when not authenticated', () => {
    const res = makeRes();
    const n = makeNext();
    requireRepoAccess(() => 'repo-1')(makeReq(), res, n.fn);
    assert.equal(res._calls.status, 401);
    assert.equal(n.isCalled, false);
  });

  it('admin passes without repo check', () => {
    const req = makeReq({ user: { id: 'u1', username: 'admin', role: 'admin', authMethod: 'session' } } as Partial<Request>);
    const n = makeNext();
    requireRepoAccess(() => 'repo-1')(req, makeRes(), n.fn);
    assert.ok(n.isCalled);
  });

  it('analyst passes without repo check', () => {
    const req = makeReq({ user: { id: 'u2', username: 'ana', role: 'analyst', authMethod: 'session' } } as Partial<Request>);
    const n = makeNext();
    requireRepoAccess(() => 'repo-1')(req, makeRes(), n.fn);
    assert.ok(n.isCalled);
  });

  it('token with matching scoped repo is allowed', () => {
    const req = makeReq({ user: { id: 'u3', username: 'tok', role: 'viewer', authMethod: 'token', scopedRepos: ['allowed'] } } as Partial<Request>);
    const n = makeNext();
    requireRepoAccess(() => 'allowed')(req, makeRes(), n.fn);
    assert.ok(n.isCalled);
  });

  it('token with mismatched scoped repo → 403', () => {
    const req = makeReq({ user: { id: 'u4', username: 'tok', role: 'viewer', authMethod: 'token', scopedRepos: ['allowed'] } } as Partial<Request>);
    const res = makeRes();
    const n = makeNext();
    requireRepoAccess(() => 'other')(req, res, n.fn);
    assert.equal(res._calls.status, 403);
    assert.equal(n.isCalled, false);
  });

  it('token with empty scopedRepos array is allowed (no restriction)', () => {
    const req = makeReq({ user: { id: 'u5', username: 'tok', role: 'viewer', authMethod: 'token', scopedRepos: [] } } as Partial<Request>);
    const n = makeNext();
    requireRepoAccess(() => 'any')(req, makeRes(), n.fn);
    assert.ok(n.isCalled);
  });

  it('viewer session (no token scoping) is allowed', () => {
    const req = makeReq({ user: { id: 'u6', username: 'v', role: 'viewer', authMethod: 'session' } } as Partial<Request>);
    const n = makeNext();
    requireRepoAccess(() => 'any')(req, makeRes(), n.fn);
    assert.ok(n.isCalled);
  });
});

// ── requireToolScope — all branches ──────────────────────────────────────────

describe('requireToolScope — all branches', () => {
  it('401 when not authenticated', () => {
    const res = makeRes();
    const n = makeNext();
    requireToolScope('search')(makeReq(), res, n.fn);
    assert.equal(res._calls.status, 401);
    assert.equal(n.isCalled, false);
  });

  it('allows when scopedTools is undefined', () => {
    const req = makeReq({ user: { id: 'u1', username: 'tok', role: 'analyst', authMethod: 'token' } } as Partial<Request>);
    const n = makeNext();
    requireToolScope('search')(req, makeRes(), n.fn);
    assert.ok(n.isCalled);
  });

  it('allows when scopedTools is empty array', () => {
    const req = makeReq({ user: { id: 'u2', username: 'tok', role: 'analyst', authMethod: 'token', scopedTools: [] } } as Partial<Request>);
    const n = makeNext();
    requireToolScope('search')(req, makeRes(), n.fn);
    assert.ok(n.isCalled);
  });

  it('allows when tool is in scopedTools', () => {
    const req = makeReq({ user: { id: 'u3', username: 'tok', role: 'analyst', authMethod: 'token', scopedTools: ['search', 'grep'] } } as Partial<Request>);
    const n = makeNext();
    requireToolScope('search')(req, makeRes(), n.fn);
    assert.ok(n.isCalled);
  });

  it('403 when tool is NOT in scopedTools', () => {
    const req = makeReq({ user: { id: 'u4', username: 'tok', role: 'analyst', authMethod: 'token', scopedTools: ['grep'] } } as Partial<Request>);
    const res = makeRes();
    const n = makeNext();
    requireToolScope('search')(req, res, n.fn);
    assert.equal(res._calls.status, 403);
    const body = res._calls.body as { error: { code: string } };
    assert.equal(body.error.code, 'CI-1001');
    assert.equal(n.isCalled, false);
  });
});

// ── requestIdMiddleware ───────────────────────────────────────────────────────

describe('requestIdMiddleware', () => {
  it('sets req.requestId and X-Request-ID header', () => {
    const req = makeReq();
    const res = makeRes();
    const n = makeNext();
    requestIdMiddleware(req, res, n.fn);
    assert.ok(n.isCalled);
    assert.ok(typeof req.requestId === 'string' && req.requestId.length > 0);
    assert.ok(res._calls.headers['X-Request-ID']?.length > 0);
  });

  it('generates unique IDs per request', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const req = makeReq();
      requestIdMiddleware(req, makeRes(), () => {});
      ids.add(req.requestId!);
    }
    assert.equal(ids.size, 10);
  });
});

// ── buildSessionCookie — env flags ────────────────────────────────────────────

describe('buildSessionCookie — env flags', () => {
  const origEnv = process.env['NODE_ENV'];
  after(() => {
    if (origEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = origEnv;
  });

  it('production: includes Secure and SameSite=Strict', () => {
    process.env['NODE_ENV'] = 'production';
    const cookie = buildSessionCookie('prod-sid');
    assert.ok(cookie.includes('Secure'));
    assert.ok(cookie.includes('SameSite=Strict'));
  });

  it('development: no Secure flag, SameSite=Lax', () => {
    process.env['NODE_ENV'] = 'development';
    const cookie = buildSessionCookie('dev-sid');
    assert.ok(!cookie.includes('Secure'));
    assert.ok(cookie.includes('SameSite=Lax'));
  });
});

// ── clearSessionCookie ────────────────────────────────────────────────────────

describe('clearSessionCookie', () => {
  it('returns Max-Age=0 and HttpOnly', () => {
    const cookie = clearSessionCookie();
    assert.ok(cookie.includes('Max-Age=0'));
    assert.ok(cookie.includes('HttpOnly'));
  });
});
