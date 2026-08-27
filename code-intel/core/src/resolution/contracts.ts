export type ResolutionCertainty =
  | 'exact'
  | 'candidate-set'
  | 'heuristic'
  | 'unresolved'
  | 'external-boundary'
  | 'truncated';

export interface ResolutionCandidate {
  targetId: string;
  confidence: number;
  strategy: string;
  evidenceRefs: readonly string[];
}

export interface ResolutionCoverage {
  complete: boolean;
  totalKnownCandidates?: number;
  emittedCandidates: number;
  incompleteReasons: readonly string[];
}

export interface ResolutionOutcome {
  referenceId: string;
  certainty: ResolutionCertainty;
  candidates: readonly ResolutionCandidate[];
  coverage: ResolutionCoverage;
  boundary?: string;
  resolverVersion: string;
}

export const RESOLVER_VERSION = 'evidence-based-v1';

function candidateSortKey(candidate: ResolutionCandidate): readonly [number, number, string, string, string] {
  return [
    Number.isFinite(candidate.confidence) ? -candidate.confidence : 1,
    -candidate.evidenceRefs.length,
    candidate.strategy,
    candidate.targetId,
    candidate.evidenceRefs.join('\u0000'),
  ];
}

export function compareResolutionCandidates(left: ResolutionCandidate, right: ResolutionCandidate): number {
  const leftKey = candidateSortKey(left);
  const rightKey = candidateSortKey(right);
  for (let i = 0; i < leftKey.length; i += 1) {
    if (leftKey[i]! < rightKey[i]!) return -1;
    if (leftKey[i]! > rightKey[i]!) return 1;
  }
  return 0;
}

export function orderResolutionCandidates(candidates: readonly ResolutionCandidate[]): ResolutionCandidate[] {
  return [...candidates].sort(compareResolutionCandidates);
}

export function createResolutionOutcome(input: ResolutionOutcome): ResolutionOutcome {
  return {
    ...input,
    resolverVersion: input.resolverVersion || RESOLVER_VERSION,
    candidates: orderResolutionCandidates(input.candidates),
    coverage: {
      ...input.coverage,
      incompleteReasons: [...input.coverage.incompleteReasons].sort(),
    },
  };
}
