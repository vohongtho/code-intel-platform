import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';

export type Role = 'admin' | 'analyst' | 'viewer' | 'repo-owner';

export interface User {
  id: string;
  username: string;
  role: Role;
  createdAt: string;
}

export interface Token {
  id: string;
  name: string;
  role: Role;
  scopedRepos?: string[];   // null/undefined means all repos
  scopedTools?: string[];   // null/undefined means all tools
  expiresAt?: string;
  lastUsedAt?: string;
  createdAt: string;
}

export interface OIDCIdentity {
  id: string;
  userId: string;
  provider: string;   // e.g. 'github', 'google', 'custom'
  sub: string;        // Provider subject identifier
  email?: string;
  name?: string;
  createdAt: string;
  lastLoginAt?: string;
}

const BCRYPT_ROUNDS = 12;

export class UsersDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.createTables();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        passwordHash TEXT NOT NULL,
        role TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tokens (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        hashedToken TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL,
        expiresAt TEXT NULL,
        lastUsedAt TEXT NULL,
        createdAt TEXT NOT NULL,
        revokedAt TEXT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        resource TEXT NOT NULL,
        action TEXT NOT NULL,
        outcome TEXT NOT NULL,
        ip TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
    `);

    // OIDC identities — links a local user to an external provider subject
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oidc_identities (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        sub TEXT NOT NULL,
        email TEXT NULL,
        name TEXT NULL,
        createdAt TEXT NOT NULL,
        lastLoginAt TEXT NULL,
        UNIQUE (provider, sub)
      );
    `);

    // Add columns if they don't exist (idempotent migration)
    try { this.db.exec(`ALTER TABLE tokens ADD COLUMN scopedRepos TEXT NULL`); } catch { /* already exists */ }
    try { this.db.exec(`ALTER TABLE tokens ADD COLUMN scopedTools TEXT NULL`); } catch { /* already exists */ }
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  createUser(username: string, password: string, role: Role): User {
    const id = uuidv4();
    const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    const createdAt = new Date().toISOString();

    this.db
      .prepare(
        'INSERT INTO users (id, username, passwordHash, role, createdAt) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, username, passwordHash, role, createdAt);

    return { id, username, role, createdAt };
  }

  findUserByUsername(username: string): (User & { passwordHash: string }) | null {
    const row = this.db
      .prepare('SELECT id, username, passwordHash, role, createdAt FROM users WHERE username = ?')
      .get(username) as { id: string; username: string; passwordHash: string; role: string; createdAt: string } | undefined;

    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.passwordHash,
      role: row.role as Role,
      createdAt: row.createdAt,
    };
  }

  listUsers(): User[] {
    const rows = this.db
      .prepare('SELECT id, username, role, createdAt FROM users ORDER BY createdAt ASC')
      .all() as { id: string; username: string; role: string; createdAt: string }[];
    return rows.map((r) => ({ id: r.id, username: r.username, role: r.role as Role, createdAt: r.createdAt }));
  }

  deleteUser(username: string): void {
    this.db.prepare('DELETE FROM users WHERE username = ?').run(username);
  }

  setRole(username: string, role: Role): void {
    this.db.prepare('UPDATE users SET role = ? WHERE username = ?').run(role, username);
  }

  resetPassword(username: string, newPassword: string): void {
    const passwordHash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
    this.db.prepare('UPDATE users SET passwordHash = ? WHERE username = ?').run(passwordHash, username);
  }

  // ── Tokens ─────────────────────────────────────────────────────────────────

  createToken(
    name: string,
    role: Role,
    expiresAt?: string,
    scopedRepos?: string[],
    scopedTools?: string[],
  ): { token: Token; rawToken: string } {
    const id = uuidv4();
    const rawToken = `cit_${crypto.randomBytes(32).toString('hex')}`;
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const createdAt = new Date().toISOString();

    this.db
      .prepare(
        'INSERT INTO tokens (id, name, hashedToken, role, expiresAt, lastUsedAt, createdAt, revokedAt, scopedRepos, scopedTools) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)',
      )
      .run(
        id,
        name,
        hashedToken,
        role,
        expiresAt ?? null,
        createdAt,
        scopedRepos ? JSON.stringify(scopedRepos) : null,
        scopedTools ? JSON.stringify(scopedTools) : null,
      );

    const token: Token = { id, name, role, scopedRepos, scopedTools, expiresAt, createdAt };
    return { token, rawToken };
  }

  findTokenByHash(hash: string): Token | null {
    const row = this.db
      .prepare(
        'SELECT id, name, role, expiresAt, lastUsedAt, createdAt, scopedRepos, scopedTools FROM tokens WHERE hashedToken = ? AND revokedAt IS NULL',
      )
      .get(hash) as { id: string; name: string; role: string; expiresAt: string | null; lastUsedAt: string | null; createdAt: string; scopedRepos: string | null; scopedTools: string | null } | undefined;

    if (!row) return null;

    // Check expiry
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) return null;

    return {
      id: row.id,
      name: row.name,
      role: row.role as Role,
      scopedRepos: row.scopedRepos ? (JSON.parse(row.scopedRepos) as string[]) : undefined,
      scopedTools: row.scopedTools ? (JSON.parse(row.scopedTools) as string[]) : undefined,
      expiresAt: row.expiresAt ?? undefined,
      lastUsedAt: row.lastUsedAt ?? undefined,
      createdAt: row.createdAt,
    };
  }

  listTokens(): Token[] {
    const rows = this.db
      .prepare(
        'SELECT id, name, role, expiresAt, lastUsedAt, createdAt, scopedRepos, scopedTools FROM tokens WHERE revokedAt IS NULL ORDER BY createdAt ASC',
      )
      .all() as { id: string; name: string; role: string; expiresAt: string | null; lastUsedAt: string | null; createdAt: string; scopedRepos: string | null; scopedTools: string | null }[];

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role as Role,
      scopedRepos: r.scopedRepos ? (JSON.parse(r.scopedRepos) as string[]) : undefined,
      scopedTools: r.scopedTools ? (JSON.parse(r.scopedTools) as string[]) : undefined,
      expiresAt: r.expiresAt ?? undefined,
      lastUsedAt: r.lastUsedAt ?? undefined,
      createdAt: r.createdAt,
    }));
  }

  revokeToken(id: string): void {
    this.db
      .prepare('UPDATE tokens SET revokedAt = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  updateLastUsed(id: string): void {
    this.db
      .prepare('UPDATE tokens SET lastUsedAt = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  // ── Audit log ──────────────────────────────────────────────────────────────

  logAccess(
    userId: string,
    resource: string,
    action: string,
    outcome: 'allow' | 'deny',
    ip: string,
  ): void {
    this.db
      .prepare(
        'INSERT INTO audit_log (id, userId, resource, action, outcome, ip, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(uuidv4(), userId, resource, action, outcome, ip, new Date().toISOString());
  }

  // ── OIDC Identity management ────────────────────────────────────────────────

  /**
   * Find an existing local user linked to an OIDC provider + sub.
   * Returns `null` if no such link exists yet (first login → auto-provision).
   */
  findUserByOIDC(provider: string, sub: string): (User & { oidcIdentityId: string }) | null {
    const row = this.db
      .prepare(`
        SELECT u.id, u.username, u.role, u.createdAt, oi.id as oidcId
        FROM oidc_identities oi
        JOIN users u ON u.id = oi.userId
        WHERE oi.provider = ? AND oi.sub = ?
      `)
      .get(provider, sub) as {
        id: string; username: string; role: string; createdAt: string; oidcId: string
      } | undefined;

    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      role: row.role as Role,
      createdAt: row.createdAt,
      oidcIdentityId: row.oidcId,
    };
  }

  /**
   * Create a local user and link it to an OIDC identity in a single transaction.
   * Password is set to a random 32-byte value — the user can only log in via OIDC.
   */
  provisionOIDCUser(
    username: string,
    role: Role,
    provider: string,
    sub: string,
    email?: string,
    name?: string,
  ): { user: User; oidcIdentityId: string } {
    // Random password — user cannot log in with it (OIDC only)
    const randomPassword = crypto.randomBytes(32).toString('hex');
    const passwordHash = bcrypt.hashSync(randomPassword, BCRYPT_ROUNDS);
    const userId = uuidv4();
    const identityId = uuidv4();
    const now = new Date().toISOString();

    const insertUser = this.db.prepare(
      'INSERT INTO users (id, username, passwordHash, role, createdAt) VALUES (?, ?, ?, ?, ?)',
    );
    const insertIdentity = this.db.prepare(
      'INSERT INTO oidc_identities (id, userId, provider, sub, email, name, createdAt, lastLoginAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );

    // Wrap in a transaction for atomicity
    const run = this.db.transaction(() => {
      insertUser.run(userId, username, passwordHash, role, now);
      insertIdentity.run(identityId, userId, provider, sub, email ?? null, name ?? null, now, now);
    });
    run();

    const user: User = { id: userId, username, role, createdAt: now };
    return { user, oidcIdentityId: identityId };
  }

  /**
   * Link an existing local user to a new OIDC identity.
   */
  linkOIDCIdentity(
    userId: string,
    provider: string,
    sub: string,
    email?: string,
    name?: string,
  ): string {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT OR REPLACE INTO oidc_identities (id, userId, provider, sub, email, name, createdAt, lastLoginAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, userId, provider, sub, email ?? null, name ?? null, now, now);
    return id;
  }

  /**
   * Update lastLoginAt timestamp for an OIDC identity.
   */
  touchOIDCIdentity(provider: string, sub: string): void {
    this.db
      .prepare(
        'UPDATE oidc_identities SET lastLoginAt = ? WHERE provider = ? AND sub = ?',
      )
      .run(new Date().toISOString(), provider, sub);
  }

  /**
   * List all OIDC identities linked to a user.
   */
  listOIDCIdentities(userId: string): OIDCIdentity[] {
    const rows = this.db
      .prepare(
        'SELECT id, userId, provider, sub, email, name, createdAt, lastLoginAt FROM oidc_identities WHERE userId = ?',
      )
      .all(userId) as {
        id: string; userId: string; provider: string; sub: string;
        email: string | null; name: string | null; createdAt: string; lastLoginAt: string | null
      }[];
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      provider: r.provider,
      sub: r.sub,
      email: r.email ?? undefined,
      name: r.name ?? undefined,
      createdAt: r.createdAt,
      lastLoginAt: r.lastLoginAt ?? undefined,
    }));
  }

  /**
   * Unlink an OIDC identity from a user (by identityId).
   */
  unlinkOIDCIdentity(identityId: string): void {
    this.db.prepare('DELETE FROM oidc_identities WHERE id = ?').run(identityId);
  }

  // ── Bootstrap check ────────────────────────────────────────────────────────

  hasAnyUser(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    return row.count > 0;
  }

  close(): void {
    this.db.close();
  }
}

export function getUsersDBPath(): string {
  return path.join(os.homedir(), '.code-intel', 'users.db');
}

let _usersDB: UsersDB | null = null;

export function getOrCreateUsersDB(): UsersDB {
  if (!_usersDB) {
    _usersDB = new UsersDB(getUsersDBPath());
  }
  return _usersDB;
}
