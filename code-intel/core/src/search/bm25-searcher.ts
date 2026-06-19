/**
 * bm25-searcher.ts — Minimal read-only BM25 search for the slim CLI binary.
 *
 * Intentionally has NO dependency on Logger, winston, or OTel.
 * Used ONLY by the `search.ts` slim entry; all other code uses the full
 * `Bm25Index` class from bm25-index.ts which includes build/load/update and logging.
 *
 * Dependencies: better-sqlite3, node:fs, node:path (all fast to load).
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { SearchResult } from './text-search.js';

// ── BM25 hyperparameters ──────────────────────────────────────────────────────
const K1 = 1.2;
const B  = 0.75;

// ── Internal types ─────────────────────────────────────────────────────────────
interface PostingEntry { nodeId: string; tf: number }
interface NodeMeta { name: string; kind: string; filePath: string; snippet?: string }

// ── Tokenizer ─────────────────────────────────────────────────────────────────
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\-_./\\:(){}[\]<>,"'`~!@#$%^&*+=|;?]+/)
    .filter((t) => t.length >= 2 && t.length <= 64);
}

// ── Min-heap top-K ─────────────────────────────────────────────────────────────
function heapTopK(scores: Map<string, number>, k: number): [string, number][] {
  if (k <= 0) return [];
  const heap: [string, number][] = [];

  function heapifyUp(i: number) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent]![1] > heap[i]![1]) {
        [heap[parent], heap[i]] = [heap[i]!, heap[parent]!];
        i = parent;
      } else break;
    }
  }
  function heapifyDown(i: number) {
    const n = heap.length;
    while (true) {
      let s = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && heap[l]![1] < heap[s]![1]) s = l;
      if (r < n && heap[r]![1] < heap[s]![1]) s = r;
      if (s === i) break;
      [heap[s], heap[i]] = [heap[i]!, heap[s]!];
      i = s;
    }
  }

  for (const [nodeId, score] of scores) {
    if (heap.length < k) {
      heap.push([nodeId, score]);
      heapifyUp(heap.length - 1);
    } else if (score > heap[0]![1]) {
      heap[0] = [nodeId, score];
      heapifyDown(0);
    }
  }
  return heap.sort((a, b) => b[1] - a[1]);
}

// ── Path helper ────────────────────────────────────────────────────────────────
export function getBm25DbPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.code-intel', 'bm25.db');
}

// ── Slim searcher ──────────────────────────────────────────────────────────────

export class Bm25Searcher {
  private readonly invertedIndex = new Map<string, PostingEntry[]>();
  private readonly docLengths    = new Map<string, number>();
  private readonly nodeMeta      = new Map<string, NodeMeta>();
  private avgdl    = 1;
  private docCount = 0;
  private _loaded  = false;

  constructor(private readonly dbPath: string) {}

  get isLoaded(): boolean { return this._loaded; }

  load(): void {
    if (!fs.existsSync(this.dbPath)) return;

    const db = new Database(this.dbPath, { readonly: true });
    try {
      const getMeta = db.prepare('SELECT value FROM bm25_meta WHERE key = ?');
      this.avgdl    = parseFloat((getMeta.get('avgdl')    as { value: string } | undefined)?.value ?? '1');
      this.docCount = parseInt  ((getMeta.get('docCount') as { value: string } | undefined)?.value ?? '0', 10);

      const postingRows = db.prepare('SELECT term, postings FROM bm25_index').all() as { term: string; postings: string }[];
      for (const row of postingRows) {
        this.invertedIndex.set(row.term, JSON.parse(row.postings) as PostingEntry[]);
      }

      const dlRows = db.prepare('SELECT node_id, doclen FROM bm25_doclen').all() as { node_id: string; doclen: number }[];
      for (const row of dlRows) {
        this.docLengths.set(row.node_id, row.doclen);
      }

      const metaRows = db.prepare('SELECT node_id, name, kind, file_path, snippet FROM bm25_nodemeta').all() as {
        node_id: string; name: string; kind: string; file_path: string; snippet: string | null;
      }[];
      for (const row of metaRows) {
        this.nodeMeta.set(row.node_id, {
          name: row.name,
          kind: row.kind,
          filePath: row.file_path,
          snippet: row.snippet ?? undefined,
        });
      }

      this._loaded = true;
    } finally {
      db.close();
    }
  }

  search(query: string, limit: number): SearchResult[] {
    if (!this._loaded || this.invertedIndex.size === 0) return [];

    const queryTerms = [...new Set(tokenize(query))];
    if (queryTerms.length === 0) return [];

    const scores = new Map<string, number>();
    const N      = this.docCount;
    const avgdl  = this.avgdl;

    for (const term of queryTerms) {
      const postings = this.invertedIndex.get(term);
      if (!postings) continue;

      const df = postings.length;
      if (N > 100 && df / N > 0.6) continue;

      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

      for (const { nodeId, tf } of postings) {
        const dl    = this.docLengths.get(nodeId) ?? avgdl;
        const score = idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (dl / avgdl)));
        scores.set(nodeId, (scores.get(nodeId) ?? 0) + score);
      }
    }

    if (scores.size === 0) return [];

    return heapTopK(scores, limit).map(([nodeId, score]) => {
      const meta = this.nodeMeta.get(nodeId);
      return {
        nodeId,
        name:     meta?.name     ?? nodeId,
        kind:     meta?.kind     ?? 'unknown',
        filePath: meta?.filePath ?? '',
        score,
        snippet:  meta?.snippet,
      };
    });
  }
}
