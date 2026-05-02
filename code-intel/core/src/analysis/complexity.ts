import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { CodeNode } from '../shared/index.js';

export interface ComplexityResult {
  nodeId: string;
  name: string;
  filePath: string;
  cyclomatic: number;
  cognitive: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

function getSeverity(cyclomatic: number): ComplexityResult['severity'] {
  if (cyclomatic <= 5) return 'LOW';
  if (cyclomatic <= 10) return 'MEDIUM';
  if (cyclomatic <= 20) return 'HIGH';
  return 'CRITICAL';
}

export function computeComplexity(graph: KnowledgeGraph, scope?: string): ComplexityResult[] {
  const results: ComplexityResult[] = [];

  for (const node of graph.allNodes()) {
    if (node.kind !== 'function' && node.kind !== 'method') continue;
    if (scope && !node.filePath.startsWith(scope)) continue;

    // Count outgoing calls edges
    let outgoingCalls = 0;
    for (const edge of graph.findEdgesFrom(node.id)) {
      if (edge.kind === 'calls') outgoingCalls++;
    }

    // Cyclomatic: use metadata if present, else proxy formula
    let cyclomatic: number;
    const meta = node.metadata as Record<string, unknown> | undefined;
    const metaComplexity = meta?.complexity as Record<string, unknown> | undefined;
    if (typeof metaComplexity?.cyclomatic === 'number') {
      cyclomatic = metaComplexity.cyclomatic;
    } else {
      cyclomatic = 1 + Math.floor(outgoingCalls / 2);
    }
    // Cap at 50
    cyclomatic = Math.min(cyclomatic, 50);

    // Cognitive: use metadata if present, else approximate
    let cognitive: number;
    if (typeof metaComplexity?.cognitive === 'number') {
      cognitive = metaComplexity.cognitive;
    } else {
      cognitive = Math.ceil(cyclomatic * 1.3);
    }

    results.push({
      nodeId: node.id,
      name: node.name,
      filePath: node.filePath,
      cyclomatic,
      cognitive,
      severity: getSeverity(cyclomatic),
    });
  }

  return results.sort((a, b) => b.cyclomatic - a.cyclomatic);
}
