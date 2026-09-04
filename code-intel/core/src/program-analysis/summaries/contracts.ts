/**
 * summaries/contracts.ts
 *
 * A function summary: the reusable, per-function facts other analyses
 * (PDG, taint, cross-function callers) consume instead of re-walking a
 * function's full IR/CFG/dataflow every time. Identity is the artifact id
 * from `generateProgramAnalysisArtifactId` (canonical function id + body
 * hash + program-analysis fingerprint) — see program-analysis/contracts.ts.
 */
import type { ProgramAnalysisFingerprint } from '../contracts.js';

export const FUNCTION_SUMMARY_VERSION = 'function-summary-v1';

export interface ParameterInfluence {
  parameterName: string;
  /** `return` statement ids whose returned value traces (directly, or through a bounded chain of simple name-to-name assignments) back to this parameter. Under-approximates on purpose: a missing entry is "not confirmed", never a claim that no influence exists. */
  influencesReturnAtStatementIds: readonly string[];
}

export interface VariableAccess {
  variableName: string;
  readAtStatementIds: readonly string[];
  writeAtStatementIds: readonly string[];
}

export interface CalledCallee {
  /** Raw call-expression text (e.g. `foo(x, y)`), not yet resolved to a canonical callee — the call graph/resolver owns that resolution and its certainty. */
  calleeText: string;
  statementIds: readonly string[];
}

export interface FunctionSummary {
  version: string;
  functionId: string;
  bodyHash: string;
  fingerprint: ProgramAnalysisFingerprint;
  parameterInfluence: readonly ParameterInfluence[];
  localAccesses: readonly VariableAccess[];
  /** Statement ids of member/index-target writes — heap/alias territory (see dataflow/reaching-definitions.ts), listed but not attributed to a specific field. */
  boundaryWriteStatementIds: readonly string[];
  calledCallees: readonly CalledCallee[];
  /** Statement ids where a use could not be structurally resolved (propagated from `DefUseChains`); conclusions elsewhere should not assume completeness where these appear. */
  unresolvedUseStatementIds: readonly string[];
  truncated: boolean;
  reason?: string;
}
