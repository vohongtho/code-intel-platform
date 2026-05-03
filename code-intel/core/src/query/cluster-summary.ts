import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { computeHealthReport } from './health-report.js';

export interface ClusterSummaryResult {
  cluster: string;
  purpose: string;
  keySymbols: Array<{ name: string; callerCount: number }>;
  dependencies: string[];
  dependents: string[];
  health: { score: number };
  symbolCount: Record<string, number>;
}

function getPathPrefix(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts.slice(0, 2).join('/');
}

export function summarizeCluster(
  graph: KnowledgeGraph,
  cluster: string,
): ClusterSummaryResult | { error: string } {
  // Collect all nodes in this cluster
  const clusterNodes = [...graph.allNodes()].filter(
    (n) => n.filePath.startsWith(cluster) || n.metadata?.['cluster'] === cluster,
  );

  if (clusterNodes.length === 0) {
    return { error: `Cluster not found: ${cluster}` };
  }

  const clusterNodeIds = new Set(clusterNodes.map((n) => n.id));

  // ── Key symbols: top 5 by incoming edge count ──────────────────────────────
  const callerCountMap = new Map<string, number>();
  for (const node of clusterNodes) {
    let count = 0;
    for (const _edge of graph.findEdgesTo(node.id)) {
      count++;
    }
    callerCountMap.set(node.id, count);
  }

  const sortedByCallers = [...clusterNodes].sort(
    (a, b) => (callerCountMap.get(b.id) ?? 0) - (callerCountMap.get(a.id) ?? 0),
  );

  const keySymbols = sortedByCallers.slice(0, 5).map((n) => ({
    name: n.name,
    callerCount: callerCountMap.get(n.id) ?? 0,
  }));

  // ── Dependencies: clusters this one imports FROM (external) ───────────────
  const depsSet = new Set<string>();
  for (const node of clusterNodes) {
    for (const edge of graph.findEdgesFrom(node.id)) {
      if (edge.kind !== 'imports') continue;
      const targetNode = graph.getNode(edge.target);
      if (!targetNode) continue;
      if (!clusterNodeIds.has(targetNode.id)) {
        // External dependency
        const prefix = getPathPrefix(targetNode.filePath);
        depsSet.add(prefix);
      }
    }
  }
  const dependencies = [...depsSet];

  // ── Dependents: clusters that import FROM this cluster (external) ──────────
  const dependentsSet = new Set<string>();
  for (const node of clusterNodes) {
    for (const edge of graph.findEdgesTo(node.id)) {
      if (edge.kind !== 'imports') continue;
      const sourceNode = graph.getNode(edge.source);
      if (!sourceNode) continue;
      if (!clusterNodeIds.has(sourceNode.id)) {
        // External dependent
        const prefix = getPathPrefix(sourceNode.filePath);
        dependentsSet.add(prefix);
      }
    }
  }
  const dependents = [...dependentsSet];

  // ── Health ─────────────────────────────────────────────────────────────────
  const healthResult = computeHealthReport(graph, cluster);
  const health = { score: healthResult.healthScore };

  // ── Symbol count by kind ───────────────────────────────────────────────────
  const symbolCount: Record<string, number> = {};
  for (const node of clusterNodes) {
    symbolCount[node.kind] = (symbolCount[node.kind] ?? 0) + 1;
  }

  // ── Purpose ───────────────────────────────────────────────────────────────
  let purpose: string;
  const topNode = sortedByCallers[0];
  if (topNode?.metadata?.['summary'] && typeof topNode.metadata['summary'] === 'string') {
    purpose = topNode.metadata['summary'] as string;
  } else {
    const clusterName = cluster.split('/').pop() ?? cluster;
    purpose = `Handles ${clusterName.replace(/[-_/]/g, ' ')} functionality`;
  }

  return {
    cluster,
    purpose,
    keySymbols,
    dependencies,
    dependents,
    health,
    symbolCount,
  };
}
