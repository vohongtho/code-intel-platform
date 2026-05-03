import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

export interface HealthReportResult {
  healthScore: number;
  deadCode: Array<{ name: string; filePath: string; kind: string }>;
  cycles: string[][];
  godNodes: Array<{ name: string; edgeCount: number; filePath: string }>;
  orphanFiles: string[];
  complexityHotspots: Array<{ name: string; blastRadius: number; filePath: string }>;
}

export function computeHealthReport(graph: KnowledgeGraph, scope: string): HealthReportResult {
  const wholeRepo = scope === '.';

  function inScope(filePath: string): boolean {
    if (wholeRepo) return true;
    return filePath.startsWith(scope) || filePath.includes(scope);
  }

  // Collect nodes in scope
  const scopedNodes = [...graph.allNodes()].filter((n) => inScope(n.filePath));

  // ── Dead code ──────────────────────────────────────────────────────────────
  const deadCodeKinds = new Set(['function', 'method', 'class']);
  const deadCode: HealthReportResult['deadCode'] = [];

  for (const node of scopedNodes) {
    if (!deadCodeKinds.has(node.kind)) continue;
    if (node.exported === true) continue;

    // Count incoming edges
    let hasIncoming = false;
    for (const _edge of graph.findEdgesTo(node.id)) {
      hasIncoming = true;
      break;
    }

    if (!hasIncoming) {
      deadCode.push({ name: node.name, filePath: node.filePath, kind: node.kind });
      if (deadCode.length >= 20) break;
    }
  }

  // ── Cycles (DFS on imports edges) ─────────────────────────────────────────
  const cycles: string[][] = [];

  // Build adjacency map for nodes in scope (imports edges)
  const scopedNodeIds = new Set(scopedNodes.map((n) => n.id));
  const importAdj = new Map<string, string[]>();
  for (const node of scopedNodes) {
    importAdj.set(node.id, []);
  }
  for (const edge of graph.findEdgesByKind('imports')) {
    if (scopedNodeIds.has(edge.source) && scopedNodeIds.has(edge.target)) {
      importAdj.get(edge.source)!.push(edge.target);
    }
  }

  // DFS cycle detection
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stackPath: string[] = [];

  function dfs(nodeId: string): void {
    if (cycles.length >= 5) return;
    visited.add(nodeId);
    inStack.add(nodeId);
    stackPath.push(nodeId);

    for (const neighborId of (importAdj.get(nodeId) ?? [])) {
      if (cycles.length >= 5) break;

      if (inStack.has(neighborId)) {
        // Found a cycle — extract the cycle path
        const cycleStart = stackPath.indexOf(neighborId);
        const cyclePath = stackPath.slice(cycleStart).map((id) => {
          const node = graph.getNode(id);
          return node ? node.name : id;
        });
        cycles.push(cyclePath);
      } else if (!visited.has(neighborId)) {
        dfs(neighborId);
      }
    }

    stackPath.pop();
    inStack.delete(nodeId);
  }

  for (const node of scopedNodes) {
    if (cycles.length >= 5) break;
    if (!visited.has(node.id)) {
      dfs(node.id);
    }
  }

  // ── God nodes ──────────────────────────────────────────────────────────────
  const godNodes: HealthReportResult['godNodes'] = [];

  for (const node of scopedNodes) {
    let edgeCount = 0;
    for (const _edge of graph.findEdgesFrom(node.id)) {
      edgeCount++;
    }
    if (edgeCount > 10) {
      godNodes.push({ name: node.name, edgeCount, filePath: node.filePath });
    }
  }
  godNodes.sort((a, b) => b.edgeCount - a.edgeCount);
  godNodes.splice(10);

  // ── Orphan files ───────────────────────────────────────────────────────────
  const filePathToNodes = new Map<string, string[]>();
  for (const node of scopedNodes) {
    if (!node.filePath) continue;
    let arr = filePathToNodes.get(node.filePath);
    if (!arr) {
      arr = [];
      filePathToNodes.set(node.filePath, arr);
    }
    arr.push(node.id);
  }

  const orphanFiles: string[] = [];
  for (const [filePath, nodeIds] of filePathToNodes) {
    if (orphanFiles.length >= 10) break;

    let hasAnyEdge = false;
    for (const nodeId of nodeIds) {
      let hasOut = false;
      for (const _edge of graph.findEdgesFrom(nodeId)) {
        hasOut = true;
        break;
      }
      let hasIn = false;
      for (const _edge of graph.findEdgesTo(nodeId)) {
        hasIn = true;
        break;
      }
      if (hasOut || hasIn) {
        hasAnyEdge = true;
        break;
      }
    }

    if (!hasAnyEdge) {
      orphanFiles.push(filePath);
    }
  }

  // ── Complexity hotspots (blast radius via BFS on incoming calls+imports) ────
  const hotspotCandidates: Array<{ name: string; blastRadius: number; filePath: string }> = [];

  for (const node of scopedNodes) {
    const visitedBfs = new Set<string>();
    const queue: { id: string; depth: number }[] = [{ id: node.id, depth: 0 }];

    while (queue.length > 0) {
      const item = queue.shift()!;
      if (item.depth > 5 || visitedBfs.has(item.id)) continue;
      visitedBfs.add(item.id);

      for (const edge of graph.findEdgesTo(item.id)) {
        if (edge.kind === 'calls' || edge.kind === 'imports') {
          if (!visitedBfs.has(edge.source)) {
            queue.push({ id: edge.source, depth: item.depth + 1 });
          }
        }
      }
    }

    const blastRadius = visitedBfs.size - 1; // exclude self
    hotspotCandidates.push({ name: node.name, blastRadius, filePath: node.filePath });
  }

  hotspotCandidates.sort((a, b) => b.blastRadius - a.blastRadius);
  const complexityHotspots = hotspotCandidates.slice(0, 5);

  // ── Health score ───────────────────────────────────────────────────────────
  const healthScore = Math.max(
    0,
    Math.min(100, 100 - deadCode.length * 2 - cycles.length * 5 - godNodes.length * 3),
  );

  return {
    healthScore,
    deadCode,
    cycles,
    godNodes,
    orphanFiles,
    complexityHotspots,
  };
}
