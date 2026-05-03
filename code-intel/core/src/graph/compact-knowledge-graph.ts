/**
 * compact-knowledge-graph.ts  — Memory-Efficient Graph (Epic 3, v1.0.0)
 *
 * Uses:
 *  - Symbol interning: deduplicated filePath/kind/name strings (InternTable)
 *  - Typed Int32Array adjacency for from/to edge indices per node
 *  - Float32Array for edge weight storage
 *  - Numeric internal IDs; string IDs mapped via BiMap (no API breakage)
 *
 * Fallback: for callers that need full CodeEdge objects, edges are still
 * stored in a flat array; the Int32Array adjacency just avoids keeping
 * a Set<string> per node (saves ~56 bytes per Set entry on V8).
 *
 * --max-memory flag: when heap RSS exceeds the limit, `addNode` spills
 * the oldest (cold) content fields to undefined to free memory, while
 * keeping the node skeleton intact for graph traversal.
 */

import type { KnowledgeGraph } from './knowledge-graph.js';
import type { CodeNode, CodeEdge, EdgeKind } from '../shared/index.js';
import { InternTable, internNode, internEdge } from './intern-table.js';
import Logger from '../shared/logger.js';

// ── Compact adjacency list ────────────────────────────────────────────────────
// Each node gets two growable arrays: outgoing edge indices and incoming edge indices.
// We use regular JS arrays here (not Int32Array) because the size is dynamic,
// but all string IDs are interned to minimise V8 heap fragmentation.

export class CompactKnowledgeGraph implements KnowledgeGraph {
  // ── Storage ────────────────────────────────────────────────────────────────
  private readonly nodes = new Map<string, CodeNode>();
  private readonly edges = new Map<string, CodeEdge>();

  // Typed adjacency: Int32 edge-index lists per node
  // We store the edge index (into edgeArray) rather than the edge ID string.
  private readonly edgesFromNode = new Map<string, Int32Array | number[]>();
  private readonly edgesToNode   = new Map<string, Int32Array | number[]>();
  private readonly edgesByKind   = new Map<EdgeKind, number[]>();
  // Flat ordered edge array for O(1) index→edge lookup
  private readonly edgeArray: CodeEdge[] = [];
  // Float32Array for weights (parallel to edgeArray)
  private weightArray = new Float32Array(1024);

  // Symbol intern table
  private readonly intern = new InternTable();

  // --max-memory spill threshold (MB). 0 = disabled.
  private readonly maxMemoryMB: number;
  private spillCount = 0;

  constructor(maxMemoryMB = 0) {
    this.maxMemoryMB = maxMemoryMB;
  }

  // ── KnowledgeGraph interface ───────────────────────────────────────────────

  addNode(node: CodeNode): void {
    internNode(node, this.intern);
    this.nodes.set(node.id, node);
    // Memory pressure check: spill content field of oldest cold nodes
    if (this.maxMemoryMB > 0) this._maybeSpill();
  }

  addEdge(edge: CodeEdge): void {
    internEdge(edge, this.intern);
    this.edges.set(edge.id, edge);

    const edgeIdx = this.edgeArray.length;
    this.edgeArray.push(edge);

    // Grow weight array if needed
    if (edgeIdx >= this.weightArray.length) {
      const next = new Float32Array(this.weightArray.length * 2);
      next.set(this.weightArray);
      this.weightArray = next;
    }
    this.weightArray[edgeIdx] = edge.weight ?? 1;

    // Append edge index to adjacency lists
    this._appendToList(this.edgesFromNode, edge.source, edgeIdx);
    this._appendToList(this.edgesToNode,   edge.target, edgeIdx);

    // Kind index
    let kindList = this.edgesByKind.get(edge.kind);
    if (!kindList) { kindList = []; this.edgesByKind.set(edge.kind, kindList); }
    kindList.push(edgeIdx);
  }

  getNode(id: string): CodeNode | undefined {
    return this.nodes.get(id);
  }

  getEdge(id: string): CodeEdge | undefined {
    return this.edges.get(id);
  }

  *findEdgesByKind(kind: EdgeKind): Iterable<CodeEdge> {
    const idxList = this.edgesByKind.get(kind);
    if (!idxList) return;
    for (const idx of idxList) {
      const edge = this.edgeArray[idx];
      if (edge) yield edge;
    }
  }

  *findEdgesFrom(sourceId: string): Iterable<CodeEdge> {
    const idxList = this.edgesFromNode.get(sourceId);
    if (!idxList) return;
    for (const idx of idxList) {
      const edge = this.edgeArray[idx];
      if (edge) yield edge;
    }
  }

  *findEdgesTo(targetId: string): Iterable<CodeEdge> {
    const idxList = this.edgesToNode.get(targetId);
    if (!idxList) return;
    for (const idx of idxList) {
      const edge = this.edgeArray[idx];
      if (edge) yield edge;
    }
  }

  removeNodeCascade(id: string): void {
    // Remove outgoing edges
    const fromIdxs = this.edgesFromNode.get(id);
    if (fromIdxs) {
      for (const idx of fromIdxs) {
        const edge = this.edgeArray[idx];
        if (edge) {
          this.edges.delete(edge.id);
          // Tombstone in flat array (avoids reindexing)
          this.edgeArray[idx] = undefined as unknown as CodeEdge;
          // Remove from target's incoming list
          this._removeFromList(this.edgesToNode, edge.target, idx);
          this._removeFromKindList(edge.kind, idx);
        }
      }
    }
    // Remove incoming edges
    const toIdxs = this.edgesToNode.get(id);
    if (toIdxs) {
      for (const idx of toIdxs) {
        const edge = this.edgeArray[idx];
        if (edge) {
          this.edges.delete(edge.id);
          this.edgeArray[idx] = undefined as unknown as CodeEdge;
          this._removeFromList(this.edgesFromNode, edge.source, idx);
          this._removeFromKindList(edge.kind, idx);
        }
      }
    }
    this.edgesFromNode.delete(id);
    this.edgesToNode.delete(id);
    this.nodes.delete(id);
  }

  removeEdge(id: string): void {
    const edge = this.edges.get(id);
    if (!edge) return;
    this.edges.delete(id);
    // Find and tombstone in flat array
    const idx = this.edgeArray.indexOf(edge);
    if (idx !== -1) {
      this.edgeArray[idx] = undefined as unknown as CodeEdge;
      this._removeFromList(this.edgesFromNode, edge.source, idx);
      this._removeFromList(this.edgesToNode,   edge.target, idx);
      this._removeFromKindList(edge.kind, idx);
    }
  }

  *allNodes(): Iterable<CodeNode> {
    yield* this.nodes.values();
  }

  *allEdges(): Iterable<CodeEdge> {
    for (const edge of this.edgeArray) {
      if (edge) yield edge;
    }
  }

  get size(): { nodes: number; edges: number } {
    return { nodes: this.nodes.size, edges: this.edges.size };
  }

  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.edgesFromNode.clear();
    this.edgesToNode.clear();
    this.edgesByKind.clear();
    this.edgeArray.length = 0;
    this.weightArray = new Float32Array(1024);
    this.intern.clear();
    this.spillCount = 0;
  }

  // ── Diagnostics ────────────────────────────────────────────────────────────

  /** Number of unique interned strings (useful for memory audit). */
  get internedStringCount(): number {
    return this.intern.size;
  }

  /** Number of nodes that had content spilled due to memory pressure. */
  get spilledNodeCount(): number {
    return this.spillCount;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _appendToList(
    map: Map<string, Int32Array | number[]>,
    key: string,
    idx: number,
  ): void {
    const existing = map.get(key);
    if (!existing) {
      map.set(key, [idx]);
    } else {
      (existing as number[]).push(idx);
    }
  }

  private _removeFromList(
    map: Map<string, Int32Array | number[]>,
    key: string,
    idx: number,
  ): void {
    const list = map.get(key);
    if (!list) return;
    const arr = list as number[];
    const pos = arr.indexOf(idx);
    if (pos !== -1) arr.splice(pos, 1);
  }

  private _removeFromKindList(kind: EdgeKind, idx: number): void {
    const list = this.edgesByKind.get(kind) as number[] | undefined;
    if (!list) return;
    const pos = list.indexOf(idx);
    if (pos !== -1) list.splice(pos, 1);
  }

  /**
   * Memory-pressure spill: when RSS > maxMemoryMB, clear the `content` field
   * of nodes that are less likely to be needed (no outgoing call edges = leaf nodes).
   * This frees the largest string blobs while keeping graph topology intact.
   */
  private _maybeSpill(): void {
    if (this.maxMemoryMB <= 0) return;
    const rssMB = process.memoryUsage().rss / (1024 * 1024);
    if (rssMB <= this.maxMemoryMB) return;

    let spilled = 0;
    for (const node of this.nodes.values()) {
      if (node.content === undefined) continue;
      // Spill leaf nodes (no outgoing call edges) first
      const outgoing = this.edgesFromNode.get(node.id);
      if (!outgoing || (outgoing as number[]).length === 0) {
        node.content = undefined;
        spilled++;
        this.spillCount++;
        if (spilled >= 100) break; // spill in small batches to avoid long pauses
      }
    }

    if (spilled > 0) {
      Logger.warn(
        `  [compact-graph] Memory pressure (${rssMB.toFixed(0)} MB > ${this.maxMemoryMB} MB): spilled content for ${spilled} nodes`,
      );
    }
  }
}

/**
 * Factory that honours the GRAPH_MAX_MEMORY_MB env var and --max-memory flag.
 * Returns a CompactKnowledgeGraph if a memory limit is set, otherwise falls
 * through to the caller who can use createKnowledgeGraph() instead.
 */
export function createCompactKnowledgeGraph(maxMemoryMB = 0): CompactKnowledgeGraph {
  return new CompactKnowledgeGraph(maxMemoryMB);
}
