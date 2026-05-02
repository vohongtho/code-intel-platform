import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

export interface CycleResult {
  cycleId: string;
  members: string[]; // node IDs in the cycle
}

/**
 * Detect circular dependencies using Tarjan's SCC on the imports graph.
 * SCC size > 1 = cycle.
 * Sets metadata.health.inCycle = true, metadata.health.cycleId on affected nodes.
 * Performance: O(V+E) — handles 10k nodes < 100ms.
 */
export function detectCircularDeps(graph: KnowledgeGraph): CycleResult[] {
  // Build adjacency list from imports edges (file → file)
  const nodeIds: string[] = [];
  const nodeIndexMap = new Map<string, number>();

  // Collect all file nodes first
  for (const node of graph.allNodes()) {
    if (node.kind === 'file') {
      nodeIndexMap.set(node.id, nodeIds.length);
      nodeIds.push(node.id);
    }
  }

  const n = nodeIds.length;
  // Build adjacency list (index-based for performance)
  const adj: number[][] = Array.from({ length: n }, () => []);

  for (const edge of graph.findEdgesByKind('imports')) {
    const srcIdx = nodeIndexMap.get(edge.source);
    const tgtIdx = nodeIndexMap.get(edge.target);
    if (srcIdx !== undefined && tgtIdx !== undefined && srcIdx !== tgtIdx) {
      adj[srcIdx]!.push(tgtIdx);
    }
  }

  // Tarjan's SCC — iterative to avoid stack overflow on large graphs
  const index: number[] = new Array(n).fill(-1);
  const lowlink: number[] = new Array(n).fill(0);
  const onStack: boolean[] = new Array(n).fill(false);
  const stack: number[] = [];
  const sccs: number[][] = [];
  let idx = 0;

  // Iterative Tarjan using explicit call stack
  // Each stack frame: { v, childIdx }
  type Frame = { v: number; childIdx: number };
  const callStack: Frame[] = [];

  for (let startV = 0; startV < n; startV++) {
    if (index[startV] !== -1) continue;

    // Push initial frame
    callStack.push({ v: startV, childIdx: 0 });
    index[startV] = lowlink[startV] = idx++;
    stack.push(startV);
    onStack[startV] = true;

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1]!;
      const { v } = frame;
      const neighbors = adj[v]!;

      if (frame.childIdx < neighbors.length) {
        const w = neighbors[frame.childIdx]!;
        frame.childIdx++;

        if (index[w] === -1) {
          // Tree edge: recurse
          index[w] = lowlink[w] = idx++;
          stack.push(w);
          onStack[w] = true;
          callStack.push({ v: w, childIdx: 0 });
        } else if (onStack[w]) {
          // Back edge: update lowlink
          if (lowlink[w]! < lowlink[v]!) {
            lowlink[v] = lowlink[w]!;
          }
        }
      } else {
        // Done with this node: pop
        callStack.pop();

        if (callStack.length > 0) {
          const parentFrame = callStack[callStack.length - 1]!;
          const parent = parentFrame.v;
          // Update parent's lowlink
          if (lowlink[v]! < lowlink[parent]!) {
            lowlink[parent] = lowlink[v]!;
          }
        }

        // If v is root of an SCC
        if (lowlink[v] === index[v]) {
          const scc: number[] = [];
          let w: number;
          do {
            w = stack.pop()!;
            onStack[w] = false;
            scc.push(w);
          } while (w !== v);
          sccs.push(scc);
        }
      }
    }
  }

  // Filter SCCs with size > 1 (those are cycles)
  const results: CycleResult[] = [];
  let cycleCounter = 0;

  for (const scc of sccs) {
    if (scc.length <= 1) continue;

    const cycleId = `cycle-${cycleCounter++}`;
    const members = scc.map((i) => nodeIds[i]!);

    results.push({ cycleId, members });

    // Mark nodes in graph
    for (const nodeId of members) {
      const node = graph.getNode(nodeId);
      if (!node) continue;
      const health = (node.metadata ?? {}) as Record<string, unknown>;
      const existingHealth = (health['health'] ?? {}) as Record<string, unknown>;
      node.metadata = {
        ...health,
        health: { ...existingHealth, inCycle: true, cycleId },
      };
    }
  }

  return results;
}
