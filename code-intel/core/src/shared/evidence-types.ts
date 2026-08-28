export const RELATIONSHIP_CERTAINTIES = ['exact', 'candidate', 'heuristic'] as const;
export type RelationshipCertainty = (typeof RELATIONSHIP_CERTAINTIES)[number];

export const ANALYSIS_CERTAINTIES = [
  'exact',
  'lower-bound',
  'heuristic',
  'truncated',
  'unavailable',
] as const;
export type AnalysisCertainty = (typeof ANALYSIS_CERTAINTIES)[number];

export const ANALYSIS_BOUNDARY_KINDS = [
  'external-library',
  'dynamic-dispatch',
  'unresolved-receiver',
  'ambiguous-target',
  'analysis-limit',
  'stale-index',
  'unavailable-index',
  'legacy-resolver',
  'unsupported-semantics',
] as const;
export type AnalysisBoundaryKind = (typeof ANALYSIS_BOUNDARY_KINDS)[number];

export interface RelationshipTrust {
  callSiteId?: string;
  confidence: number;
  certainty: RelationshipCertainty;
  strategy: string;
  resolverVersion: string;
  evidenceRef?: string;
  ambiguous: boolean;
}

export interface AnalysisCoverage {
  complete: boolean;
  examinedCount: number;
  totalKnownCount?: number;
  incompleteReasons: readonly string[];
}

export interface AnalysisBoundary {
  kind: AnalysisBoundaryKind;
  evidenceRefs: readonly string[];
}
