/**
 * limits.ts
 *
 * Resource budgets shared by every program-analysis worklist algorithm
 * (CFG construction, dominators, reaching definitions, PDG assembly, taint
 * propagation). Hitting any budget must surface as `truncated: true` with a
 * reason, never as a silently-complete result (spec: "Resource limits MUST
 * produce truncated status").
 */

export interface ProgramAnalysisLimits {
  maxStatementsPerFunction: number;
  maxBlocksPerFunction: number;
  maxWorklistIterations: number;
  /** Interprocedural call-chain depth for future cross-function summary following — unused by this foundation, which is intraprocedural only. */
  maxCallSummaryDepth: number;
  /** Intraprocedural name-to-name assignment chain depth for tracing "does this value come from a source/parameter" (summaries/build.ts, taint/build.ts). */
  maxIntraproceduralChainDepth: number;
  maxAnalyzedFunctionsPerRequest: number;
  maxAnalysisTimeMsPerFunction: number;
  maxAnalysisTimeMsPerRequest: number;
  maxArtifactBytes: number;
}

export const DEFAULT_PROGRAM_ANALYSIS_LIMITS: ProgramAnalysisLimits = {
  maxStatementsPerFunction: 4000,
  maxBlocksPerFunction: 1000,
  maxWorklistIterations: 10000,
  maxCallSummaryDepth: 6,
  maxIntraproceduralChainDepth: 32,
  maxAnalyzedFunctionsPerRequest: 500,
  maxAnalysisTimeMsPerFunction: 2000,
  maxAnalysisTimeMsPerRequest: 30000,
  maxArtifactBytes: 5 * 1024 * 1024,
};

export interface TruncatableOutcome {
  truncated: boolean;
  reason?: string;
}

export function truncatedOutcome(reason: string): TruncatableOutcome {
  return { truncated: true, reason };
}

export function completeOutcome(): TruncatableOutcome {
  return { truncated: false };
}

/** Deadline helper for algorithms that must bail out after a wall-clock budget rather than iterate indefinitely. */
export interface AnalysisDeadline {
  startedAtMs: number;
  budgetMs: number;
}

export function startDeadline(budgetMs: number): AnalysisDeadline {
  return { startedAtMs: Date.now(), budgetMs };
}

export function isDeadlineExceeded(deadline: AnalysisDeadline): boolean {
  return Date.now() - deadline.startedAtMs >= deadline.budgetMs;
}
