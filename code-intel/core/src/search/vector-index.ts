/**
 * VectorIndex — flat embedding store backed by SQLite with JS cosine similarity.
 *
 * Performance choices:
 *  - Embeddings are stored as raw BLOB (Float32Array binary) — 4× smaller than JSON TEXT
 *    and ~10× faster to deserialize (no JSON.parse, just Buffer.from → Float32Array).
 *  - After buildIndex() / init(), embeddings are cached as Float32Array in memory so
 *    search() is a pure in-process SIMD-friendly loop — no disk I/O per query.
 *  - buildIndex() runs all inserts inside a single SQLite transaction.
 *  - Batch embedding in embedder.ts (batchSize=64) reduces HuggingFace pipeline calls.
 *
 * Read-only mode:
 *  - Published vector artifacts MUST be opened with { readonly: true } to prevent
 *    mutating published generations.
 *  - Writer mode avoids WAL so published snapshots do not require reader-created
 *    WAL/SHM companions at search time.
 *  - Read-only mode skips schema creation.
 *  - Write operations (buildIndex, upsertIndex, deleteByFilePaths) will throw in readonly mode.
 */
import fs from 'node:fs';
import { Database, type SqliteDatabase } from '../shared/sqlite.js';
import type { EmbeddedNode } from './embedder.js';

const EMBED_TABLE = 'embed_nodes';

interface CachedRow {
  nodeId:    string;
  name:      string;
  kind:      string;
  filePath:  string;
  embedding: Float32Array;
}

export interface VectorIndexOptions {
  /** Open in read-only mode (required for published vector artifacts) */
  readonly?: boolean;
  /** Require file to exist when opening (useful with readonly to fail fast) */
  fileMustExist?: boolean;
}

export class VectorIndex {
  private sqlitePath: string;
  private dimension: number;
  private db: SqliteDatabase | null = null;
  private readonly: boolean;
  /** In-memory cache — populated after buildIndex() or first search() */
  private cache: CachedRow[] | null = null;

  constructor(sqlitePath: string, dimension = 384, options: VectorIndexOptions = {}) {
    this.sqlitePath = sqlitePath;
    this.dimension = dimension;
    this.readonly = options.readonly ?? false;
    
    if (options.fileMustExist && !fs.existsSync(sqlitePath)) {
      throw new Error(`VectorIndex: file does not exist: ${sqlitePath}`);
    }
  }

  async init(): Promise<void> {
    if (this.readonly) {
      // Read-only mode: open existing DB without write pragmas or schema creation
      if (!fs.existsSync(this.sqlitePath)) {
        throw new Error(`VectorIndex: cannot open nonexistent file in readonly mode: ${this.sqlitePath}`);
      }
      this.db = new Database(this.sqlitePath, { readonly: true });
    } else {
      // Write mode: create schema without WAL so published snapshots remain sidecar-free.
      this.db = new Database(this.sqlitePath);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS ${EMBED_TABLE} (
          id        TEXT PRIMARY KEY,
          name      TEXT NOT NULL,
          kind      TEXT NOT NULL,
          file_path TEXT NOT NULL,
          text      TEXT NOT NULL,
          embedding BLOB NOT NULL
        )
      `);
    }
  }

  async buildIndex(nodes: EmbeddedNode[]): Promise<void> {
    if (!this.db) throw new Error('VectorIndex not initialized');
    if (this.readonly) throw new Error('Cannot buildIndex in readonly mode');

    this.db.exec(`DELETE FROM ${EMBED_TABLE}`);
    this._insertMany(nodes);
    this.cache = nodes.map((n) => this._toCachedRow(n));
  }

  async deleteByFilePaths(filePaths: string[]): Promise<number> {
    if (!this.db) throw new Error('VectorIndex not initialized');
    if (this.readonly) throw new Error('Cannot deleteByFilePaths in readonly mode');
    if (filePaths.length === 0) return 0;

    const uniquePaths = [...new Set(filePaths)];
    const placeholders = uniquePaths.map(() => '?').join(', ');
    const stmt = this.db.prepare(`DELETE FROM ${EMBED_TABLE} WHERE file_path IN (${placeholders})`);
    const result = stmt.run(...uniquePaths) as { changes?: number };

    if (this.cache) {
      const deleted = new Set(uniquePaths);
      this.cache = this.cache.filter((row) => !deleted.has(row.filePath));
    }

    return Number(result.changes ?? 0);
  }

  async upsertIndex(nodes: EmbeddedNode[]): Promise<number> {
    if (!this.db) throw new Error('VectorIndex not initialized');
    if (this.readonly) throw new Error('Cannot upsertIndex in readonly mode');
    if (nodes.length === 0) return 0;

    this._insertMany(nodes);

    if (this.cache) {
      const upsertedIds = new Set(nodes.map((node) => node.id));
      const preserved = this.cache.filter((row) => !upsertedIds.has(row.nodeId));
      this.cache = [...preserved, ...nodes.map((n) => this._toCachedRow(n))];
    }

    return nodes.length;
  }

  async search(queryEmbedding: number[], topK = 10): Promise<VectorHit[]> {
    if (!this.db) throw new Error('VectorIndex not initialized');

    // Populate cache on first search if buildIndex() wasn't called this session
    if (!this.cache) {
      this.cache = this._loadCache();
    }

    const query = new Float32Array(queryEmbedding);
    const qNorm = norm(query);

    const scored: { hit: VectorHit; score: number }[] = this.cache.map((row) => ({
      hit: {
        nodeId:   row.nodeId,
        name:     row.name,
        kind:     row.kind,
        filePath: row.filePath,
        score:    0,
      },
      score: dotProduct(query, row.embedding) / (qNorm * norm(row.embedding) || 1),
    }));

    // Partial sort: only need top-K (O(n log k) vs O(n log n))
    return topKSort(scored, topK).map((s) => ({ ...s.hit, score: s.score }));
  }

  async isBuilt(): Promise<boolean> {
    if (!this.db) return false;
    try {
      const row = this.db
        .prepare(`SELECT count(*) AS cnt FROM ${EMBED_TABLE}`)
        .get() as { cnt: number };
      return Number(row.cnt) > 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/no such table/i.test(message)) return false;
      throw error;
    }
  }

  close(): void {
    this.cache = null;
    try { this.db?.close(); } catch { /* ignore */ }
    this.db = null;
  }

  // ── private ────────────────────────────────────────────────────────────────

  private _loadCache(): CachedRow[] {
    const rows = this.db!
      .prepare(`SELECT id, name, kind, file_path, embedding FROM ${EMBED_TABLE}`)
      .all() as { id: string; name: string; kind: string; file_path: string; embedding: Buffer }[];

    return rows.map((row) => ({
      nodeId:    row.id,
      name:      row.name,
      kind:      row.kind,
      filePath:  row.file_path,
      embedding: new Float32Array(row.embedding.buffer, row.embedding.byteOffset, this.dimension),
    }));
  }

  private _insertMany(items: EmbeddedNode[]): void {
    const stmt = this.db!.prepare(`
      INSERT OR REPLACE INTO ${EMBED_TABLE} (id, name, kind, file_path, text, embedding)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db!.transaction((nodes: EmbeddedNode[]) => {
      for (const node of nodes) {
        this._assertDimension(node.embedding.length);
        stmt.run(
          node.id,
          node.name,
          node.kind,
          node.filePath,
          node.text,
          Buffer.from(new Float32Array(node.embedding).buffer),
        );
      }
    });
    insertMany(items);
  }

  private _toCachedRow(node: EmbeddedNode): CachedRow {
    this._assertDimension(node.embedding.length);
    return {
      nodeId:    node.id,
      name:      node.name,
      kind:      node.kind,
      filePath:  node.filePath,
      embedding: new Float32Array(node.embedding),
    };
  }

  private _assertDimension(actual: number): void {
    if (actual !== this.dimension) {
      throw new Error(`Embedding dimension ${actual}; expected ${this.dimension}`);
    }
  }
}

export interface VectorHit {
  nodeId:   string;
  name:     string;
  kind:     string;
  filePath: string;
  score:    number; // 0..1 where 1 = most similar
}

// ── Math helpers (Float32Array — faster than number[]) ──────────────────────

function dotProduct(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function norm(a: Float32Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) n += a[i] * a[i];
  return Math.sqrt(n);
}

/** O(n·k) partial sort — much faster than full sort when topK << n */
function topKSort<T>(items: T[], k: number, score: (t: T) => number = (t: any) => t.score): T[] {
  if (items.length <= k) return items.sort((a, b) => score(b) - score(a));
  // Simple max-heap approach: maintain a min-heap of size k
  const heap: T[] = [];
  for (const item of items) {
    if (heap.length < k) {
      heap.push(item);
      if (heap.length === k) heapify(heap, score);
    } else if (score(item) > score(heap[0])) {
      heap[0] = item;
      siftDown(heap, 0, score);
    }
  }
  return heap.sort((a, b) => score(b) - score(a));
}

function heapify<T>(arr: T[], score: (t: T) => number): void {
  for (let i = Math.floor(arr.length / 2) - 1; i >= 0; i--) siftDown(arr, i, score);
}

function siftDown<T>(arr: T[], i: number, score: (t: T) => number): void {
  const n = arr.length;
  while (true) {
    let min = i;
    const l = 2 * i + 1, r = 2 * i + 2;
    if (l < n && score(arr[l]) < score(arr[min])) min = l;
    if (r < n && score(arr[r]) < score(arr[min])) min = r;
    if (min === i) break;
    [arr[i], arr[min]] = [arr[min], arr[i]];
    i = min;
  }
}
