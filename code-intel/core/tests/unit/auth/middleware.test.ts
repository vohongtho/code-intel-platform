import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  requireAuth,
  requireRole,
  buildSessionCookie,
  clearSessionCookie,
  sessionStore,
} from '../../../src/auth/middleware.js';
import type { Request, Response, NextFunction } from 'express';

// Minimal mock for Express Request/Response
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
  const calls: { status?: number; body?: unknown } = {};
  const res = {
    _calls: calls,
    status(code: number) { calls.status = code; return res; },
    json(body: unknown) { calls.body = body; return res; },
    setHeader(_name: string, _value: string) { return res; },
  };
  return res as unknown as Response & { _calls: typeof calls };
}

describe('requireAuth', () => {
  it('calls next() when req.user is set', () => {
    const req = makeReq({ user: { id: 'u1', username: 'alice', role: 'admin', authMethod: 'session' } } as Partial<Request>);
    const res = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };
    requireAuth(req, res, next);
    assert.ok(nextCalled);
  });

  it('returns 401 when req.user is not set', () => {
    const req = makeReq();
    const res = makeRes();
    let nextCalled = false;
    requireAuth(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res._calls.status, 401);
    const body = res._calls.body as { error: { code: string } };
    assert.equal(body.error.code, 'CI-1000');
  });
});

describe('requireRole', () => {
  it('calls next() when user has required role', () => {
    const req = makeReq({ user: { id: 'u1', username: 'alice', role: 'admin', authMethod: 'session' } } as Partial<Request>);
    const res = makeRes();
    let nextCalled = false;
    requireRole('admin')(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('returns 403 when user lacks required role', () => {
    const req = makeReq({ user: { id: 'u1', username: 'alice', role: 'viewer', authMethod: 'session' } } as Partial<Request>);
    const res = makeRes();
    let nextCalled = false;
    requireRole('admin')(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res._calls.status, 403);
    const body = res._calls.body as { error: { code: string } };
    assert.equal(body.error.code, 'CI-1001');
  });

  it('returns 401 when user is not authenticated', () => {
    const req = makeReq();
    const res = makeRes();
    requireRole('admin')(req, res, () => {});
    assert.equal(res._calls.status, 401);
  });

  it('accepts any of multiple allowed roles', () => {
    const req = makeReq({ user: { id: 'u2', username: 'bob', role: 'analyst', authMethod: 'session' } } as Partial<Request>);
    const res = makeRes();
    let nextCalled = false;
    requireRole('admin', 'analyst')(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });
});

describe('buildSessionCookie', () => {
  it('includes session id in cookie string', () => {
    const cookie = buildSessionCookie('my-session-id');
    assert.ok(cookie.includes('my-session-id'));
  });

  it('includes HttpOnly flag', () => {
    const cookie = buildSessionCookie('sid');
    assert.ok(cookie.includes('HttpOnly'));
  });

  it('includes Max-Age', () => {
    const cookie = buildSessionCookie('sid');
    assert.ok(cookie.includes('Max-Age='));
  });

  it('includes Path=/', () => {
    const cookie = buildSessionCookie('sid');
    assert.ok(cookie.includes('Path=/'));
  });
});

describe('clearSessionCookie', () => {
  it('returns cookie with Max-Age=0', () => {
    const cookie = clearSessionCookie();
    assert.ok(cookie.includes('Max-Age=0'));
  });

  it('includes HttpOnly', () => {
    const cookie = clearSessionCookie();
    assert.ok(cookie.includes('HttpOnly'));
  });
});
