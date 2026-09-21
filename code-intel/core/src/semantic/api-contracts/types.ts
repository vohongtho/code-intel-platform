import type { Language } from '../../shared/languages.js';
import type { SourceRange } from '../anchors.js';
import type { FrameworkEvidenceFact, TypeReferenceFact } from '../facts.js';
import type { ResolutionOutcome } from '../../resolution/contracts.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type HttpMethodOrAny = HttpMethod | 'ANY';

/** Bumped whenever HttpRouteFact/HttpRequestShapeFact/HttpResponseShapeFact/HttpConsumerFact
 * or their graph projection change shape. A generation stamped with an older/incompatible
 * version must degrade explicitly (see analysis-plan.ts#hasSemanticFingerprintMismatch)
 * rather than silently reusing stale or malformed API-contract data. */
export const API_CONTRACT_SCHEMA_VERSION = '1.0.11';

/**
 * Mirrors `FactBase` from semantic/facts.ts structurally (duplicated, not imported) so
 * facts.ts can import these types to extend `SemanticFact` without a runtime import cycle
 * and without exporting facts.ts's private FactBase.
 */
interface HttpFactBase {
  factId: string;
  language: Language;
  filePath: string;
  sourceRange: SourceRange;
  frameworkEvidence?: FrameworkEvidenceFact;
}

export type ApiCertainty = 'exact' | 'candidate' | 'heuristic' | 'unknown';

export type ApiBoundaryReason =
  | 'dynamic-path-segment'
  | 'dynamic-url-expression'
  | 'unresolved-dto'
  | 'unresolved-response-shape'
  | 'reflection-registration'
  | 'candidate-cap-exceeded'
  | 'unsupported-framework-construct'
  | 'local-data-flow-exceeded'
  | 'analysis-truncated';

export interface ApiCoverage {
  complete: boolean;
  boundaryReasons: readonly ApiBoundaryReason[];
}

export function fullApiCoverage(): ApiCoverage {
  return { complete: true, boundaryReasons: [] };
}

export function partialApiCoverage(reasons: readonly ApiBoundaryReason[]): ApiCoverage {
  return { complete: false, boundaryReasons: [...reasons].sort() };
}

export interface HttpShapeFieldFact {
  key: string;
  required?: boolean;
  type?: TypeReferenceFact;
  nested?: readonly HttpShapeFieldFact[];
}

/**
 * A request/response shape is either a reference to a named/canonical symbol (preferred,
 * most durable across renames of unrelated fields), a set of statically observed inline
 * fields, or explicitly unknown (never fabricated).
 */
export type HttpShapeOrigin =
  | { kind: 'symbol'; symbolRef: string; symbolName: string }
  | { kind: 'inline'; fields: readonly HttpShapeFieldFact[] }
  | { kind: 'unknown' };

interface HttpShapeFactBase extends HttpFactBase {
  shapeFingerprint: string;
  origin: HttpShapeOrigin;
  coverage: ApiCoverage;
}

export interface HttpRequestShapeFact extends HttpShapeFactBase {
  shapeFactKind: 'http-request-shape';
}

export interface HttpResponseShapeFact extends HttpShapeFactBase {
  shapeFactKind: 'http-response-shape';
  status?: number | 'default';
}

export interface HttpRouteResponseVariant {
  status?: number | 'default';
  /** shapeFingerprint of a co-emitted HttpResponseShapeFact, when statically recoverable. */
  responseShapeRef?: string;
  evidence: ApiCertainty;
}

export interface HttpRouteFact extends HttpFactBase {
  routeFactKind: 'http-route';
  method: HttpMethodOrAny;
  /** As written in source (framework spelling, e.g. ':id', '{id}'). */
  path: string;
  /** Parameter-normalized, e.g. '/users/{}'. See route-normalizer.ts. */
  normalizedPath: string;
  handlerRef?: string;
  middlewareRefs: readonly string[];
  authEvidence?: readonly string[];
  /** shapeFingerprint of a co-emitted HttpRequestShapeFact, when statically recoverable. */
  requestShapeRef?: string;
  responses: readonly HttpRouteResponseVariant[];
  framework: string;
  coverage: ApiCoverage;
}

export interface StaticUrlExpression {
  raw: string;
  basePath?: string;
  literalSegments: readonly string[];
  /** Indices into the segment list (after basePath) that are not statically known. */
  dynamicSegmentIndices: readonly number[];
  isFullyStatic: boolean;
}

export type HttpClientLibrary = 'fetch' | 'axios' | 'angular-http';

export interface HttpConsumerFact extends HttpFactBase {
  consumerFactKind: 'http-consumer';
  clientLibrary: HttpClientLibrary;
  method?: HttpMethodOrAny;
  url: StaticUrlExpression;
  /** shapeFingerprint of a co-emitted HttpRequestShapeFact, when statically recoverable. */
  requestShapeRef?: string;
  consumedKeys: readonly string[];
  expectedResponseShapeSymbolRef?: string;
  coverage: ApiCoverage;
}

export type ApiMatchStrategy =
  | 'exact-method-path'
  | 'exact-normalized-base-path'
  | 'candidate-dynamic-segment'
  | 'unresolved-dynamic-url';

/**
 * A consumer-to-route resolution outcome. This is `resolution/contracts.ts`'s
 * `ResolutionOutcome` verbatim (referenceId = the consumer fact's factId, each candidate's
 * targetId = a route fact's factId and strategy = an `ApiMatchStrategy` value) rather than a
 * parallel certainty/evidence vocabulary — see design.md's baseline-inventory ownership notes.
 */
export type ApiContractMatch = ResolutionOutcome;

export type ApiCompatibilityVerdict = 'compatible' | 'potentially-breaking' | 'breaking' | 'unknown';

export type ApiCompatibilityRuleKind =
  | 'route-removed'
  | 'method-changed'
  | 'request-field-added-required'
  | 'request-field-type-changed'
  | 'response-field-removed'
  | 'response-field-type-changed'
  | 'success-status-removed'
  | 'response-field-added-optional';

export interface ApiCompatibilityFinding {
  rule: ApiCompatibilityRuleKind;
  verdict: ApiCompatibilityVerdict;
  routeFactId: string;
  affectedConsumerFactIds: readonly string[];
  fieldKey?: string;
  reason: string;
  boundaryReasons: readonly ApiBoundaryReason[];
}
