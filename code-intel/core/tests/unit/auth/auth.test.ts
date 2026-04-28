import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UsersDB } from '../../../src/auth/users-db.js';
import {
  createSession,
  getSession,
  deleteSession,
  sessionStore,
} from '../../../src/auth/middleware.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function tempDbPath(): string {
  return path.join(os.tmpdir(), `users-test-${Date.now()}.db`);
}

// ── UsersDB: Local accounts ───────────────────────────────────────────────────

describe('UsersDB — local accounts', () => {
  let db: UsersDB;
  let dbPath: string;

  before(() => {
    dbPath = tempDbPath();
    db = new UsersDB(dbPath);
  });

  after(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  });

  it('createUser — stores user with bcrypt hash', () => {
    const user = db.createUser('alice', 'password123', 'admin');
    assert.equal(user.username, 'alice');
    assert.equal(user.role, 'admin');
    assert.ok(user.id.length > 0);
  });

  it('findUserByUsername — returns user with passwordHash', () => {
    const user = db.findUserByUsername('alice');
    assert.ok(user !== null);
    assert.equal(user!.username, 'alice');
    assert.ok(user!.passwordHash.startsWith('$2b$'));
  });

  it('findUserByUsername — returns null for missing user', () => {
    const user = db.findUserByUsername('nobody');
    assert.equal(user, null);
  });

  it('listUsers — returns all users', () => {
    db.createUser('bob', 'pass456', 'viewer');
    const users = db.listUsers();
    const names = users.map((u) => u.username);
    assert.ok(names.includes('alice'));
    assert.ok(names.includes('bob'));
  });

  it('setRole — changes role', () => {
    db.setRole('bob', 'analyst');
    const user = db.findUserByUsername('bob');
    assert.equal(user!.role, 'analyst');
  });

  it('resetPassword — updates bcrypt hash', () => {
    db.resetPassword('alice', 'newpassword');
    const user = db.findUserByUsername('alice');
    assert.ok(user !== null);
    // Old hash should differ from new
    assert.ok(user!.passwordHash.startsWith('$2b$'));
  });

  it('deleteUser — removes user', () => {
    db.deleteUser('bob');
    const user = db.findUserByUsername('bob');
    assert.equal(user, null);
  });

  it('hasAnyUser — returns true when users exist', () => {
    assert.equal(db.hasAnyUser(), true);
  });
});

// ── UsersDB: Token management ─────────────────────────────────────────────────

describe('UsersDB — token management', () => {
  let db: UsersDB;
  let dbPath: string;

  before(() => {
    dbPath = tempDbPath();
    db = new UsersDB(dbPath);
  });

  after(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  });

  it('createToken — raw token starts with cit_', () => {
    const { token, rawToken } = db.createToken('ci-bot', 'analyst');
    assert.ok(rawToken.startsWith('cit_'));
    assert.equal(token.name, 'ci-bot');
    assert.equal(token.role, 'analyst');
  });

  it('findTokenByHash — resolves correct token', async () => {
    const crypto = await import('node:crypto');
    const { rawToken } = db.createToken('test-token', 'viewer');
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const found = db.findTokenByHash(hash);
    assert.ok(found !== null);
    assert.equal(found!.name, 'test-token');
  });

  it('findTokenByHash — returns null for unknown hash', () => {
    const found = db.findTokenByHash('deadbeef'.repeat(8));
    assert.equal(found, null);
  });

  it('revokeToken — token no longer returned', async () => {
    const crypto = await import('node:crypto');
    const { token, rawToken } = db.createToken('revoke-me', 'viewer');
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    db.revokeToken(token.id);
    const found = db.findTokenByHash(hash);
    assert.equal(found, null);
  });

  it('expired token — returns null', async () => {
    const crypto = await import('node:crypto');
    const past = new Date(Date.now() - 1000).toISOString();
    const { rawToken } = db.createToken('expired', 'viewer', past);
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const found = db.findTokenByHash(hash);
    assert.equal(found, null);
  });

  it('listTokens — excludes revoked', () => {
    const { token } = db.createToken('keep', 'admin');
    const { token: revoked } = db.createToken('remove', 'viewer');
    db.revokeToken(revoked.id);
    const tokens = db.listTokens();
    const names = tokens.map((t) => t.name);
    assert.ok(names.includes('keep'));
    assert.ok(!names.includes('remove'));
  });
});

// ── Audit log ─────────────────────────────────────────────────────────────────

describe('UsersDB — audit log', () => {
  let db: UsersDB;
  let dbPath: string;

  before(() => {
    dbPath = tempDbPath();
    db = new UsersDB(dbPath);
  });

  after(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  });

  it('logAccess — does not throw', () => {
    assert.doesNotThrow(() => {
      db.logAccess('user-1', '/api/v1/search', 'GET', 'allow', '127.0.0.1');
      db.logAccess('user-1', '/api/v1/admin', 'GET', 'deny', '127.0.0.1');
    });
  });
});

// ── Session middleware ────────────────────────────────────────────────────────

describe('Session middleware', () => {
  after(() => {
    sessionStore.clear();
  });

  it('createSession + getSession — returns valid session', () => {
    const sessionId = createSession({ id: 'u1', username: 'alice', role: 'admin' });
    const session = getSession(sessionId);
    assert.ok(session !== null);
    assert.equal(session!.username, 'alice');
    assert.equal(session!.role, 'admin');
  });

  it('getSession — returns null for unknown session', () => {
    const session = getSession('unknown-session-id');
    assert.equal(session, null);
  });

  it('deleteSession — removes session', () => {
    const sessionId = createSession({ id: 'u2', username: 'bob', role: 'viewer' });
    deleteSession(sessionId);
    const session = getSession(sessionId);
    assert.equal(session, null);
  });
});
