/**
 * taint/contracts.ts
 *
 * Versioned taint rule contracts. Rule matching is a plain case-sensitive
 * substring test against a statement's shallow primary-expression text
 * (e.g. a call's full text `getUserInput()`, or a read's raw text) — no
 * regex, so a bad rule can't become a ReDoS surface. Existing security
 * signals can seed these rules but a match here is heuristic evidence, not
 * a proven source-to-sink path (spec: certainty is capped accordingly).
 */
import type { ResolutionCertainty } from '../../resolution/contracts.js';

export interface TaintMatcher {
  id: string;
  textPattern: string;
}

export interface TaintRuleSet {
  version: string;
  sources: readonly TaintMatcher[];
  sinks: readonly TaintMatcher[];
  sanitizers: readonly TaintMatcher[];
}

export interface TaintFinding {
  id: string;
  sourceStatementId: string;
  sourceMatcherId: string;
  sinkStatementId: string;
  sinkMatcherId: string;
  /** The variable name observed carrying tainted data from source to sink. */
  variableName: string;
  /** Definition statement ids forming the propagation chain, source-most first. */
  propagationStatementIds: readonly string[];
  /** Sanitizer-matching statements found on a sibling reaching-definition of the same use at the sink (evidence that an alternate path was cleaned; does not itself suppress this finding). */
  sanitizedByStatementIds: readonly string[];
  /** Never exceeds the certainty of any call relationship the path crosses (this module is intraprocedural only, so always at most 'heuristic' — text-based matching, not semantic proof). */
  certainty: ResolutionCertainty;
}

export interface TaintAnalysisResult {
  version: string;
  functionId: string;
  findings: readonly TaintFinding[];
  truncated: boolean;
  reason?: string;
}

export const TAINT_VERSION = 'taint-v1';

export function matchesTaintText(text: string, matchers: readonly TaintMatcher[]): TaintMatcher | undefined {
  return matchers.find((matcher) => text.includes(matcher.textPattern));
}
