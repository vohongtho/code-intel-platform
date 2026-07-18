import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => {
    exec(sql: string): void;
    close(): void;
    prepare(sql: string): StatementSync;
  };
};

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
    this.inner = new DatabaseSync(path, { readOnly: options.readonly === true });
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
