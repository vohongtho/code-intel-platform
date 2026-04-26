import { Database, Connection } from '@ladybugdb/core';
import path from 'node:path';
import fs from 'node:fs';

export class DbManager {
  private db: InstanceType<typeof Database> | null = null;
  private conn: InstanceType<typeof Connection> | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
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
    try {
      this.conn?.close();
    } catch { /* ignore */ }
    try {
      this.db?.close();
    } catch { /* ignore */ }
    this.conn = null;
    this.db = null;
  }

  get isOpen(): boolean {
    return this.conn !== null;
  }
}
