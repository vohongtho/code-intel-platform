/**
 * taint/contracts.ts
 *
 * Versioned taint contracts. Sources/sinks/sanitizers come from declarative
 * models (model-schema.ts, merged by model-registry.ts); the legacy
 * `TaintRuleSet` — a plain case-sensitive substring test against a
 * statement's shallow primary-expression text — is still accepted and is
 * adapted into a `literal-call-pattern` model with text-fallback evidence.
 * No matcher is a regex, so a bad rule can't become a ReDoS surface.
 *
 * Every match is statement-level evidence (callee/access-path syntax or
 * text), never a resolved symbol identity, so findings stay at most
 * `heuristic` certainty; a path that crosses a call boundary is further
 * bounded by the weakest call/dispatch relationship it used. A finding is
 * a candidate source-to-sink path, not proof of exploitability.
 */
import type { ResolutionCertainty } from '../../resolution/contracts.js';
import type { TaintCategory, TaintMatchStrength } from './model-schema.js';

export interface TaintMatcher {
  id: string;
  textPattern: string;
}

/** Legacy text rule set; adapted via `legacyRuleSetToModel` (model-registry.ts). */
export interface TaintRuleSet {
  version: string;
  sources: readonly TaintMatcher[];
  sinks: readonly TaintMatcher[];
  sanitizers: readonly TaintMatcher[];
}

/** One call boundary an interprocedural finding crossed, caller-most first. */
export interface TaintCallHop {
  callerFunctionId: string;
  callStatementId: string;
  calleeFunctionId: string;
  /** Persisted call/dispatch relationship certainty the hop relied on. */
  callCertainty: ResolutionCertainty;
  /** Whether the call's candidate set was complete (false: other runtime targets may exist). */
  callComplete: boolean;
  strategy?: string;
  /** `argument:<i>->parameter:<j>` or `return` — how the value crossed. */
  transfer: string;
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
  /** Bounded by matcher evidence (statement-level: at most 'heuristic') and by every call relationship the path crosses. */
  certainty: ResolutionCertainty;
  sourceModelId?: string;
  sinkModelId?: string;
  sinkCategory?: TaintCategory;
  sourceMatchStrength?: TaintMatchStrength;
  sinkMatchStrength?: TaintMatchStrength;
  /** Function owning the source statement when it differs from the analyzed function (taint entered through a callee's return). */
  sourceFunctionId?: string;
  /** Function owning the sink statement when it differs from the analyzed function (sink reached inside a callee). */
  sinkFunctionId?: string;
  /** Present (non-empty) only for interprocedural findings. */
  hops?: readonly TaintCallHop[];
  /** 1-based source lines (in the owning function's file) for display; absent when unknown. */
  sourceLine?: number;
  sinkLine?: number;
  propagationLines?: readonly number[];
}

export interface TaintAnalysisResult {
  version: string;
  functionId: string;
  findings: readonly TaintFinding[];
  truncated: boolean;
  reason?: string;
  /** Fingerprint of the model registry these findings were computed under. */
  modelFingerprint?: string;
  /** Context-dependent matchers (framework-input/annotation) that could not be evaluated for this function — coverage, not absence. */
  unevaluatedMatcherRefs?: readonly string[];
  /** Interprocedural/coverage boundaries hit while analyzing (sorted, deduplicated). */
  boundaries?: readonly string[];
}

export const TAINT_VERSION = 'taint-v2';

/** Legacy helper: first matcher whose text pattern is a substring of `text`. */
export function matchesTaintText(text: string, matchers: readonly TaintMatcher[]): TaintMatcher | undefined {
  return matchers.find((matcher) => text.includes(matcher.textPattern));
}

export const TAINT_SUMMARY_VERSION = 'taint-summary-v1';

/** "Tainted parameter `parameterIndex` reaches a sink inside this function (or, through `hops`, inside one of its callees)." */
export interface TaintSummarySink {
  parameterIndex: number;
  sinkMatcherId: string;
  sinkModelId?: string;
  category?: TaintCategory;
  sinkStatementId: string;
  sinkFunctionId: string;
  sinkLine?: number;
  certainty: ResolutionCertainty;
  hops: readonly TaintCallHop[];
}

/** "This function's return value carries data from a source" — a callee-internal source the caller inherits. */
export interface TaintSummaryReturnSource {
  sourceMatcherId: string;
  sourceModelId?: string;
  sourceStatementId: string;
  sourceFunctionId: string;
  sourceLine?: number;
  strength?: TaintMatchStrength;
  certainty: ResolutionCertainty;
  hops: readonly TaintCallHop[];
}

/**
 * Per-function taint transfer facts, keyed (as a cache artifact) by
 * canonical function id + body hash + program-analysis fingerprint (which
 * includes the model fingerprint). Under-approximates on purpose: an
 * absent entry means "not confirmed", never "proven clean".
 */
export interface TaintFunctionSummary {
  version: string;
  functionId: string;
  modelFingerprint: string;
  parameterNames: readonly string[];
  /** Parameter indexes whose (unsanitized) value reaches a `return`. */
  taintedParameterToReturn: readonly number[];
  taintedParameterToSink: readonly TaintSummarySink[];
  returnSources: readonly TaintSummaryReturnSource[];
  /** Parameter indexes whose value is fully sanitized before every return it reaches. */
  sanitizingParameterEffects?: readonly number[];
  boundaries: readonly string[];
  truncated: boolean;
  reason?: string;
}

/** One possible target of a call site, as persisted in the semantic graph. */
export interface TaintCallee {
  functionId: string;
  certainty: ResolutionCertainty;
  complete: boolean;
  strategy?: string;
  /** Absent when the callee could not be analyzed (unsupported language, depth/budget cap, recursion) — see `boundary`. */
  summary?: TaintFunctionSummary;
  boundary?: string;
}

export interface TaintCallResolution {
  callees: readonly TaintCallee[];
  /** Why no (or not every) target could be followed, e.g. `unresolved-call`, `gated: semantic graph is not trusted`. */
  boundary?: string;
}

/** Supplied by the interprocedural driver; the intraprocedural engine never resolves calls itself. */
export type TaintCallResolver = (call: { statementId: string; callText: string }) => TaintCallResolution;
