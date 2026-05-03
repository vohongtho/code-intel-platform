import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

export interface ExplainRelationshipResult {
  paths: Array<{ hops: number; nodes: string[]; edgeKind: string }>;
  sharedImports: string[];
  heritage: string | null;
  summary: string;
}

export function explainRelationship(
  graph: KnowledgeGraph,
  from: string,
  to: string,
): ExplainRelationshipResult | { error: string; suggestions: string[] } {
  const allNodes = [...graph.allNodes()];

  const fromNode = allNodes.find((n) => n.name === from);
  if (!fromNode) {
    const firstChar = from[0]?.toLowerCase() ?? '';
    const fromLower = from.toLowerCase();
    const suggestions = allNodes
      .filter((n) => n.name.toLowerCase().startsWith(firstChar) || n.name.toLowerCase().includes(fromLower))
      .slice(0, 5)
      .map((n) => n.name);
    return { error: `Symbol not found: ${from}`, suggestions };
  }

  const toNode = allNodes.find((n) => n.name === to);
  if (!toNode) {
    const firstChar = to[0]?.toLowerCase() ?? '';
    const toLower = to.toLowerCase();
    const suggestions = allNodes
      .filter((n) => n.name.toLowerCase().startsWith(firstChar) || n.name.toLowerCase().includes(toLower))
      .slice(0, 5)
      .map((n) => n.name);
    return { error: `Symbol not found: ${to}`, suggestions };
  }

  // BFS: find all directed paths from `from` → `to`, max 5 hops, up to 10 paths
  const paths: Array<{ hops: number; nodes: string[]; edgeKind: string }> = [];

  type QueueEntry = { id: string; nodeNames: string[]; lastEdgeKind: string; visited: Set<string> };
  const queue: QueueEntry[] = [{
    id: fromNode.id,
    nodeNames: [fromNode.name],
    lastEdgeKind: '',
    visited: new Set([fromNode.id]),
  }];

  while (queue.length > 0 && paths.length < 10) {
    const entry = queue.shift()!;
    const { id, nodeNames, visited } = entry;

    // nodeNames.length - 1 = number of hops so far; max 5 hops means max 6 nodes
    if (nodeNames.length > 6) continue;

    for (const edge of graph.findEdgesFrom(id)) {
      const targetNode = graph.getNode(edge.target);
      if (!targetNode) continue;

      // Avoid cycles in this path
      if (visited.has(edge.target)) continue;

      const newNames = [...nodeNames, targetNode.name];

      if (edge.target === toNode.id) {
        paths.push({ hops: newNames.length - 1, nodes: newNames, edgeKind: edge.kind });
        if (paths.length >= 10) break;
        // Don't continue BFS from the destination
        continue;
      }

      if (newNames.length < 6) {
        const newVisited = new Set(visited);
        newVisited.add(edge.target);
        queue.push({ id: edge.target, nodeNames: newNames, lastEdgeKind: edge.kind, visited: newVisited });
      }
    }
  }

  // Shared imports: nodes that both `from` and `to` have outgoing `imports` edges to
  const fromImports = new Set<string>();
  for (const edge of graph.findEdgesFrom(fromNode.id)) {
    if (edge.kind === 'imports') fromImports.add(edge.target);
  }

  const sharedImportIds: string[] = [];
  for (const edge of graph.findEdgesFrom(toNode.id)) {
    if (edge.kind === 'imports' && fromImports.has(edge.target)) {
      sharedImportIds.push(edge.target);
    }
  }

  const sharedImports = sharedImportIds
    .map((id) => graph.getNode(id)?.name ?? id);

  // Heritage: check extends/implements edges in both directions
  let heritage: string | null = null;
  for (const edge of graph.findEdgesFrom(fromNode.id)) {
    if ((edge.kind === 'extends' || edge.kind === 'implements') && edge.target === toNode.id) {
      heritage = `${from} ${edge.kind} ${to}`;
      break;
    }
  }
  if (!heritage) {
    for (const edge of graph.findEdgesFrom(toNode.id)) {
      if ((edge.kind === 'extends' || edge.kind === 'implements') && edge.target === fromNode.id) {
        heritage = `${to} ${edge.kind} ${from}`;
        break;
      }
    }
  }

  // Summary
  const sharedStr = sharedImports.length > 0 ? sharedImports.join(', ') : 'none';
  const heritageStr = heritage ?? 'none';
  const connectionStr = paths.length === 0 ? 'No connection found.' : `${from} → ${to} via ${paths.length} path(s).`;
  const summary = `${connectionStr} Shared imports: [${sharedStr}]. Heritage: ${heritageStr}.`;

  return { paths, sharedImports, heritage, summary };
}
