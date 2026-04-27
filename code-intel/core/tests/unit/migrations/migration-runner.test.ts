import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MigrationRunner, CURRENT_SCHEMA_VERSION, migrations } from '../../../src/migrations/migration-runner.js';

function tempDb(): { db: Database.Database; dbPath: string } {
  const dbPath = path.join(os.tmpdir(), `migration-test-${Date.now()}.db`);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  return { db, dbPath };
}

describe('MigrationRunner', () => {
  it('fresh DB runs all migrations in order', () => {
    const { db, dbPath } = tempDb();
    try {
      const runner = new MigrationRunner(db);
      const count = runner.migrateUp();
      assert.equal(count, migrations.length);
      assert.equal(runner.getCurrentVersion(), CURRENT_SCHEMA_VERSION);
    } finally {
      db.close();
      try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    }
  });

  it('migrateUp is idempotent (safe to run twice)', () => {
    const { db, dbPath } = tempDb();
    try {
      const runner = new MigrationRunner(db);
      runner.migrateUp();
      const count2 = runner.migrateUp();
      assert.equal(count2, 0); // nothing pending
    } finally {
      db.close();
      try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    }
  });

  it('getStatus returns correct pending/applied flags', () => {
    const { db, dbPath } = tempDb();
    try {
      const runner = new MigrationRunner(db);
      // Before applying
      const beforeStatuses = runner.getStatus();
      assert.ok(beforeStatuses.every((s) => s.pending));
      // After applying
      runner.migrateUp();
      const afterStatuses = runner.getStatus();
      assert.ok(afterStatuses.every((s) => !s.pending));
    } finally {
      db.close();
      try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    }
  });

  it('migrateDown rolls back last migration', () => {
    const { db, dbPath } = tempDb();
    try {
      const runner = new MigrationRunner(db);
      runner.migrateUp();
      const versionAfterUp = runner.getCurrentVersion();
      const ok = runner.migrateDown();
      assert.equal(ok, true);
      const versionAfterDown = runner.getCurrentVersion();
      assert.ok(versionAfterDown < versionAfterUp);
    } finally {
      db.close();
      try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    }
  });

  it('dry-run returns pending count without applying', () => {
    const { db, dbPath } = tempDb();
    try {
      const runner = new MigrationRunner(db);
      const count = runner.migrateUp(true);
      assert.equal(count, migrations.length);
      // Version should still be 0 since dry-run
      assert.equal(runner.getCurrentVersion(), 0);
    } finally {
      db.close();
      try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    }
  });

  it('checkCompatibility throws if DB version > code version', () => {
    const { db, dbPath } = tempDb();
    try {
      const runner = new MigrationRunner(db);
      runner.migrateUp();
      // Manually insert a future version
      db.prepare('INSERT INTO schema_versions (version, description, appliedAt) VALUES (?, ?, ?)').run(
        9999,
        'future migration',
        new Date().toISOString(),
      );
      assert.throws(() => runner.checkCompatibility(), /ahead of code/i);
    } finally {
      db.close();
      try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    }
  });
});
