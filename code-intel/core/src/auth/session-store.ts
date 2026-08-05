import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { Database, type SqliteDatabase } from '../shared/sqlite.js';
import { getOrCreateUsersDB, getUsersDBPath, type Role } from './users-db.js';

const DEFAULT_SESSION_TTL_HOURS = 8;
export const REMEMBER_ME_TTL_MS = 12 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_CLEANUP_BATCH = 500;

export interface SessionUser {
  id: string;
  username: string;
  role: Role;
}

export interface CreatedSession {
  rawToken: string;
  sessionId: string;
  expiresAt: number;
  ttlMs: number;
  rememberMe: boolean;
}

export interface ResolvedSession {
  sessionId: string;
  user: SessionUser;
  expiresAt: number;
  ttlMs: number;
  rememberMe: boolean;
  renewed: boolean;
}

export interface TouchedSession {
  sessionId: string;
  expiresAt: number;
  ttlMs: number;
  rememberMe: boolean;
  renewed: boolean;
}

interface SessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  ttlMs: number;
  rememberMe: number;
  revokedAt: number | null;
}

function normalSessionTtlMs(): number {
  const hours = Number.parseInt(process.env['CODE_INTEL_SESSION_TTL_HOURS'] ?? `${DEFAULT_SESSION_TTL_HOURS}`, 10);
  return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SESSION_TTL_HOURS) * 60 * 60 * 1000;
}

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function isPlausibleToken(rawToken: string): boolean {
  return /^[A-Za-z0-9_-]{40,}$/.test(rawToken);
}

export class PersistentSessionStore {
  private readonly db: SqliteDatabase;
  private readonly cleanupTimer: NodeJS.Timeout | null;

  constructor(
    dbPath = getUsersDBPath(),
    options: { startCleanupTimer?: boolean } = {},
  ) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.ensureSchema();
    this.purgeExpired(Date.now(), DEFAULT_CLEANUP_BATCH);

    if (options.startCleanupTimer !== false && process.env['NODE_ENV'] !== 'test') {
      const cleanupTimer = setInterval(() => {
        try { this.purgeExpired(Date.now(), DEFAULT_CLEANUP_BATCH); } catch { /* fail closed at lookup sites */ }
      }, CLEANUP_INTERVAL_MS);
      cleanupTimer.unref();
      this.cleanupTimer = cleanupTimer;
    } else {
      this.cleanupTimer = null;
    }
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tokenHash TEXT UNIQUE NOT NULL,
        createdAt INTEGER NOT NULL,
        lastSeenAt INTEGER NOT NULL,
        expiresAt INTEGER NOT NULL,
        ttlMs INTEGER NOT NULL,
        rememberMe INTEGER NOT NULL DEFAULT 0,
        revokedAt INTEGER NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions(tokenHash);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(userId);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expiresAt);
    `);
  }

  create(userId: string, rememberMe = false, now = Date.now()): CreatedSession {
    const user = this.db
      .prepare('SELECT id FROM users WHERE id = ? AND disabledAt IS NULL')
      .get(userId) as { id: string } | undefined;
    if (!user) throw new Error('Cannot create session for missing or disabled user');

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(rawToken);
    const sessionId = uuidv4();
    const ttlMs = rememberMe ? REMEMBER_ME_TTL_MS : normalSessionTtlMs();
    const expiresAt = now + ttlMs;

    this.db.prepare(`
      INSERT INTO auth_sessions
        (id, userId, tokenHash, createdAt, lastSeenAt, expiresAt, ttlMs, rememberMe, revokedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(sessionId, userId, tokenHash, now, now, expiresAt, ttlMs, rememberMe ? 1 : 0);

    return { rawToken, sessionId, expiresAt, ttlMs, rememberMe };
  }

  resolve(rawToken: string, now = Date.now()): ResolvedSession | null {
    if (!isPlausibleToken(rawToken)) return null;
    const tokenHash = hashToken(rawToken);
    let row = this.findActiveByHash(tokenHash);
    if (!row || row.expiresAt <= now) return null;

    const user = this.db.prepare(
      'SELECT id, username, role FROM users WHERE id = ? AND disabledAt IS NULL',
    ).get(row.userId) as { id: string; username: string; role: string } | undefined;
    if (!user) {
      this.revokeById(row.id, now);
      return null;
    }

    const touched = this.touch(row.id, now);
    if (!touched) return null;

    return {
      ...touched,
      user: { id: user.id, username: user.username, role: user.role as Role },
    };
  }

  touch(sessionId: string, now = Date.now()): TouchedSession | null {
    let row = this.findActiveById(sessionId);
    if (!row || row.expiresAt <= now) return null;

    let renewed = false;
    if (row.expiresAt - now < row.ttlMs * 0.75) {
      const newExpiresAt = now + row.ttlMs;
      const threshold = now + row.ttlMs * 0.75;
      const result = this.db.prepare(`
        UPDATE auth_sessions
        SET lastSeenAt = ?, expiresAt = ?
        WHERE id = ?
          AND revokedAt IS NULL
          AND expiresAt > ?
          AND expiresAt < ?
      `).run(now, newExpiresAt, row.id, now, threshold);
      if (result.changes > 0) {
        row = { ...row, lastSeenAt: now, expiresAt: newExpiresAt };
        renewed = true;
      } else {
        row = this.findActiveById(sessionId);
        if (!row || row.expiresAt <= now) return null;
      }
    }

    return {
      sessionId: row.id,
      expiresAt: row.expiresAt,
      ttlMs: row.ttlMs,
      rememberMe: row.rememberMe === 1,
      renewed,
    };
  }

  revoke(rawToken: string, now = Date.now()): boolean {
    if (!isPlausibleToken(rawToken)) return false;
    const result = this.db.prepare(
      'UPDATE auth_sessions SET revokedAt = ? WHERE tokenHash = ? AND revokedAt IS NULL',
    ).run(now, hashToken(rawToken));
    return result.changes > 0;
  }

  revokeAllForUser(userId: string, now = Date.now()): number {
    return this.db.prepare(
      'UPDATE auth_sessions SET revokedAt = ? WHERE userId = ? AND revokedAt IS NULL',
    ).run(now, userId).changes;
  }

  purgeExpired(now = Date.now(), batchSize = DEFAULT_CLEANUP_BATCH): number {
    const boundedBatch = Math.max(1, Math.min(Math.trunc(batchSize), 10_000));
    return this.db.prepare(`
      DELETE FROM auth_sessions
      WHERE id IN (
        SELECT id FROM auth_sessions
        WHERE expiresAt <= ? OR revokedAt IS NOT NULL
        ORDER BY expiresAt ASC
        LIMIT ?
      )
    `).run(now, boundedBatch).changes;
  }

  countActive(now = Date.now()): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) AS count FROM auth_sessions WHERE revokedAt IS NULL AND expiresAt > ?',
    ).get(now) as { count: number };
    return row.count;
  }

  getRecordForTesting(rawToken: string): SessionRow | null {
    if (!isPlausibleToken(rawToken)) return null;
    return (this.db.prepare('SELECT * FROM auth_sessions WHERE tokenHash = ?')
      .get(hashToken(rawToken)) as SessionRow | undefined) ?? null;
  }

  setExpiresAtForTesting(rawToken: string, expiresAt: number): void {
    this.db.prepare('UPDATE auth_sessions SET expiresAt = ? WHERE tokenHash = ?')
      .run(expiresAt, hashToken(rawToken));
  }

  clearForTesting(): void {
    this.db.prepare('DELETE FROM auth_sessions').run();
  }

  close(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.db.close();
  }

  private findActiveById(sessionId: string): SessionRow | null {
    return (this.db.prepare(`
      SELECT id, userId, tokenHash, createdAt, lastSeenAt, expiresAt, ttlMs, rememberMe, revokedAt
      FROM auth_sessions
      WHERE id = ? AND revokedAt IS NULL
    `).get(sessionId) as SessionRow | undefined) ?? null;
  }

  private findActiveByHash(tokenHash: string): SessionRow | null {
    return (this.db.prepare(`
      SELECT id, userId, tokenHash, createdAt, lastSeenAt, expiresAt, ttlMs, rememberMe, revokedAt
      FROM auth_sessions
      WHERE tokenHash = ? AND revokedAt IS NULL
    `).get(tokenHash) as SessionRow | undefined) ?? null;
  }

  private revokeById(sessionId: string, now: number): void {
    this.db.prepare('UPDATE auth_sessions SET revokedAt = ? WHERE id = ? AND revokedAt IS NULL')
      .run(now, sessionId);
  }
}

let singleton: PersistentSessionStore | null = null;
let singletonPath: string | null = null;

export function getOrCreateSessionStore(): PersistentSessionStore {
  getOrCreateUsersDB(); // ensure auth schema migrations are complete before session access
  const dbPath = getUsersDBPath();
  if (!singleton || singletonPath !== dbPath) {
    if (singleton) {
      try { singleton.close(); } catch { /* ignore */ }
    }
    singleton = new PersistentSessionStore(dbPath);
    singletonPath = dbPath;
  }
  return singleton;
}

export function resetSessionStoreForTesting(): void {
  if (singleton) {
    try { singleton.close(); } catch { /* ignore */ }
  }
  singleton = null;
  singletonPath = null;
}
