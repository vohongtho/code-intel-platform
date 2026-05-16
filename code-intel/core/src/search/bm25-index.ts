/**
 * bm25-index.ts  — Epic 2: Pre-Built BM25 Inverted Index (v1.0.0)
 *
 * Strategy:
 *  - Built at analysis time (post-pipeline), stored in `.code-intel/bm25.db` (better-sqlite3).
 *  - Loaded into memory on `serve` startup: replaces linear O(n) scan.
 *  - Incremental updates: only changed nodes' terms are rewritten.
 *  - LIMIT pushdown: applies limit before sorting the full score list.
 *
 * Tables:
 *   bm25_index(term TEXT PK, postings TEXT)     — term→[{nodeId,tf}] JSON
 *   bm25_doclen(node_id TEXT PK, doclen INT)     — document length per node
 *   bm25_nodemeta(node_id TEXT PK, …)            — name/kind/filePath/snippet
 *   bm25_meta(key TEXT PK, value TEXT)           — avgdl, docCount
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { CodeNode } from '../shared/index.js';
import type { SearchResult } from './text-search.js';
import Logger from '../shared/logger.js';

// ── BM25 hyperparameters ──────────────────────────────────────────────────────
const K1 = 1.2;
const B = 0.75;

// ── Internal types ────────────────────────────────────────────────────────────
interface PostingEntry { nodeId: string; tf: number }
interface NodeMeta { name: string; kind: string; filePath: string; snippet?: string }

// ── Tokenizer ─────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\-_./\\:(){}[\]<>,"'`~!@#$%^&*+=|;?]+/)
    .filter((t) => t.length >= 2 && t.length <= 64);
}

function nodeToDoc(node: CodeNode): string {
  // Repeat the filename stem (class name without extension) to boost its BM25 weight
  // so queries like "Token requestAccessToken" rank Token.php over JWT.php.
  const fileBaseName = node.filePath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') ?? '';
  return [
    node.name,
    node.name, // repeat name to boost exact-name matches
    node.kind,
    node.filePath,
    fileBaseName, // filename stem (class name) — extra weight
    fileBaseName, // repeat again for stronger class-name boosting
    (node.content ?? '').slice(0, 1500), // increased from 1000
  ].join(' ');
}

// ── Min-heap top-K (O(n log k)) ──────────────────────────────────────────────

/**
 * Extract the top-k entries from a score map using a min-heap.
 * Complexity: O(n log k) — much faster than sort for small k (k ≤ 50).
 */
function heapTopK(scores: Map<string, number>, k: number): [string, number][] {
  if (k <= 0) return [];
  // Heap: [nodeId, score][] — invariant: heap[0] has the SMALLEST score
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
      let smallest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && heap[l]![1] < heap[smallest]![1]) smallest = l;
      if (r < n && heap[r]![1] < heap[smallest]![1]) smallest = r;
      if (smallest === i) break;
      [heap[smallest], heap[i]] = [heap[i]!, heap[smallest]!];
      i = smallest;
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

  // Sort descending for final output
  return heap.sort((a, b) => b[1] - a[1]);
}

// ── Bm25Index ─────────────────────────────────────────────────────────────────

export class Bm25Index {
  /** In-memory inverted index (populated after `load()`). */
  private readonly invertedIndex = new Map<string, PostingEntry[]>();
  private readonly docLengths = new Map<string, number>();
  private readonly nodeMeta = new Map<string, NodeMeta>();
  private avgdl = 1;
  private docCount = 0;
  private _loaded = false;

  constructor(private readonly dbPath: string) {}

  get isLoaded(): boolean { return this._loaded; }

  // ── Build ───────────────────────────────────────────────────────────────────

  /**
   * Build the inverted index from a KnowledgeGraph and persist to SQLite.
   * Called once at analysis time after the main pipeline completes.
   */
  build(graph: KnowledgeGraph): void {
    const nodeTermFreqs = new Map<string, Map<string, number>>();
    const docLengths = new Map<string, number>();
    const nodeMeta = new Map<string, NodeMeta>();

    for (const node of graph.allNodes()) {
      if (['directory', 'cluster', 'flow'].includes(node.kind)) continue;
      const terms = tokenize(nodeToDoc(node));
      const tf = new Map<string, number>();
      for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
      nodeTermFreqs.set(node.id, tf);
      docLengths.set(node.id, terms.length);
      nodeMeta.set(node.id, {
        name: node.name,
        kind: node.kind,
        filePath: node.filePath,
        snippet: node.content?.slice(0, 200),
      });
    }

    const docCount = nodeTermFreqs.size;
    const totalLen = [...docLengths.values()].reduce((a, b) => a + b, 0);
    const avgdl = docCount > 0 ? totalLen / docCount : 1;

    // Build inverted index: term → [{nodeId, tf}]
    const invertedIndex = new Map<string, PostingEntry[]>();
    for (const [nodeId, tf] of nodeTermFreqs) {
      for (const [term, count] of tf) {
        let postings = invertedIndex.get(term);
        if (!postings) { postings = []; invertedIndex.set(term, postings); }
        postings.push({ nodeId, tf: count });
      }
    }

    // Persist to SQLite
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    // Remove stale file so we start fresh
    for (const f of [this.dbPath, `${this.dbPath}-shm`, `${this.dbPath}-wal`]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
    }
    const db = new Database(this.dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE bm25_index   (term     TEXT PRIMARY KEY, postings TEXT NOT NULL);
      CREATE TABLE bm25_doclen  (node_id  TEXT PRIMARY KEY, doclen   INTEGER NOT NULL);
      CREATE TABLE bm25_nodemeta(node_id  TEXT PRIMARY KEY, name TEXT, kind TEXT, file_path TEXT, snippet TEXT);
      CREATE TABLE bm25_meta    (key      TEXT PRIMARY KEY, value    TEXT NOT NULL);
    `);

    const insPosting  = db.prepare('INSERT OR REPLACE INTO bm25_index    VALUES (?, ?)');
    const insDoclen   = db.prepare('INSERT OR REPLACE INTO bm25_doclen   VALUES (?, ?)');
    const insNodeMeta = db.prepare('INSERT OR REPLACE INTO bm25_nodemeta VALUES (?, ?, ?, ?, ?)');
    const insMeta     = db.prepare('INSERT OR REPLACE INTO bm25_meta     VALUES (?, ?)');

    db.transaction(() => {
      for (const [term, postings] of invertedIndex) {
        insPosting.run(term, JSON.stringify(postings));
      }
      for (const [nodeId, len] of docLengths) {
        insDoclen.run(nodeId, len);
      }
      for (const [nodeId, meta] of nodeMeta) {
        insNodeMeta.run(nodeId, meta.name, meta.kind, meta.filePath, meta.snippet ?? null);
      }
      insMeta.run('avgdl',    String(avgdl));
      insMeta.run('docCount', String(docCount));
    })();

    db.close();
    Logger.info(`  [bm25] Index built: ${invertedIndex.size} terms, ${docCount} documents`);
  }

  // ── Load into memory ────────────────────────────────────────────────────────

  /**
   * Load the full inverted index into memory.
   * Called once on `serve` startup.
   */
  load(): void {
    if (!fs.existsSync(this.dbPath)) return;

    const db = new Database(this.dbPath, { readonly: true });
    try {
      // Meta
      const getMeta = db.prepare('SELECT value FROM bm25_meta WHERE key = ?');
      this.avgdl    = parseFloat((getMeta.get('avgdl')    as { value: string } | undefined)?.value ?? '1');
      this.docCount = parseInt  ((getMeta.get('docCount') as { value: string } | undefined)?.value ?? '0', 10);

      // Inverted index
      this.invertedIndex.clear();
      const postingRows = db.prepare('SELECT term, postings FROM bm25_index').all() as { term: string; postings: string }[];
      for (const row of postingRows) {
        this.invertedIndex.set(row.term, JSON.parse(row.postings) as PostingEntry[]);
      }

      // Doc lengths
      this.docLengths.clear();
      const dlRows = db.prepare('SELECT node_id, doclen FROM bm25_doclen').all() as { node_id: string; doclen: number }[];
      for (const row of dlRows) {
        this.docLengths.set(row.node_id, row.doclen);
      }

      // Node meta
      this.nodeMeta.clear();
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
      Logger.info(`  [bm25] Index loaded (${this.invertedIndex.size} terms)`);
    } finally {
      db.close();
    }
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  /**
   * BM25 search.
   *
   * Performance strategy:
   *  1. Skip ultra-high-df terms (df/N > 0.6) — near-zero IDF, dominate posting
   *     lists for common words like "function", "return", "export" in large repos.
   *  2. Min-heap top-K selection — O(n log k) instead of full O(n log n) sort.
   *     For k=10 and n=30,000 candidates this is ~10× faster than Array.sort.
   */
  search(query: string, limit: number): SearchResult[] {
    if (!this._loaded || this.invertedIndex.size === 0) return [];

    const queryTerms = [...new Set(tokenize(query))];
    if (queryTerms.length === 0) return [];

    const scores = new Map<string, number>();
    const N = this.docCount;
    const avgdl = this.avgdl;

    for (const term of queryTerms) {
      const postings = this.invertedIndex.get(term);
      if (!postings) continue;

      const df = postings.length;

      // Skip ultra-common terms only on large corpora (N > 100):
      // df/N > 0.6 → IDF < 0.22 → negligible signal, but on tiny test graphs
      // this threshold would wrongly discard legitimate terms.
      if (N > 100 && df / N > 0.6) continue;

      // BM25 IDF: log((N - df + 0.5) / (df + 0.5) + 1)
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

      for (const { nodeId, tf } of postings) {
        const dl = this.docLengths.get(nodeId) ?? avgdl;
        const score = idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (dl / avgdl)));
        scores.set(nodeId, (scores.get(nodeId) ?? 0) + score);
      }
    }

    if (scores.size === 0) return [];

    // Min-heap top-K: O(n log k) — far cheaper than full sort for small k
    const topEntries = heapTopK(scores, limit);

    return topEntries.map(([nodeId, score]) => {
      const meta = this.nodeMeta.get(nodeId);
      return {
        nodeId,
        name: meta?.name ?? nodeId,
        kind: meta?.kind ?? 'unknown',
        filePath: meta?.filePath ?? '',
        score,
        snippet: meta?.snippet,
      };
    });
  }

  // ── Incremental update ──────────────────────────────────────────────────────

  /**
   * Incrementally update index for a set of changed/added nodes.
   * Only terms that overlap with the changed nodes are rewritten.
   * Works even if `load()` was not called (reads affected terms directly from DB).
   */
  updateNodes(nodes: CodeNode[]): void {
    if (!fs.existsSync(this.dbPath)) return;
    if (nodes.length === 0) return;

    const changedIds = new Set(nodes.map((n) => n.id));

    // Compute new term frequencies for changed nodes
    const newTermFreqs = new Map<string, Map<string, number>>(); // nodeId → term → tf
    for (const node of nodes) {
      if (['directory', 'cluster', 'flow'].includes(node.kind)) continue;
      const terms = tokenize(nodeToDoc(node));
      const tf = new Map<string, number>();
      for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
      newTermFreqs.set(node.id, tf);
    }
    const newTermSet = new Set([...newTermFreqs.values()].flatMap((m) => [...m.keys()]));

    const db = new Database(this.dbPath);
    db.pragma('journal_mode = WAL');

    // Load existing postings for all terms that are either:
    //  a) associated with changed nodes (so we can remove old entries), OR
    //  b) in the new term set (so we can append new entries)
    //
    // Step 1: Find terms that reference changed nodes by scanning affected rows.
    // We query terms for each changed node by first looking up what terms they had.
    // Since we don't have a reverse index, we query the full posting list for
    // terms in newTermSet plus any stored terms referencing changed nodes.
    //
    // Efficient approach: query all postings, filter in JS for changed-node refs.
    const termsToRewrite = new Map<string, PostingEntry[]>();

    // Get all existing postings for new terms (to append to)
    for (const term of newTermSet) {
      const row = (db.prepare('SELECT postings FROM bm25_index WHERE term = ?').get(term)) as { postings: string } | undefined;
      const existing: PostingEntry[] = row ? (JSON.parse(row.postings) as PostingEntry[]) : [];
      // Remove old entries for changed nodes
      termsToRewrite.set(term, existing.filter((p) => !changedIds.has(p.nodeId)));
    }

    // Also find any terms that ONLY referenced changed nodes (to clear stale entries)
    // We scan posts referencing changed node IDs by querying rows where postings contain the node IDs.
    // This is a targeted scan: we look up all terms for each changed node using a temp approach.
    // Since SQLite doesn't have a reverse index, we do a JSON-based scan for only affected terms.
    // This is bounded by the number of changed nodes × their term count (typically small).
    for (const nodeId of changedIds) {
      // For each changed node: find terms in the postings that reference it (if not already loaded)
      const rows = (db.prepare("SELECT term, postings FROM bm25_index WHERE postings LIKE ?").all(`%${nodeId}%`)) as { term: string; postings: string }[];
      for (const row of rows) {
        if (termsToRewrite.has(row.term)) continue; // already handled above
        const postings = JSON.parse(row.postings) as PostingEntry[];
        if (postings.some((p) => changedIds.has(p.nodeId))) {
          termsToRewrite.set(row.term, postings.filter((p) => !changedIds.has(p.nodeId)));
        }
      }
    }

    // Append new postings
    for (const [nodeId, tf] of newTermFreqs) {
      for (const [term, count] of tf) {
        const postings = termsToRewrite.get(term) ?? [];
        postings.push({ nodeId, tf: count });
        termsToRewrite.set(term, postings);
      }
    }

    const upsertPosting  = db.prepare('INSERT OR REPLACE INTO bm25_index    VALUES (?, ?)');
    const upsertDoclen   = db.prepare('INSERT OR REPLACE INTO bm25_doclen   VALUES (?, ?)');
    const upsertNodeMeta = db.prepare('INSERT OR REPLACE INTO bm25_nodemeta VALUES (?, ?, ?, ?, ?)');

    db.transaction(() => {
      for (const [term, postings] of termsToRewrite) {
        if (postings.length === 0) {
          // Remove term entirely if no postings remain
          db.prepare('DELETE FROM bm25_index WHERE term = ?').run(term);
        } else {
          upsertPosting.run(term, JSON.stringify(postings));
        }
      }
      for (const node of nodes) {
        const terms = tokenize(nodeToDoc(node));
        upsertDoclen.run(node.id, terms.length);
        upsertNodeMeta.run(node.id, node.name, node.kind, node.filePath, node.content?.slice(0, 200) ?? null);
      }
    })();
    db.close();

    // Update in-memory index if loaded
    if (this._loaded) {
      for (const [term, postings] of termsToRewrite) {
        if (postings.length === 0) this.invertedIndex.delete(term);
        else this.invertedIndex.set(term, postings);
      }
      for (const node of nodes) {
        const terms = tokenize(nodeToDoc(node));
        this.docLengths.set(node.id, terms.length);
        this.nodeMeta.set(node.id, {
          name: node.name,
          kind: node.kind,
          filePath: node.filePath,
          snippet: node.content?.slice(0, 200),
        });
      }
    }
  }
}

// ── Path helper ───────────────────────────────────────────────────────────────

export function getBm25DbPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.code-intel', 'bm25.db');
}
