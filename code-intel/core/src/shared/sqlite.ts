import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SQLITE_EXPERIMENTAL_WARNING = 'SQLite is an experimental feature';

function isSqliteExperimentalWarning(warning: string | Error, args: unknown[]): boolean {
  const type = typeof args[0] === 'string' ? args[0] : undefined;
  const message = typeof warning === 'string' ? warning : warning.message;
  const name = typeof warning === 'string' ? undefined : warning.name;
  return message.includes(SQLITE_EXPERIMENTAL_WARNING)
    && (type === 'ExperimentalWarning' || name === 'ExperimentalWarning');
}

function withSqliteWarningSuppressed<T>(fn: () => T): T {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    if (isSqliteExperimentalWarning(warning, args)) return;
    return (originalEmitWarning as any).call(process, warning, ...args);
  }) as typeof process.emitWarning;
  try {
    // ponytail: match the current Node SQLite ExperimentalWarning text locally; widen only if Node changes warning shape.
    return fn();
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

function loadDatabaseSync() {
  return withSqliteWarningSuppressed(() => (require('node:sqlite') as {
    DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => {
      exec(sql: string): void;
      close(): void;
      prepare(sql: string): StatementSync;
    };
  }).DatabaseSync);
}

const DatabaseSync = loadDatabaseSync();

type StatementSync = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  iterate(...params: unknown[]): IterableIterator<unknown>;
};

type DatabaseSyncInstance = {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): StatementSync;
};

export interface DatabaseOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export class Statement {
  constructor(private readonly inner: StatementSync) {}

  run(...params: unknown[]): RunResult {
    return (this.inner as any).run(...params) as RunResult;
  }

  get(...params: unknown[]): unknown {
    return (this.inner as any).get(...params);
  }

  all(...params: unknown[]): unknown[] {
    return (this.inner as any).all(...params) as unknown[];
  }

  iterate(...params: unknown[]): IterableIterator<unknown> {
    return (this.inner as any).iterate(...params) as IterableIterator<unknown>;
  }
}

export class Database {
  readonly name: string;
  private readonly inner: DatabaseSyncInstance;

  constructor(path: string, options: DatabaseOptions = {}) {
    this.name = path;
    if (options.fileMustExist && path !== ':memory:' && !fs.existsSync(path)) {
      throw new Error(`SQLite file does not exist: ${path}`);
    }
    this.inner = withSqliteWarningSuppressed(
      () => new DatabaseSync(path, { readOnly: options.readonly === true }),
    );
  }

  exec(sql: string): void {
    this.inner.exec(sql);
  }

  pragma(sql: string): unknown[] {
    return this.inner.prepare(`PRAGMA ${sql}`).all() as unknown[];
  }

  prepare(sql: string): Statement {
    return new Statement(this.inner.prepare(sql));
  }

  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    const db = this.inner;
    return ((...args: Parameters<T>) => {
      db.exec('BEGIN');
      try {
        const result = fn(...args);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* ignore */ }
        throw error;
      }
    }) as T;
  }

  close(): void {
    this.inner.close();
  }
}

export type SqliteDatabase = Database;
