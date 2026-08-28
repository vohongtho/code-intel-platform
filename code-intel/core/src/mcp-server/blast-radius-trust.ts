import { createEvidenceStore } from '../evidence/store.js';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { AnalysisBoundary, AnalysisCoverage } from '../shared/index.js';
import { emptyTrust } from '../query/trust.js';

export interface BlastRadiusAffectedNode {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  depth: number;
}

export interface BlastRadiusTrustSummary {
  certainty: 'exact' | 'lower-bound' | 'heuristic';
  coverage: AnalysisCoverage;
  boundaries: readonly AnalysisBoundary[];
}

export interface BlastRadiusResultWithTrust {
  target: string;
  affectedCount: number;
  riskLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  affected: BlastRadiusAffectedNode[];
  trust: BlastRadiusTrustSummary;
}

function mergeCoverage(items: AnalysisCoverage[]): AnalysisCoverage {
  return {
    complete: items.every((item) => item.complete),
    examinedCount: items.reduce((sum, item) => sum + item.examinedCount, 0),
    totalKnownCount: items.reduce<number | undefined>((sum, item) => {
      if (sum == null && item.totalKnownCount == null) return undefined;
      return (sum ?? 0) + (item.totalKnownCount ?? 0);
    }, undefined),
    incompleteReasons: [...new Set(items.flatMap((item) => item.incompleteReasons))].sort(),
  };
}

function certaintyRank(value: string | undefined): number {
  switch (value) {
    case 'exact': return 3;
    case 'candidate': return 2;
    case 'heuristic': return 1;
    default: return 0;
  }
}

export function computeBlastRadiusWithTrust(args: {
  graph: KnowledgeGraph;
  targetId: string;
  targetName: string;
  direction: 'callers' | 'callees' | 'both';
  maxHops: number;
  repoDir?: string;
}): BlastRadiusResultWithTrust {
  const { graph, targetId, targetName, direction, maxHops, repoDir } = args;
  const affected = new Map<string, number>();
  const queue: Array<{ id: string; depth: number }> = [{ id: targetId, depth: 0 }];
  const visited = new Set<string>();
  const coverages: AnalysisCoverage[] = [];
  const boundaries = new Map<string, AnalysisBoundary>();
  let weakestRank = 3;

  const store = repoDir ? createEvidenceStore(repoDir) : null;
  try {
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id) || depth > maxHops) continue;
      visited.add(id);
      affected.set(id, Math.min(affected.get(id) ?? depth, depth));

      const examineEdge = (edge: ReturnType<KnowledgeGraph['findEdgesFrom']> extends Iterable<infer T> ? T : never, nextId: string) => {
        if (edge.kind !== 'calls' && edge.kind !== 'imports') return;
        queue.push({ id: nextId, depth: depth + 1 });
        weakestRank = Math.min(weakestRank, certaintyRank(edge.certainty));
        if (store && edge.evidenceRef) {
          const record = store.get(edge.evidenceRef);
          if (record?.coverage) coverages.push(record.coverage);
          for (const boundary of record?.boundaries ?? []) boundaries.set(JSON.stringify(boundary), boundary);
        } else if (edge.certainty && edge.certainty !== 'exact') {
          coverages.push({ complete: false, examinedCount: 1, incompleteReasons: [edge.certainty] });
        }
      };

      if (direction === 'callers' || direction === 'both') {
        for (const edge of graph.findEdgesTo(id)) examineEdge(edge, edge.source);
      }
      if (direction === 'callees' || direction === 'both') {
        for (const edge of graph.findEdgesFrom(id)) examineEdge(edge, edge.target);
      }
    }
  } finally {
    store?.close();
  }

  const affectedDetails = [...affected.entries()].map(([id, depth]) => {
    const node = graph.getNode(id);
    return node
      ? { id, name: node.name, kind: node.kind, filePath: node.filePath, depth }
      : { id, name: id, kind: 'unknown', filePath: '', depth };
  });

  const traversedEdgeCount = Math.max(0, affectedDetails.length - 1);
  const empty = traversedEdgeCount === 0 ? emptyTrust() : null;
  const coverage = coverages.length > 0
    ? mergeCoverage(coverages)
    : empty?.coverage ?? { complete: true, examinedCount: traversedEdgeCount, totalKnownCount: traversedEdgeCount, incompleteReasons: [] };

  const certainty: BlastRadiusTrustSummary['certainty'] = empty
    ? empty.certainty === 'exact'
      ? 'exact'
      : 'lower-bound'
    : !coverage.complete
      ? 'lower-bound'
      : weakestRank >= 3
        ? 'exact'
        : 'heuristic';

  const count = affectedDetails.length;
  const riskLevel: BlastRadiusResultWithTrust['riskLevel'] = empty || !coverage.complete
    ? 'UNKNOWN'
    : count > 10
      ? 'HIGH'
      : count > 5
        ? 'MEDIUM'
        : 'LOW';

  return {
    target: targetName,
    affectedCount: count,
    riskLevel,
    affected: affectedDetails,
    trust: {
      certainty,
      coverage,
      boundaries: [...boundaries.values()],
    },
  };
}
