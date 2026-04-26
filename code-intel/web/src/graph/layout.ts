import type { CodeEdge } from '@code-intel/shared';

/**
 * BFS over undirected adjacency to find nodes within `maxHops` of `startId`.
 */
export function neighborhood(
  startId: string,
  edges: CodeEdge[],
  maxHops: number,
): Set<string> {
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, new Set());
    if (!adj.has(e.target)) adj.set(e.target, new Set());
    adj.get(e.source)!.add(e.target);
    adj.get(e.target)!.add(e.source);
  }
  const visited = new Set<string>([startId]);
  let frontier = new Set<string>([startId]);
  for (let hop = 0; hop < maxHops; hop++) {
    const next = new Set<string>();
    for (const id of frontier) {
      const nbrs = adj.get(id);
      if (!nbrs) continue;
      for (const n of nbrs) {
        if (!visited.has(n)) {
          visited.add(n);
          next.add(n);
        }
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }
  return visited;
}

/**
 * Direct neighbors (1-hop) for highlight rendering.
 */
export function directNeighbors(nodeId: string, edges: CodeEdge[]): Set<string> {
  const result = new Set<string>([nodeId]);
  for (const e of edges) {
    if (e.source === nodeId) result.add(e.target);
    else if (e.target === nodeId) result.add(e.source);
  }
  return result;
}
