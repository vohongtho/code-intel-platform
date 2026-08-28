import { createEvidenceStore } from '../evidence/store.js';
import type { AnalysisBoundary, AnalysisCertainty, AnalysisCoverage, CodeEdge } from '../shared/index.js';

export interface TrustSummary {
  certainty: AnalysisCertainty;
  coverage: AnalysisCoverage;
  boundaries: readonly AnalysisBoundary[];
}

export interface ExactEmptyProofOptions {
  exact?: boolean;
  unavailable?: boolean;
  boundaryKind?: AnalysisBoundary['kind'];
  reason?: string;
}

export function mergeCoverage(values: Array<AnalysisCoverage | undefined>): AnalysisCoverage | undefined {
  const present = values.filter(Boolean) as AnalysisCoverage[];
  if (present.length === 0) return undefined;
  return {
    complete: present.every((item) => item.complete),
    examinedCount: present.reduce((sum, item) => sum + item.examinedCount, 0),
    totalKnownCount: present.reduce<number | undefined>((sum, item) => {
      if (sum == null && item.totalKnownCount == null) return undefined;
      return (sum ?? 0) + (item.totalKnownCount ?? 0);
    }, undefined),
    incompleteReasons: [...new Set(present.flatMap((item) => item.incompleteReasons))].sort(),
  };
}

export function mergeBoundaries(values: Array<readonly AnalysisBoundary[] | undefined>): readonly AnalysisBoundary[] {
  return [...new Map(values.flatMap((items) => (items ?? []).map((item) => [JSON.stringify(item), item]))).values()];
}

export function loadEdgeEvidence(repoDir: string | undefined, evidenceRef: string | undefined): { coverage?: AnalysisCoverage; boundaries?: readonly AnalysisBoundary[] } {
  if (!repoDir || !evidenceRef) return {};
  const store = createEvidenceStore(repoDir);
  try {
    const record = store.get(evidenceRef);
    return {
      coverage: record?.coverage,
      boundaries: record?.boundaries,
    };
  } finally {
    store.close();
  }
}

function relationshipRank(value: CodeEdge['certainty'] | undefined): number {
  switch (value) {
    case 'exact': return 3;
    case 'candidate': return 2;
    case 'heuristic': return 1;
    default: return 0;
  }
}

export function emptyTrust(options?: ExactEmptyProofOptions): TrustSummary {
  const exact = options?.exact ?? false;
  const unavailable = options?.unavailable ?? false;
  const reason = options?.reason ?? (unavailable ? 'unavailable-index' : exact ? 'exact-empty-proof' : 'absence-not-proof');
  const boundaryKind = options?.boundaryKind;
  return {
    certainty: unavailable ? 'unavailable' : exact ? 'exact' : 'lower-bound',
    coverage: {
      complete: exact,
      examinedCount: 0,
      totalKnownCount: 0,
      incompleteReasons: exact ? [] : [reason],
    },
    boundaries: boundaryKind ? [{ kind: boundaryKind, evidenceRefs: [] }] : [],
  };
}

export function summarizeEdgeTrust(edges: CodeEdge[], repoDir?: string, options?: { truncated?: boolean; emptyProof?: ExactEmptyProofOptions }): TrustSummary {
  if (edges.length === 0) return emptyTrust(options?.emptyProof);
  const edgeEvidence = edges.map((edge) => loadEdgeEvidence(repoDir, edge.evidenceRef));
  const coverage = mergeCoverage(edgeEvidence.map((item) => item.coverage))
    ?? {
      complete: !options?.truncated,
      examinedCount: edges.length,
      totalKnownCount: edges.length,
      incompleteReasons: options?.truncated ? ['analysis-limit'] : [],
    };
  const boundaries = mergeBoundaries(edgeEvidence.map((item) => item.boundaries));
  const weakest = edges.reduce((min, edge) => Math.min(min, relationshipRank(edge.certainty)), 3);
  const certainty: AnalysisCertainty = options?.truncated
    ? 'truncated'
    : !coverage.complete
      ? 'lower-bound'
      : weakest >= 3
        ? 'exact'
        : weakest >= 1
          ? 'heuristic'
          : 'unavailable';
  return { certainty, coverage, boundaries };
}

export function riskFromCount(count: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (count > 50) return 'HIGH';
  if (count >= 10) return 'MEDIUM';
  return 'LOW';
}
