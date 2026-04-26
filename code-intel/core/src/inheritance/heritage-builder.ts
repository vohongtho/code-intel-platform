import type { CodeEdge } from '../shared/index.js';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { generateEdgeId } from '../graph/id-generator.js';

export interface HeritageInfo {
  classNodeId: string;
  extendsNames: string[];
  implementsNames: string[];
}

export function buildHeritageEdges(
  heritages: HeritageInfo[],
  graph: KnowledgeGraph,
): CodeEdge[] {
  const edges: CodeEdge[] = [];
  const classIndex = new Map<string, string>();

  for (const node of graph.allNodes()) {
    if (['class', 'interface', 'struct', 'trait'].includes(node.kind)) {
      classIndex.set(node.name, node.id);
    }
  }

  for (const h of heritages) {
    for (const name of h.extendsNames) {
      const targetId = classIndex.get(name);
      if (targetId) {
        edges.push({
          id: generateEdgeId(h.classNodeId, targetId, 'extends'),
          source: h.classNodeId,
          target: targetId,
          kind: 'extends',
          weight: 1.0,
          label: `extends ${name}`,
        });
      }
    }

    for (const name of h.implementsNames) {
      const targetId = classIndex.get(name);
      if (targetId) {
        edges.push({
          id: generateEdgeId(h.classNodeId, targetId, 'implements'),
          source: h.classNodeId,
          target: targetId,
          kind: 'implements',
          weight: 1.0,
          label: `implements ${name}`,
        });
      }
    }
  }

  return edges;
}
