import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { AnalysisCertainty, AnalysisCoverage } from '../shared/index.js';

export interface DeadCodeResult {
  nodeId: string;
  name: string;
  kind: string;
  filePath: string;
  status: 'not-observed' | 'proved-unused';
  certainty: AnalysisCertainty;
  coverage: AnalysisCoverage;
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

  const entryPointIds = new Set<string>();
  for (const edge of graph.findEdgesByKind('step_of')) {
    const targetNode = graph.getNode(edge.target);
    if (targetNode) entryPointIds.add(edge.target);
    const sourceNode = graph.getNode(edge.source);
    if (sourceNode) entryPointIds.add(edge.source);
  }

  for (const node of graph.allNodes()) {
    if (!node.exported) continue;
    if (!DEAD_CODE_KINDS.has(node.kind)) continue;
    if (TEST_PATH_RE.test(node.filePath)) continue;

    const meta = node.metadata as Record<string, unknown> | undefined;
    if (meta?.deprecated === true) continue;
    if (ENTRY_POINT_NAME_RE.test(node.name)) continue;
    if (entryPointIds.has(node.id)) continue;

    let hasCallers = false;
    for (const edge of graph.findEdgesTo(node.id)) {
      if (edge.kind === 'calls') { hasCallers = true; break; }
    }
    if (hasCallers) continue;

    let hasImporters = false;
    for (const edge of graph.findEdgesTo(node.id)) {
      if (edge.kind === 'imports') { hasImporters = true; break; }
    }
    if (hasImporters) continue;

    const health = ((node.metadata ?? {}) as Record<string, unknown>);
    const existingHealth = (health['health'] ?? {}) as Record<string, unknown>;
    node.metadata = {
      ...health,
      health: { ...existingHealth, deadCode: true, deadCodeStatus: 'not-observed' },
    };

    results.push({
      nodeId: node.id,
      name: node.name,
      kind: node.kind,
      filePath: node.filePath,
      status: 'not-observed',
      certainty: 'lower-bound',
      coverage: {
        complete: false,
        examinedCount: 0,
        totalKnownCount: 0,
        incompleteReasons: ['absence-not-proof'],
      },
    });
  }

  return results;
}
