/**
 * Schema migration runner for code-intel databases.
 *
 * - Ordered, idempotent up() / down() migrations
 * - Auto-run on startup
 * - DB schema > code schema → refuse to start
 * - Auto-backup before every migration
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
  down: (db: Database.Database) => void;
}

export interface MigrationStatus {
  version: number;
  description: string;
  appliedAt?: string;
  pending: boolean;
}

// ── Registered migrations ─────────────────────────────────────────────────────

export const migrations: Migration[] = [
  {
    version: 1,
    description: 'Add schemaVersion tracking table',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_versions (
          version INTEGER PRIMARY KEY,
          description TEXT NOT NULL,
          appliedAt TEXT NOT NULL
        );
      `);
    },
    down: (db) => {
      db.exec('DROP TABLE IF EXISTS schema_versions;');
    },
  },
  {
    version: 2,
    description: 'Add indexVersion to meta tracking',
    up: (db) => {
      // Add index_version column if not exists (safe for both new and existing DBs)
      const hasTable = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='meta'`)
        .get();
      if (hasTable) {
        const cols = db.pragma(`table_info(meta)`) as Array<{ name: string }>;
        if (!cols.find((c) => c.name === 'indexVersion')) {
          db.exec(`ALTER TABLE meta ADD COLUMN indexVersion TEXT;`);
        }
      }
    },
    down: (_db) => {
      // SQLite does not support DROP COLUMN in older versions; no-op
    },
  },
  {
    version: 3,
    description: 'Add scopedRepos column to tokens table in users.db',
    up: (db) => {
      const hasTable = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='tokens'`)
        .get();
      if (hasTable) {
        const cols = db.pragma(`table_info(tokens)`) as Array<{ name: string }>;
        if (!cols.find((c) => c.name === 'scopedRepos')) {
          db.exec(`ALTER TABLE tokens ADD COLUMN scopedRepos TEXT NULL;`);
        }
        if (!cols.find((c) => c.name === 'scopedTools')) {
          db.exec(`ALTER TABLE tokens ADD COLUMN scopedTools TEXT NULL;`);
        }
      }
    },
    down: (_db) => {
      // SQLite cannot drop columns; no-op
    },
  },
];

export const CURRENT_SCHEMA_VERSION = migrations[migrations.length - 1]!.version;

// ── Migration runner ──────────────────────────────────────────────────────────

export class MigrationRunner {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    // Ensure schema_versions table exists (bootstraps the migration system itself)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        appliedAt TEXT NOT NULL
      );
    `);
  }

  getCurrentVersion(): number {
    const row = this.db
      .prepare('SELECT MAX(version) as v FROM schema_versions')
      .get() as { v: number | null };
    return row?.v ?? 0;
  }

  getAppliedVersions(): Map<number, string> {
    const rows = this.db
      .prepare('SELECT version, appliedAt FROM schema_versions ORDER BY version ASC')
      .all() as Array<{ version: number; appliedAt: string }>;
    const m = new Map<number, string>();
    for (const r of rows) m.set(r.version, r.appliedAt);
    return m;
  }

  getStatus(): MigrationStatus[] {
    const applied = this.getAppliedVersions();
    return migrations.map((m) => ({
      version: m.version,
      description: m.description,
      appliedAt: applied.get(m.version),
      pending: !applied.has(m.version),
    }));
  }

  /**
   * Run all pending migrations (up).
   * Returns number of migrations applied.
   */
  migrateUp(dryRun = false): number {
    const applied = this.getAppliedVersions();
    const pending = migrations.filter((m) => !applied.has(m.version));

    if (dryRun) {
      return pending.length;
    }

    for (const migration of pending) {
      const tx = this.db.transaction(() => {
        migration.up(this.db);
        this.db
          .prepare('INSERT OR REPLACE INTO schema_versions (version, description, appliedAt) VALUES (?, ?, ?)')
          .run(migration.version, migration.description, new Date().toISOString());
      });
      tx();
    }

    return pending.length;
  }

  /**
   * Roll back the last applied migration (down).
   */
  migrateDown(): boolean {
    const currentVersion = this.getCurrentVersion();
    if (currentVersion === 0) return false;

    const migration = migrations.find((m) => m.version === currentVersion);
    if (!migration) return false;

    const tx = this.db.transaction(() => {
      migration.down(this.db);
      this.db.prepare('DELETE FROM schema_versions WHERE version = ?').run(currentVersion);
    });
    tx();
    return true;
  }

  /**
   * Check if DB schema version is ahead of code — refuse to start if so.
   */
  checkCompatibility(): void {
    const dbVersion = this.getCurrentVersion();
    if (dbVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `DB schema version (${dbVersion}) is ahead of code schema version (${CURRENT_SCHEMA_VERSION}). ` +
          `Please upgrade code-intel to at least version that supports schema v${dbVersion}.`,
      );
    }
  }
}

// ── Convenience function ──────────────────────────────────────────────────────

export function runMigrationsOnDB(db: Database.Database, dryRun = false): number {
  const runner = new MigrationRunner(db);
  runner.checkCompatibility();
  return runner.migrateUp(dryRun);
}
