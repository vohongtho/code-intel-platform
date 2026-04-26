import type { CodeEdge } from '../shared/index.js';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { generateEdgeId } from '../graph/id-generator.js';

export function detectOverrides(graph: KnowledgeGraph): CodeEdge[] {
  const edges: CodeEdge[] = [];
  const methodsByOwner = new Map<string, Map<string, string>>();

  // Build owner → methods map
  for (const edge of graph.findEdgesByKind('has_member')) {
    const member = graph.getNode(edge.target);
    if (member && member.kind === 'method') {
      let methods = methodsByOwner.get(edge.source);
      if (!methods) {
        methods = new Map();
        methodsByOwner.set(edge.source, methods);
      }
      methods.set(member.name, member.id);
    }
  }

  // Check extends edges
  for (const extendsEdge of graph.findEdgesByKind('extends')) {
    const childMethods = methodsByOwner.get(extendsEdge.source);
    const parentMethods = methodsByOwner.get(extendsEdge.target);
    if (!childMethods || !parentMethods) continue;

    for (const [methodName, childMethodId] of childMethods) {
      const parentMethodId = parentMethods.get(methodName);
      if (parentMethodId) {
        edges.push({
          id: generateEdgeId(childMethodId, parentMethodId, 'overrides'),
          source: childMethodId,
          target: parentMethodId,
          kind: 'overrides',
          weight: 1.0,
          label: `overrides ${methodName}`,
        });
      }
    }
  }

  return edges;
}
