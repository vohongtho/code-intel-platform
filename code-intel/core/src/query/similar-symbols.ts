import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

export interface SimilarSymbol {
  name: string;
  similarity: number;
  reasons: string[];
}

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // dp[i][j] = edit distance between a[0..i-1] and b[0..j-1]
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

export function findSimilarSymbols(
  graph: KnowledgeGraph,
  symbolName: string,
  limit: number,
): { similar: SimilarSymbol[] } {
  const clampedLimit = Math.min(Math.max(1, limit), 50);

  const allNodes = [...graph.allNodes()];
  const targetNode = allNodes.find((n) => n.name === symbolName);

  if (!targetNode) {
    return { similar: [] };
  }

  // Determine cluster of the target node (via belongs_to edge)
  let targetCluster: string | null = null;
  for (const edge of graph.findEdgesFrom(targetNode.id)) {
    if (edge.kind === 'belongs_to') {
      const clusterNode = graph.getNode(edge.target);
      if (clusterNode) {
        targetCluster = clusterNode.name;
        break;
      }
    }
  }
  // Also check incoming belongs_to in case it's modeled differently
  if (!targetCluster) {
    for (const edge of graph.findEdgesTo(targetNode.id)) {
      if (edge.kind === 'belongs_to') {
        const clusterNode = graph.getNode(edge.source);
        if (clusterNode) {
          targetCluster = clusterNode.name;
          break;
        }
      }
    }
  }

  const results: SimilarSymbol[] = [];

  for (const node of allNodes) {
    // Exclude the symbol itself
    if (node.id === targetNode.id) continue;

    // Name similarity: 1 - (levenshtein / max(a.length, b.length))
    const maxLen = Math.max(symbolName.length, node.name.length);
    const nameSim = maxLen === 0 ? 1 : 1 - levenshtein(symbolName, node.name) / maxLen;

    // Structural similarity: same kind = 0.5, different = 0.0
    const structuralSim = node.kind === targetNode.kind ? 0.5 : 0.0;

    // Combined score
    const combined = 0.5 * nameSim + 0.5 * structuralSim;

    // Build reasons
    const reasons: string[] = [];
    if (nameSim >= 0.6) reasons.push('similar name');
    if (node.kind === targetNode.kind) reasons.push('same kind');

    // Same cluster check
    if (targetCluster !== null) {
      let nodeCluster: string | null = null;
      for (const edge of graph.findEdgesFrom(node.id)) {
        if (edge.kind === 'belongs_to') {
          const clusterNode = graph.getNode(edge.target);
          if (clusterNode) { nodeCluster = clusterNode.name; break; }
        }
      }
      if (!nodeCluster) {
        for (const edge of graph.findEdgesTo(node.id)) {
          if (edge.kind === 'belongs_to') {
            const clusterNode = graph.getNode(edge.source);
            if (clusterNode) { nodeCluster = clusterNode.name; break; }
          }
        }
      }
      if (nodeCluster !== null && nodeCluster === targetCluster) {
        reasons.push('same module');
      }
    }

    // Also check metadata cluster field (common pattern in this codebase)
    if (
      targetNode.metadata?.['cluster'] !== undefined &&
      node.metadata?.['cluster'] !== undefined &&
      node.metadata['cluster'] === targetNode.metadata['cluster']
    ) {
      if (!reasons.includes('same module')) reasons.push('same module');
    }

    results.push({ name: node.name, similarity: combined, reasons });
  }

  // Sort by combined score desc, take top clampedLimit
  results.sort((a, b) => b.similarity - a.similarity);
  return { similar: results.slice(0, clampedLimit) };
}
