import { Database, Connection } from '@ladybugdb/core';
import path from 'node:path';
import fs from 'node:fs';

export class DbManager {
  private db: InstanceType<typeof Database> | null = null;
  private conn: InstanceType<typeof Connection> | null = null;
  private dbPath: string;
  private readOnly: boolean;

  constructor(dbPath: string, readOnly = false) {
    this.dbPath = dbPath;
    this.readOnly = readOnly;
  }

  async init(): Promise<void> {
    if (!this.readOnly) {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }
    // Database constructor: (path, bufferManagerSize, enableCompression, readOnly, ...)
    this.db = new Database(this.dbPath, 0, true, this.readOnly);
    await this.db.init();
    this.conn = new Connection(this.db);
    await this.conn.init();
  }

  async query(cypher: string): Promise<Record<string, unknown>[]> {
    if (!this.conn) throw new Error('Database not initialized');
    const result = await this.conn.query(cypher);
    const qr = Array.isArray(result) ? result[0] : result;
    const rows = await qr.getAll();
    qr.close();
    return rows as Record<string, unknown>[];
  }

  async execute(cypher: string): Promise<void> {
    if (!this.conn) throw new Error('Database not initialized');
    const result = await this.conn.query(cypher);
    const qr = Array.isArray(result) ? result[0] : result;
    qr.close();
  }

  close(): void {
    // Use closeSync() so the DB flushes/checkpoints to disk before returning.
    // Calling the async close() without await causes a 60-90s delay at process
    // exit as Node waits for the pending flush promises to resolve.
    try {
      this.conn?.closeSync();
    } catch { /* ignore */ }
    try {
      this.db?.closeSync();
    } catch { /* ignore */ }
    this.conn = null;
    this.db = null;
  }

  get isOpen(): boolean {
    return this.conn !== null;
  }
}
