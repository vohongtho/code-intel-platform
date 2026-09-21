import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { CodeNode } from '../shared/index.js';
import { resolveSymbolTarget } from '../cli/symbol-target.js';

export interface ContextSeedCandidate {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  startLine?: number;
}

export type ContextSeedResolution =
  | { requested: string; status: 'exact'; node: CodeNode }
  | { requested: string; status: 'ambiguous'; candidates: ContextSeedCandidate[] }
  | { requested: string; status: 'missing' };

function toCandidate(node: CodeNode): ContextSeedCandidate {
  return { id: node.id, name: node.name, kind: node.kind, filePath: node.filePath, startLine: node.startLine };
}

/**
 * Resolve one requested symbol name to exact/ambiguous/missing using the
 * shared canonical symbol selector — never silently picks a first candidate.
 */
export function resolveContextSeed(graph: KnowledgeGraph, requested: string): ContextSeedResolution {
  const resolution = resolveSymbolTarget(graph, requested);
  if (resolution.status === 'found') return { requested, status: 'exact', node: resolution.node };
  if (resolution.status === 'ambiguous') {
    return { requested, status: 'ambiguous', candidates: resolution.candidates.slice(0, 10).map(toCandidate) };
  }
  return { requested, status: 'missing' };
}

export function resolveContextSeeds(graph: KnowledgeGraph, requested: readonly string[]): ContextSeedResolution[] {
  return requested.map((symbol) => resolveContextSeed(graph, symbol));
}
