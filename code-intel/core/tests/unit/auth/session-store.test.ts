import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { UsersDB } from '../../../src/auth/users-db.js';
import { Database } from '../../../src/shared/sqlite.js';
import { PersistentSessionStore, REMEMBER_ME_TTL_MS } from '../../../src/auth/session-store.js';

function tempDbPath(): string {
  return path.join(os.tmpdir(), `session-store-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}

describe('PersistentSessionStore', () => {
  let dbPath: string;
  let users: UsersDB;
  let store: PersistentSessionStore;
  let aliceId: string;
  let bobId: string;

  before(() => {
    dbPath = tempDbPath();
    users = new UsersDB(dbPath);
    aliceId = users.createUser('alice-session', 'password123', 'admin').id;
    bobId = users.createUser('bob-session', 'password123', 'viewer').id;
    store = new PersistentSessionStore(dbPath, { startCleanupTimer: false });
  });

  after(() => {
    store.close();
    users.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore */ }
    }
  });

  it('persists only a SHA-256 token hash', () => {
    const created = store.create(aliceId, false, 1_000);
    assert.match(created.rawToken, /^[A-Za-z0-9_-]{40,}$/);
    const record = store.getRecordForTesting(created.rawToken);
    assert.ok(record);
    assert.notEqual(record!.tokenHash, created.rawToken);
    assert.equal(record!.tokenHash.length, 64);
  });

  it('resolves the current user and role', () => {
    const created = store.create(bobId, false);
    users.setRole('bob-session', 'analyst');
    const resolved = store.resolve(created.rawToken);
    assert.ok(resolved);
    assert.equal(resolved!.user.username, 'bob-session');
    assert.equal(resolved!.user.role, 'analyst');
  });

  it('uses the explicit remember-me TTL', () => {
    const now = 10_000;
    const created = store.create(aliceId, true, now);
    assert.equal(created.ttlMs, REMEMBER_ME_TTL_MS);
    assert.equal(created.expiresAt, now + REMEMBER_ME_TTL_MS);
  });

  it('slides expiration only after the 25% elapsed threshold', () => {
    const now = Date.now();
    const created = store.create(aliceId, false, now);
    store.setExpiresAtForTesting(created.rawToken, now + created.ttlMs * 0.1);
    const resolved = store.resolve(created.rawToken, now + 1);
    assert.ok(resolved);
    assert.equal(resolved!.renewed, true);
    assert.ok(resolved!.expiresAt > now + created.ttlMs * 0.9);
  });

  it('rejects expired and malformed tokens', () => {
    const created = store.create(aliceId, false);
    store.setExpiresAtForTesting(created.rawToken, Date.now() - 1);
    assert.equal(store.resolve(created.rawToken), null);
    assert.equal(store.resolve('not-a-session-token'), null);
  });

  it('revokes one session idempotently', () => {
    const created = store.create(aliceId, false);
    assert.equal(store.revoke(created.rawToken), true);
    assert.equal(store.revoke(created.rawToken), false);
    assert.equal(store.resolve(created.rawToken), null);
  });

  it('revokes all sessions for a user', () => {
    const user = users.createUser('revoke-all-session-user', 'password123', 'viewer');
    const first = store.create(user.id, false);
    const second = store.create(user.id, true);
    assert.equal(store.revokeAllForUser(user.id), 2);
    assert.equal(store.resolve(first.rawToken), null);
    assert.equal(store.resolve(second.rawToken), null);
  });

  it('password reset revokes active sessions', () => {
    const created = store.create(aliceId, true);
    users.resetPassword('alice-session', 'new-password-123');
    assert.equal(store.resolve(created.rawToken), null);
  });

  it('disabled users cannot resolve sessions', () => {
    const created = store.create(bobId, true);
    users.disableUser('bob-session');
    assert.equal(store.resolve(created.rawToken), null);
    users.enableUser('bob-session');
  });


  it('cannot renew a session revoked by another store connection', () => {
    const created = store.create(aliceId, true);
    store.setExpiresAtForTesting(created.rawToken, Date.now() + created.ttlMs * 0.1);
    const concurrent = new PersistentSessionStore(dbPath, { startCleanupTimer: false });
    assert.equal(concurrent.revoke(created.rawToken), true);
    assert.equal(store.resolve(created.rawToken), null);
    assert.equal(store.touch(created.sessionId), null);
    concurrent.close();
  });

  it('cannot renew after revoke-all from another store connection', () => {
    const user = users.createUser('concurrent-revoke-all-session-user', 'password123', 'viewer');
    const created = store.create(user.id, true);
    store.setExpiresAtForTesting(created.rawToken, Date.now() + created.ttlMs * 0.1);
    const concurrent = new PersistentSessionStore(dbPath, { startCleanupTimer: false });
    assert.equal(concurrent.revokeAllForUser(user.id), 1);
    assert.equal(store.resolve(created.rawToken), null);
    concurrent.close();
  });

  it('rejects sessions whose user was deleted', () => {
    const user = users.createUser('deleted-session-user', 'password123', 'viewer');
    const created = store.create(user.id, true);
    users.deleteUser(user.username);
    assert.equal(store.resolve(created.rawToken), null);
  });

  it('purges expired and revoked rows in bounded batches', () => {
    store.clearForTesting();
    const a = store.create(aliceId, false);
    const b = store.create(aliceId, false);
    store.setExpiresAtForTesting(a.rawToken, Date.now() - 1);
    store.revoke(b.rawToken);
    assert.equal(store.purgeExpired(Date.now(), 1), 1);
    assert.equal(store.purgeExpired(Date.now(), 10), 1);
    assert.equal(store.countActive(), 0);
  });
});

describe('Persistent session schema migration', () => {
  it('upgrades a current users database and remains idempotent', () => {
    const dbPath = tempDbPath();
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        passwordHash TEXT NOT NULL,
        role TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
      CREATE TABLE tokens (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        hashedToken TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL,
        expiresAt TEXT NULL,
        lastUsedAt TEXT NULL,
        createdAt TEXT NOT NULL,
        revokedAt TEXT NULL
      );
      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        resource TEXT NOT NULL,
        action TEXT NOT NULL,
        outcome TEXT NOT NULL,
        ip TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
    `);
    legacy.close();

    const first = new UsersDB(dbPath);
    const user = first.createUser('migrated-user', 'password123', 'admin');
    first.close();

    const second = new UsersDB(dbPath);
    const store = new PersistentSessionStore(dbPath, { startCleanupTimer: false });
    const created = store.create(user.id, true);
    assert.equal(store.resolve(created.rawToken)?.user.username, 'migrated-user');
    store.close();
    second.close();

    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore */ }
    }
  });
});
