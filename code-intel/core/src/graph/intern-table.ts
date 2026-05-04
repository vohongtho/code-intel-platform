/**
 * intern-table.ts  — Symbol Interning for Memory Efficiency (Epic 3)
 *
 * Deduplicates repeated strings (filePaths, node kinds, edge kinds) so that
 * all graph nodes sharing the same filePath reference the same string object
 * rather than N separate copies.
 *
 * Usage:
 *   const intern = new InternTable();
 *   node.filePath = intern.get(node.filePath);  // deduplicates
 *
 * Memory savings: For a 10k-file repo with ~30 nodes per file on average,
 * each filePath string is stored once instead of ~30 times.
 * At ~60 bytes per path × 30 duplication factor = ~1.7 MB saved per 10k files.
 */

export class InternTable {
  private readonly table = new Map<string, string>();

  /**
   * Return the canonical (interned) copy of `s`.
   * First call stores it; subsequent calls return the same reference.
   */
  get(s: string): string {
    let interned = this.table.get(s);
    if (interned === undefined) {
      this.table.set(s, s);
      interned = s;
    }
    return interned;
  }

  /** Number of unique strings stored. */
  get size(): number {
    return this.table.size;
  }

  clear(): void {
    this.table.clear();
  }
}

/** Singleton intern table shared across all graph operations in a process. */
export const globalInternTable = new InternTable();

/**
 * Apply interning to all string fields of a CodeNode before it is inserted.
 * Mutates in-place for efficiency (avoids object allocation).
 */
export function internNode<T extends { filePath: string; kind: string; name: string }>(
  node: T,
  table: InternTable = globalInternTable,
): T {
  node.filePath = table.get(node.filePath);
  node.kind     = table.get(node.kind);
  node.name     = table.get(node.name);
  return node;
}

/**
 * Apply interning to all string fields of a CodeEdge before it is inserted.
 */
export function internEdge<T extends { kind: string; source: string; target: string }>(
  edge: T,
  table: InternTable = globalInternTable,
): T {
  edge.kind   = table.get(edge.kind);
  edge.source = table.get(edge.source);
  edge.target = table.get(edge.target);
  return edge;
}
