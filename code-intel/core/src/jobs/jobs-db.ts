/**
 * Durable Job Model — jobs.db
 *
 * State machine: pending → running → success | failed | cancelled
 * - Jobs survive process restart
 * - Retry with exponential backoff (3 attempts: 5s, 30s, 120s)
 * - Dead-letter queue for exhausted retries
 * - Idempotent job submission
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { v4 as uuidv4 } from 'uuid';

export type JobStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled' | 'dead';
export type JobKind = 'analyze' | 'backup' | 'sync' | 'embed';

export interface Job {
  id: string;
  kind: JobKind;
  status: JobStatus;
  repoPath: string;
  params: string; // JSON string
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  result?: string; // JSON string
}

const RETRY_DELAYS_SECONDS = [5, 30, 120];
const MAX_ATTEMPTS = 3;
const STUCK_THRESHOLD_MINUTES = 30;

export class JobsDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.createTables();
    // On startup, recover any jobs that were 'running' when the process died
    this.recoverStuckJobs();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        repoPath TEXT NOT NULL,
        params TEXT NOT NULL DEFAULT '{}',
        attempts INTEGER NOT NULL DEFAULT 0,
        maxAttempts INTEGER NOT NULL DEFAULT ${MAX_ATTEMPTS},
        createdAt TEXT NOT NULL,
        startedAt TEXT NULL,
        finishedAt TEXT NULL,
        error TEXT NULL,
        result TEXT NULL,
        nextRetryAt TEXT NULL,
        idempotencyKey TEXT UNIQUE NULL
      );
      CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS jobs_repoPath ON jobs(repoPath);
    `);
  }

  /**
   * Submit a job. Idempotent: same idempotencyKey returns the existing job.
   */
  submit(kind: JobKind, repoPath: string, params: Record<string, unknown> = {}, idempotencyKey?: string): Job {
    // Check idempotency
    if (idempotencyKey) {
      const existing = this.db
        .prepare('SELECT * FROM jobs WHERE idempotencyKey = ?')
        .get(idempotencyKey) as Record<string, unknown> | undefined;
      if (existing) return this._mapRow(existing);
    }

    const id = uuidv4();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO jobs (id, kind, status, repoPath, params, attempts, maxAttempts, createdAt, idempotencyKey)
         VALUES (?, ?, 'pending', ?, ?, 0, ?, ?, ?)`,
      )
      .run(id, kind, repoPath, JSON.stringify(params), MAX_ATTEMPTS, createdAt, idempotencyKey ?? null);

    return this.getJob(id)!;
  }

  getJob(id: string): Job | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!row) return null;
    return this._mapRow(row as Record<string, unknown>);
  }

  listJobs(filters: { status?: JobStatus; repoPath?: string } = {}): Job[] {
    let sql = 'SELECT * FROM jobs WHERE 1=1';
    const params: unknown[] = [];
    if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
    if (filters.repoPath) { sql += ' AND repoPath = ?'; params.push(filters.repoPath); }
    sql += ' ORDER BY createdAt DESC LIMIT 100';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this._mapRow(r));
  }

  /**
   * Mark a job as running (transitions from pending).
   */
  markRunning(id: string): void {
    this.db
      .prepare(`UPDATE jobs SET status = 'running', startedAt = ?, attempts = attempts + 1 WHERE id = ? AND status IN ('pending', 'failed')`)
      .run(new Date().toISOString(), id);
  }

  /**
   * Mark a job as succeeded.
   */
  markSuccess(id: string, result?: Record<string, unknown>): void {
    this.db
      .prepare(`UPDATE jobs SET status = 'success', finishedAt = ?, result = ? WHERE id = ?`)
      .run(new Date().toISOString(), result ? JSON.stringify(result) : null, id);
  }

  /**
   * Mark a job as failed. If max attempts reached, move to 'dead'. Otherwise schedule retry.
   */
  markFailed(id: string, error: string): void {
    const job = this.getJob(id);
    if (!job) return;

    if (job.attempts >= job.maxAttempts) {
      this.db
        .prepare(`UPDATE jobs SET status = 'dead', finishedAt = ?, error = ? WHERE id = ?`)
        .run(new Date().toISOString(), error, id);
    } else {
      const delaySeconds = RETRY_DELAYS_SECONDS[job.attempts] ?? 120;
      const nextRetryAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
      this.db
        .prepare(`UPDATE jobs SET status = 'failed', finishedAt = ?, error = ?, nextRetryAt = ? WHERE id = ?`)
        .run(new Date().toISOString(), error, nextRetryAt, id);
    }
  }

  /**
   * Cancel a pending or running job.
   */
  cancel(id: string): boolean {
    const info = this.db
      .prepare(`UPDATE jobs SET status = 'cancelled', finishedAt = ? WHERE id = ? AND status IN ('pending', 'running')`)
      .run(new Date().toISOString(), id);
    return (info.changes ?? 0) > 0;
  }

  /**
   * Get jobs ready to retry (failed with nextRetryAt in the past).
   */
  getPendingRetries(): Job[] {
    const now = new Date().toISOString();
    const rows = this.db
      .prepare(`SELECT * FROM jobs WHERE status = 'failed' AND nextRetryAt <= ? AND attempts < maxAttempts`)
      .all(now) as Record<string, unknown>[];
    return rows.map((r) => this._mapRow(r));
  }

  /**
   * Recover jobs stuck in 'running' state (process crash recovery).
   */
  private recoverStuckJobs(): void {
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    // Jobs stuck running for > 30min → re-queue as failed for retry
    this.db
      .prepare(`UPDATE jobs SET status = 'failed', error = 'Process crash or stuck job — recovered on restart', nextRetryAt = datetime('now') WHERE status = 'running' AND startedAt < ?`)
      .run(cutoff);
  }

  /**
   * Detect jobs stuck for > 30 min (running but not completed).
   */
  detectStuckJobs(): Job[] {
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    const rows = this.db
      .prepare(`SELECT * FROM jobs WHERE status = 'running' AND startedAt < ?`)
      .all(cutoff) as Record<string, unknown>[];
    return rows.map((r) => this._mapRow(r));
  }

  close(): void {
    this.db.close();
  }

  private _mapRow(row: Record<string, unknown>): Job {
    return {
      id: row['id'] as string,
      kind: row['kind'] as JobKind,
      status: row['status'] as JobStatus,
      repoPath: row['repoPath'] as string,
      params: row['params'] as string,
      attempts: row['attempts'] as number,
      maxAttempts: row['maxAttempts'] as number,
      createdAt: row['createdAt'] as string,
      startedAt: (row['startedAt'] as string | null) ?? undefined,
      finishedAt: (row['finishedAt'] as string | null) ?? undefined,
      error: (row['error'] as string | null) ?? undefined,
      result: (row['result'] as string | null) ?? undefined,
    };
  }
}

export function getJobsDBPath(): string {
  return path.join(os.homedir(), '.code-intel', 'jobs.db');
}

let _jobsDB: JobsDB | null = null;
export function getOrCreateJobsDB(): JobsDB {
  if (!_jobsDB) _jobsDB = new JobsDB(getJobsDBPath());
  return _jobsDB;
}
