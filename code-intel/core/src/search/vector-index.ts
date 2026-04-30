/**
 * VectorIndex — flat embedding store backed by better-sqlite3 with JS cosine similarity.
 *
 * This intentionally avoids @ladybugdb/core's CALL CREATE_VECTOR_INDEX / QUERY_VECTOR_INDEX
 * because those calls trigger a segfault in the native lbugjs.node binding (confirmed on
 * @ladybugdb/core 0.15.4 and 0.16.0, linux/x64, WSL2).  Using better-sqlite3 for flat
 * embedding storage and computing cosine similarity in JS is a safe, zero-extra-dependency
 * alternative that performs well for the typical graph size (< 10 k nodes).
 */
import Database from 'better-sqlite3';
import type { EmbeddedNode } from './embedder.js';

const EMBED_TABLE = 'embed_nodes';

export class VectorIndex {
  private sqlitePath: string;
  private db: Database.Database | null = null;

  constructor(sqlitePath: string) {
    this.sqlitePath = sqlitePath;
  }

  async init(): Promise<void> {
    this.db = new Database(this.sqlitePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${EMBED_TABLE} (
        id       TEXT PRIMARY KEY,
        name     TEXT NOT NULL,
        kind     TEXT NOT NULL,
        file_path TEXT NOT NULL,
        text     TEXT NOT NULL,
        embedding TEXT NOT NULL
      )
    `);
  }

  async buildIndex(nodes: EmbeddedNode[]): Promise<void> {
    if (!this.db) throw new Error('VectorIndex not initialized');
    this.db.exec(`DELETE FROM ${EMBED_TABLE}`);
    const stmt = this.db.prepare(`
      INSERT INTO ${EMBED_TABLE} (id, name, kind, file_path, text, embedding)
      VALUES (@id, @name, @kind, @filePath, @text, @embedding)
    `);
    const insertMany = this.db.transaction((items: EmbeddedNode[]) => {
      for (const node of items) {
        stmt.run({
          id:        node.id,
          name:      node.name,
          kind:      node.kind,
          filePath:  node.filePath,
          text:      node.text,
          embedding: JSON.stringify(node.embedding),
        });
      }
    });
    insertMany(nodes);
  }

  async search(queryEmbedding: number[], topK = 10): Promise<VectorHit[]> {
    if (!this.db) throw new Error('VectorIndex not initialized');
    const rows = this.db
      .prepare(`SELECT id, name, kind, file_path, embedding FROM ${EMBED_TABLE}`)
      .all() as { id: string; name: string; kind: string; file_path: string; embedding: string }[];

    const scored: VectorHit[] = rows.map((row) => ({
      nodeId:   row.id,
      name:     row.name,
      kind:     row.kind,
      filePath: row.file_path,
      score:    cosineSimilarity(queryEmbedding, JSON.parse(row.embedding) as number[]),
    }));

    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  async isBuilt(): Promise<boolean> {
    if (!this.db) return false;
    try {
      const row = this.db
        .prepare(`SELECT count(*) AS cnt FROM ${EMBED_TABLE}`)
        .get() as { cnt: number };
      return Number(row.cnt) > 0;
    } catch {
      return false;
    }
  }

  close(): void {
    try { this.db?.close(); } catch { /* ignore */ }
    this.db = null;
  }
}

export interface VectorHit {
  nodeId:   string;
  name:     string;
  kind:     string;
  filePath: string;
  score:    number; // 0..1 where 1 = most similar
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}
