/**
 * lazy-knowledge-graph.ts
 *
 * Memory-efficient KnowledgeGraph for `serve` mode (Epic 1 — v1.0.0).
 *
 * Strategy:
 *  - Edges are loaded fully at init (lightweight: no content field).
 *  - Nodes are fetched from DB on demand and kept in an LRU cache.
 *  - Default cache size: 5,000 nodes (override with GRAPH_CACHE_SIZE env var).
 *  - Background warm: pre-load top-N highest-blast-radius nodes after startup.
 *
 * The `serve` startup now only loads meta.json + all edges — no full graph load.
 */

import type { KnowledgeGraph } from './knowledge-graph.js';
import type { CodeNode, CodeEdge, EdgeKind, NodeKind } from '../shared/index.js';
import type { DbManager } from '../storage/db-manager.js';
import { NODE_TABLE_MAP, ALL_NODE_TABLES } from '../storage/schema.js';
import Logger from '../shared/logger.js';

// ── Reverse table→kind lookup ────────────────────────────────────────────────
const TABLE_TO_KIND: Record<string, NodeKind> = Object.fromEntries(
  Object.entries(NODE_TABLE_MAP).map(([kind, table]) => [table, kind as NodeKind]),
);

// ── LRU cache ────────────────────────────────────────────────────────────────

/**
 * O(1) LRU cache backed by Map insertion order.
 * `set` moves key to most-recently-used; evicts least-recently-used on overflow.
 */
class LRUCache<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly maxSize: number) {}

  get(key: string): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      // Promote to MRU end
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    // Evict LRU entry (first inserted) when over limit
    if (this.map.size > this.maxSize) {
      const lruKey = this.map.keys().next().value as string;
      this.map.delete(lruKey);
    }
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get size(): number {
    return this.map.size;
  }

  values(): IterableIterator<V> {
    return this.map.values();
  }

  clear(): void {
    this.map.clear();
  }

  /** Evict LRU entries until cache is at or below maxSize */
  evict(): void {
    while (this.map.size > this.maxSize) {
      const lruKey = this.map.keys().next().value as string;
      this.map.delete(lruKey);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseNodeRow(row: Record<string, unknown>, kind: NodeKind): CodeNode {
  return {
    id: String(row['id'] ?? ''),
    kind,
    name: String(row['name'] ?? ''),
    filePath: String(row['file_path'] ?? ''),
    startLine: row['start_line'] != null ? Number(row['start_line']) : undefined,
    endLine: row['end_line'] != null ? Number(row['end_line']) : undefined,
    exported: row['exported'] != null ? Boolean(row['exported']) : undefined,
    content: row['content'] ? String(row['content']) : undefined,
    metadata: row['metadata']
      ? (() => {
          try {
            return JSON.parse(String(row['metadata'])) as Record<string, unknown>;
          } catch {
            return undefined;
          }
        })()
      : undefined,
  };
}

function escCypher(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '');
}

// ── LazyKnowledgeGraph ───────────────────────────────────────────────────────

/**
 * Extended interface — callers in app.ts use this for async/paginated access.
 */
export interface LazyGraphExtensions {
  /** Marker that lets runtime callers detect lazy mode. */
  readonly lazy: true;
  /** Fetch a node from DB on cache miss; returns undefined if not found. */
  getNodeAsync(id: string): Promise<CodeNode | undefined>;
  /** Return a page of nodes from DB (streams + caches each node). */
  getNodePage(offset: number, limit: number): Promise<CodeNode[]>;
  /** Pre-warm cache with highest-blast-radius nodes (called in background). */
  warmTopNodes(topN?: number): Promise<void>;
  /** Async generator: stream all nodes from DB, caching each one. */
  allNodesAsync(): AsyncGenerator<CodeNode>;
}

export class LazyKnowledgeGraph implements KnowledgeGraph, LazyGraphExtensions {
  readonly lazy = true as const;

  private readonly nodeCache: LRUCache<CodeNode>;
  private readonly edges = new Map<string, CodeEdge>();
  private readonly edgesFromNode = new Map<string, Set<string>>();
  private readonly edgesToNode = new Map<string, Set<string>>();
  private readonly edgesByKind = new Map<EdgeKind, Set<string>>();

  private _nodeCount = 0;
  private _edgeCount = 0;
  private dbManager: DbManager | null = null;

  constructor() {
    const maxSize = parseInt(process.env['GRAPH_CACHE_SIZE'] ?? '5000', 10);
    this.nodeCache = new LRUCache<CodeNode>(maxSize);
  }

  // ── Initialization ─────────────────────────────────────────────────────────

  /**
   * Init: load ALL edges into memory (lightweight — no content field).
   * Node counts come from meta.json — no nodes are loaded here.
   *
   * @param dbManager  Open DB connection (kept alive for lazy node fetches).
   * @param nodeCount  Total node count from meta.json stats.
   * @param edgeCount  Estimated edge count from meta.json stats (updated after load).
   */
  async init(
    dbManager: DbManager,
    nodeCount?: number,
    edgeCount?: number,
  ): Promise<void> {
    this.dbManager = dbManager;
    if (nodeCount !== undefined) this._nodeCount = nodeCount;
    if (edgeCount !== undefined) this._edgeCount = edgeCount;
    await this._loadAllEdges();
  }

  // ── Async extensions ───────────────────────────────────────────────────────

  /** Fetch a single node from DB on cache miss. */
  async getNodeAsync(id: string): Promise<CodeNode | undefined> {
    // Cache hit — promote to MRU
    const cached = this.nodeCache.get(id);
    if (cached) return cached;

    if (!this.dbManager) return undefined;

    // Extract kind from node ID: `{kind}:{filePath}:{name}`
    const colonIdx = id.indexOf(':');
    if (colonIdx === -1) return undefined;
    const kind = id.slice(0, colonIdx) as NodeKind;
    const table = NODE_TABLE_MAP[kind];
    if (!table) return undefined;

    try {
      const rows = await this.dbManager.query(
        `MATCH (n:${table} {id: '${escCypher(id)}'}) RETURN n.id, n.name, n.file_path, n.start_line, n.end_line, n.exported, n.content, n.metadata`,
      );
      if (rows.length === 0) return undefined;

      const row = rows[0]!;
      const node = parseNodeRow(
        {
          id: row['n.id'],
          name: row['n.name'],
          file_path: row['n.file_path'],
          start_line: row['n.start_line'],
          end_line: row['n.end_line'],
          exported: row['n.exported'],
          content: row['n.content'],
          metadata: row['n.metadata'],
        },
        kind,
      );

      if (node.id && node.name) {
        this.nodeCache.set(node.id, node);
        return node;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Return a page of nodes by streaming from DB.
   * Nodes are added to the LRU cache as they are fetched.
   */
  async getNodePage(offset: number, limit: number): Promise<CodeNode[]> {
    const result: CodeNode[] = [];
    let skipped = 0;

    for await (const node of this.allNodesAsync()) {
      if (skipped < offset) {
        skipped++;
        continue;
      }
      result.push(node);
      if (result.length >= limit) break;
    }

    return result;
  }

  /**
   * Pre-warm the LRU cache with the top-N highest-blast-radius nodes
   * (those with the most outgoing edges).  Called in background after startup.
   */
  async warmTopNodes(topN = 500): Promise<void> {
    if (!this.dbManager) return;

    // Rank nodes by outgoing edge count (computed from the in-memory edge index)
    const scored: Array<[string, number]> = [];
    for (const [nodeId, edgeSet] of this.edgesFromNode) {
      scored.push([nodeId, edgeSet.size]);
    }
    scored.sort((a, b) => b[1] - a[1]);

    const topIds = scored.slice(0, topN).map(([id]) => id);
    let loaded = 0;

    for (const id of topIds) {
      if (!this.nodeCache.has(id)) {
        await this.getNodeAsync(id);
        loaded++;
      }
    }

    Logger.info(
      `  [lazy-graph] Background warm: ${loaded} high-blast-radius nodes loaded into cache`,
    );
  }

  /** Async generator: stream all nodes from DB, caching each one. */
  async *allNodesAsync(): AsyncGenerator<CodeNode> {
    if (!this.dbManager) return;

    for (const table of ALL_NODE_TABLES) {
      const kind = TABLE_TO_KIND[table];
      if (!kind) continue;

      try {
        const rows = await this.dbManager.query(
          `MATCH (n:${table}) RETURN n.id, n.name, n.file_path, n.start_line, n.end_line, n.exported, n.content, n.metadata`,
        );
        for (const row of rows) {
          const node = parseNodeRow(
            {
              id: row['n.id'],
              name: row['n.name'],
              file_path: row['n.file_path'],
              start_line: row['n.start_line'],
              end_line: row['n.end_line'],
              exported: row['n.exported'],
              content: row['n.content'],
              metadata: row['n.metadata'],
            },
            kind,
          );
          if (node.id && node.name) {
            this.nodeCache.set(node.id, node);
            yield node;
          }
        }
      } catch {
        // Table may not exist in older DBs — skip
        continue;
      }
    }
  }

  // ── KnowledgeGraph interface ───────────────────────────────────────────────

  addNode(node: CodeNode): void {
    this.nodeCache.set(node.id, node);
    this._nodeCount++;
  }

  addEdge(edge: CodeEdge): void {
    this.edges.set(edge.id, edge);
    this._indexEdge(edge);
    this._edgeCount = this.edges.size;
  }

  /**
   * Sync node lookup — returns from LRU cache only.
   * Use `getNodeAsync(id)` for a full DB lookup on cache miss.
   */
  getNode(id: string): CodeNode | undefined {
    return this.nodeCache.get(id);
  }

  getEdge(id: string): CodeEdge | undefined {
    return this.edges.get(id);
  }

  *findEdgesByKind(kind: EdgeKind): Iterable<CodeEdge> {
    const ids = this.edgesByKind.get(kind);
    if (!ids) return;
    for (const id of ids) {
      const edge = this.edges.get(id);
      if (edge) yield edge;
    }
  }

  *findEdgesFrom(sourceId: string): Iterable<CodeEdge> {
    const ids = this.edgesFromNode.get(sourceId);
    if (!ids) return;
    for (const id of ids) {
      const edge = this.edges.get(id);
      if (edge) yield edge;
    }
  }

  *findEdgesTo(targetId: string): Iterable<CodeEdge> {
    const ids = this.edgesToNode.get(targetId);
    if (!ids) return;
    for (const id of ids) {
      const edge = this.edges.get(id);
      if (edge) yield edge;
    }
  }

  removeNodeCascade(id: string): void {
    for (const edgeId of [...(this.edgesFromNode.get(id) ?? [])]) {
      const edge = this.edges.get(edgeId);
      if (edge) { this._unindexEdge(edge); this.edges.delete(edgeId); }
    }
    for (const edgeId of [...(this.edgesToNode.get(id) ?? [])]) {
      const edge = this.edges.get(edgeId);
      if (edge) { this._unindexEdge(edge); this.edges.delete(edgeId); }
    }
    this.edgesFromNode.delete(id);
    this.edgesToNode.delete(id);
    this._nodeCount = Math.max(0, this._nodeCount - 1);
    // Node will age out of LRU naturally; no forced cache removal needed
  }

  removeEdge(id: string): void {
    const edge = this.edges.get(id);
    if (edge) {
      this._unindexEdge(edge);
      this.edges.delete(id);
    }
  }

  /**
   * Iterates only the cached nodes.
   * For full graph iteration use `allNodesAsync()`.
   */
  *allNodes(): Iterable<CodeNode> {
    yield* this.nodeCache.values();
  }

  *allEdges(): Iterable<CodeEdge> {
    yield* this.edges.values();
  }

  get size(): { nodes: number; edges: number } {
    // Node count comes from meta.json (authoritative); edge count is live.
    return { nodes: this._nodeCount, edges: this._edgeCount };
  }

  clear(): void {
    this.nodeCache.clear();
    this.edges.clear();
    this.edgesFromNode.clear();
    this.edgesToNode.clear();
    this.edgesByKind.clear();
    this._nodeCount = 0;
    this._edgeCount = 0;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _loadAllEdges(): Promise<void> {
    if (!this.dbManager) return;
    try {
      const edgeRows = await this.dbManager.query(
        `MATCH (a)-[e:code_edges]->(b) RETURN a.id, b.id, e.kind, e.weight, e.label`,
      );
      for (const row of edgeRows) {
        const sourceId = String(row['a.id'] ?? '');
        const targetId = String(row['b.id'] ?? '');
        const kind = String(row['e.kind'] ?? '') as EdgeKind;
        if (!sourceId || !targetId || !kind) continue;
        const edge: CodeEdge = {
          id: `${sourceId}::${kind}::${targetId}`,
          source: sourceId,
          target: targetId,
          kind,
          weight: row['e.weight'] != null ? Number(row['e.weight']) : undefined,
          label: row['e.label'] ? String(row['e.label']) : undefined,
        };
        this.edges.set(edge.id, edge);
        this._indexEdge(edge);
      }
      this._edgeCount = this.edges.size;
    } catch (err) {
      Logger.warn('[lazy-graph] Failed to load edges:', err instanceof Error ? err.message : err);
    }
  }

  private _indexEdge(edge: CodeEdge): void {
    let kindSet = this.edgesByKind.get(edge.kind);
    if (!kindSet) { kindSet = new Set(); this.edgesByKind.set(edge.kind, kindSet); }
    kindSet.add(edge.id);

    let fromSet = this.edgesFromNode.get(edge.source);
    if (!fromSet) { fromSet = new Set(); this.edgesFromNode.set(edge.source, fromSet); }
    fromSet.add(edge.id);

    let toSet = this.edgesToNode.get(edge.target);
    if (!toSet) { toSet = new Set(); this.edgesToNode.set(edge.target, toSet); }
    toSet.add(edge.id);
  }

  private _unindexEdge(edge: CodeEdge): void {
    this.edgesByKind.get(edge.kind)?.delete(edge.id);
    this.edgesFromNode.get(edge.source)?.delete(edge.id);
    this.edgesToNode.get(edge.target)?.delete(edge.id);
  }
}

/** Type guard — true when `g` is a LazyKnowledgeGraph with async extensions. */
export function isLazyGraph(g: KnowledgeGraph): g is LazyKnowledgeGraph & LazyGraphExtensions {
  return 'lazy' in g && (g as { lazy: unknown }).lazy === true;
}
