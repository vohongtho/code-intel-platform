import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

export interface DeadCodeResult {
  nodeId: string;
  name: string;
  kind: string;
  filePath: string;
}

const DEAD_CODE_KINDS = new Set(['function', 'class', 'method', 'interface']);
const TEST_PATH_RE = /test|spec|__test/i;
const ENTRY_POINT_NAME_RE = /^(main|index|bootstrap|server|app)$/i;

/**
 * Detect dead code: exported symbols with zero callers AND zero importers.
 * Excludes: entry points (score >= 5 in flow phase), test files, @deprecated symbols.
 */
export function detectDeadCode(graph: KnowledgeGraph): DeadCodeResult[] {
  const results: DeadCodeResult[] = [];

  // Build set of entry-point node IDs (nodes that have flow nodes connected via step_of)
  const entryPointIds = new Set<string>();
  for (const edge of graph.findEdgesByKind('step_of')) {
    // step_of: source=flow/step → target=function/entry
    // The entry point is the target
    const targetNode = graph.getNode(edge.target);
    if (targetNode) entryPointIds.add(edge.target);
    // Also the source if it's the first step
    const sourceNode = graph.getNode(edge.source);
    if (sourceNode) entryPointIds.add(edge.source);
  }

  for (const node of graph.allNodes()) {
    // Only consider exported nodes in the target kinds
    if (!node.exported) continue;
    if (!DEAD_CODE_KINDS.has(node.kind)) continue;

    // Exclude test files
    if (TEST_PATH_RE.test(node.filePath)) continue;

    // Exclude deprecated
    const meta = node.metadata as Record<string, unknown> | undefined;
    if (meta?.deprecated === true) continue;

    // Exclude entry points by name
    if (ENTRY_POINT_NAME_RE.test(node.name)) continue;

    // Exclude entry points connected via step_of edges
    if (entryPointIds.has(node.id)) continue;

    // Check incoming calls edges
    let hasCallers = false;
    for (const edge of graph.findEdgesTo(node.id)) {
      if (edge.kind === 'calls') { hasCallers = true; break; }
    }
    if (hasCallers) continue;

    // Check incoming imports edges
    let hasImporters = false;
    for (const edge of graph.findEdgesTo(node.id)) {
      if (edge.kind === 'imports') { hasImporters = true; break; }
    }
    if (hasImporters) continue;

    // Mark on node metadata
    const health = ((node.metadata ?? {}) as Record<string, unknown>);
    const existingHealth = (health['health'] ?? {}) as Record<string, unknown>;
    node.metadata = {
      ...health,
      health: { ...existingHealth, deadCode: true },
    };

    results.push({
      nodeId: node.id,
      name: node.name,
      kind: node.kind,
      filePath: node.filePath,
    });
  }

  return results;
}
