export type RequestedSearchMode = 'auto' | 'bm25' | 'vector';
export type ActualSearchMode = 'bm25' | 'vector' | 'hybrid';
export type SearchFallbackReason = 'VECTOR_INDEX_UNAVAILABLE' | 'VECTOR_QUERY_FAILED';

export interface SearchScoreEvidence {
  lexicalScore?: number;
  vectorScore?: number;
  lexicalRank?: number;
  vectorRank?: number;
  lexicalContribution?: number;
  vectorContribution?: number;
  finalScore: number;
}

export interface SearchExecutionExplanation {
  requestedMode: RequestedSearchMode;
  actualMode: ActualSearchMode;
  fallbackReason?: SearchFallbackReason;
  vectorReady: boolean;
  ranking: 'BM25' | 'VECTOR' | 'RECIPROCAL_RANK_FUSION';
  summary: string;
}

export interface V108SearchResponse<T = unknown> {
  results: Array<T & { scoreEvidence?: SearchScoreEvidence }>;
  requestedMode: RequestedSearchMode;
  actualMode: ActualSearchMode;
  /** Backward-compatible alias of actualMode. */
  searchMode: ActualSearchMode;
  fallbackReason?: SearchFallbackReason;
  explanation?: SearchExecutionExplanation;
  vectorReady: boolean;
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface ChangeContextRequest {
  changedFiles?: string[];
  diff?: string;
  maxHops?: number;
  maxTokens?: number;
  maxChangedSymbols?: number;
}

export interface AnalysisCoverage {
  complete: boolean;
  examinedCount: number;
  totalKnownCount?: number;
  incompleteReasons: readonly string[];
}

export interface AnalysisBoundary {
  kind: string;
  evidenceRefs: readonly string[];
}

export interface ChangeContextSummary {
  changedSymbolCount: number;
  impactedSymbolCount: number;
  coverageGapCount: number;
  highestRisk: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' | 'NONE';
}

export interface ChangeContextResponse {
  changedFiles: string[];
  impact: unknown;
  context: {
    summary: string;
    logic: string;
    relation: string;
    focusCode: string;
    maxTokens?: number;
    truncated: boolean;
    truncatedBlocks?: string[];
    blockTokens?: { summary: number; logic: number; relation: number; focusCode: number; total: number };
  };
  testSuggestions: Array<{ symbol: string; result: unknown }>;
  summary: ChangeContextSummary;
  certainty?: 'exact' | 'lower-bound' | 'heuristic' | 'truncated' | 'unavailable';
  coverage?: AnalysisCoverage;
  boundaries?: readonly AnalysisBoundary[];
}

export interface IndexTrustResponse {
  state: 'ready' | 'stale' | 'corrupt' | 'missing' | 'legacy';
  reasons: string[];
  artifacts: unknown[];
}
