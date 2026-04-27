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
