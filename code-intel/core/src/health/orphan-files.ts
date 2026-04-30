import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

export interface OrphanFileResult {
  nodeId: string;
  filePath: string;
}

// Exclude config files, test fixtures, declaration files, mock files
const EXCLUDE_RE = /\.(d\.ts|config\.[tj]s|fixture|mock)$/i;
const TEST_DIR_RE = /[/\\]test[/\\]|[/\\]tests[/\\]|[/\\]__tests__[/\\]/i;

/**
 * Detect orphan files: file nodes with no imports and no importers.
 * Excludes: config files, test fixtures, *.d.ts
 * Sets file.metadata.health.orphan = true on affected nodes.
 */
export function detectOrphanFiles(graph: KnowledgeGraph): OrphanFileResult[] {
  const results: OrphanFileResult[] = [];

  for (const node of graph.allNodes()) {
    if (node.kind !== 'file') continue;

    // Exclude declaration files, config files, fixtures, mocks
    if (EXCLUDE_RE.test(node.filePath)) continue;

    // Exclude test directories
    if (TEST_DIR_RE.test(node.filePath)) continue;

    // Check no outgoing imports edges
    let hasOutgoingImports = false;
    for (const edge of graph.findEdgesFrom(node.id)) {
      if (edge.kind === 'imports') { hasOutgoingImports = true; break; }
    }
    if (hasOutgoingImports) continue;

    // Check no incoming imports edges
    let hasIncomingImports = false;
    for (const edge of graph.findEdgesTo(node.id)) {
      if (edge.kind === 'imports') { hasIncomingImports = true; break; }
    }
    if (hasIncomingImports) continue;

    // Mark on node metadata
    const health = (node.metadata ?? {}) as Record<string, unknown>;
    const existingHealth = (health['health'] ?? {}) as Record<string, unknown>;
    node.metadata = {
      ...health,
      health: { ...existingHealth, orphan: true },
    };

    results.push({
      nodeId: node.id,
      filePath: node.filePath,
    });
  }

  return results;
}
