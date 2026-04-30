import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

export interface GodNodeResult {
  nodeId: string;
  name: string;
  kind: string;
  filePath: string;
  reason: string;
}

export interface GodNodeConfig {
  maxMethods?: number; // default: 20
  maxCallers?: number; // default: 50
}

/**
 * Detect god classes: classes with > maxMethods methods OR > maxCallers callers.
 * Sets metadata.health.isGodNode = true, metadata.health.godReason on affected nodes.
 */
export function detectGodNodes(graph: KnowledgeGraph, config?: GodNodeConfig): GodNodeResult[] {
  const maxMethods = config?.maxMethods ?? 20;
  const maxCallers = config?.maxCallers ?? 50;

  const results: GodNodeResult[] = [];

  for (const node of graph.allNodes()) {
    if (node.kind !== 'class') continue;

    // Count methods (outgoing has_member edges pointing to method nodes)
    let methodCount = 0;
    for (const edge of graph.findEdgesFrom(node.id)) {
      if (edge.kind === 'has_member') {
        const member = graph.getNode(edge.target);
        if (member && (member.kind === 'method' || member.kind === 'constructor')) {
          methodCount++;
        }
      }
    }

    // Count callers (incoming calls edges)
    let callerCount = 0;
    for (const edge of graph.findEdgesTo(node.id)) {
      if (edge.kind === 'calls') callerCount++;
    }

    const isTooManyMethods = methodCount > maxMethods;
    const isTooManyCallers = callerCount > maxCallers;

    if (!isTooManyMethods && !isTooManyCallers) continue;

    const reasons: string[] = [];
    if (isTooManyMethods) reasons.push(`${methodCount} methods (limit: ${maxMethods})`);
    if (isTooManyCallers) reasons.push(`${callerCount} callers (limit: ${maxCallers})`);
    const reason = reasons.join(', ');

    // Mark on node metadata
    const health = (node.metadata ?? {}) as Record<string, unknown>;
    const existingHealth = (health['health'] ?? {}) as Record<string, unknown>;
    node.metadata = {
      ...health,
      health: { ...existingHealth, isGodNode: true, godReason: reason },
    };

    results.push({
      nodeId: node.id,
      name: node.name,
      kind: node.kind,
      filePath: node.filePath,
      reason,
    });
  }

  return results;
}
