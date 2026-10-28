import { ARRAY_ELEMENT_SEGMENT, formatAccessPath, type ConsumerAccessPath } from './consumers/access-paths.js';
import { isSuccessStatus } from './shape-normalizer.js';
import { fullApiCoverage, partialApiCoverage } from './types.js';
import type {
  ApiBoundaryReason,
  ApiCertainty,
  ApiCoverage,
  HttpConsumerFact,
  HttpRequestShapeFact,
  HttpResponseShapeFact,
  HttpRouteFact,
  HttpShapeFieldFact,
} from './types.js';

export type ShapeCheckVerdict = 'compatible' | 'breaking' | 'unknown';

export type ShapeCheckConsumer = Pick<HttpConsumerFact, 'factId' | 'filePath' | 'sourceRange' | 'consumedKeys' | 'consumedPaths' | 'consumedPathCoverage'> & {
  /** Certainty of the consumer-to-route match. Anything but `exact` can never prove a break. */
  matchCertainty?: ApiCertainty;
};

export interface ShapeCheckFinding {
  consumerFactId: string;
  /** Normalized access path, e.g. `user.profile.displayName` or `items[].price`. */
  path: string;
  verdict: ShapeCheckVerdict;
  /** Consumer guards absence (optional chaining / destructuring default). */
  optional: boolean;
  /** Success statuses whose producer shape contains the full path. */
  matchedStatuses: ReadonlyArray<number | 'default'>;
  /** Success statuses whose complete producer shape provably lacks the path. */
  missingStatuses: ReadonlyArray<number | 'default'>;
  /** Success statuses whose producer shape cannot answer for this path. */
  unresolvedStatuses: ReadonlyArray<number | 'default'>;
  reason: string;
  /** Consumer source anchor plus the producer shape fingerprints consulted. */
  evidence: readonly string[];
  boundaryReasons: readonly ApiBoundaryReason[];
}

export interface ShapeCheckResult {
  routeFactId: string;
  verdict: ShapeCheckVerdict;
  findings: ShapeCheckFinding[];
  totalFindings: number;
  truncated: boolean;
  consumerCount: number;
  producerCoverage: ApiCoverage;
  consumerCoverage: ApiCoverage;
}

export const DEFAULT_SHAPE_CHECK_MAX_FINDINGS = 100;

type PathResolution =
  | { state: 'present'; producerOptionalAncestor: boolean; field: HttpShapeFieldFact }
  | { state: 'missing'; missingAt: string }
  | { state: 'unresolved'; reason: string };

/** Walks `path` through a response's inline fields. Array traversal (`[]`) is only followed
 * when the producer field is a known container with element fields. */
function resolvePath(fields: readonly HttpShapeFieldFact[], path: readonly string[]): PathResolution {
  let current = fields;
  let producerOptionalAncestor = false;
  for (let i = 0; i < path.length; i += 1) {
    const segment = path[i]!;
    if (segment === ARRAY_ELEMENT_SEGMENT) return { state: 'unresolved', reason: 'response is not a statically known array' };
    const field = current.find((candidate) => candidate.key === segment);
    if (!field) return { state: 'missing', missingAt: formatAccessPath(path.slice(0, i + 1)) };
    if (i === path.length - 1) return { state: 'present', producerOptionalAncestor, field };
    if (field.required === false) producerOptionalAncestor = true;
    let next = i + 1;
    if (path[next] === ARRAY_ELEMENT_SEGMENT) {
      if (field.type?.kind !== 'container' || !field.nested) {
        return { state: 'unresolved', reason: `element shape of "${formatAccessPath(path.slice(0, i + 1))}" is not statically known` };
      }
      next += 1;
      if (next === path.length) return { state: 'present', producerOptionalAncestor, field };
      i += 1;
    }
    if (!field.nested) return { state: 'unresolved', reason: `nested shape of "${formatAccessPath(path.slice(0, i + 1))}" is not statically known` };
    current = field.nested;
  }
  return { state: 'unresolved', reason: 'empty access path' };
}

interface SuccessVariant {
  status: number | 'default';
  fingerprint?: string;
  /** Present only when the variant's shape is inline (field-level) evidence. */
  fields?: readonly HttpShapeFieldFact[];
  /** True when absence of a field from `fields` is proof it is not returned. */
  complete: boolean;
}

function successVariants(route: HttpRouteFact, shapes: ReadonlyMap<string, HttpRequestShapeFact | HttpResponseShapeFact>): SuccessVariant[] {
  const variants: SuccessVariant[] = [];
  for (const variant of route.responses) {
    const status = variant.status ?? 'default';
    if (!isSuccessStatus(status)) continue;
    const shape = variant.responseShapeRef ? shapes.get(variant.responseShapeRef) : undefined;
    const inline = shape?.shapeFactKind === 'http-response-shape' && shape.origin.kind === 'inline' ? shape.origin.fields : undefined;
    variants.push({ status, fingerprint: variant.responseShapeRef, fields: inline, complete: inline !== undefined && shape!.coverage.complete });
  }
  return variants.sort((a, b) => String(a.status).localeCompare(String(b.status)));
}

function consumerPaths(consumer: ShapeCheckConsumer): { paths: readonly ConsumerAccessPath[]; coverage: ApiCoverage } {
  if (consumer.consumedPaths) {
    return { paths: consumer.consumedPaths, coverage: consumer.consumedPathCoverage ?? partialApiCoverage(['legacy-consumer-facts']) };
  }
  // Facts persisted before nested access paths existed: top-level keys are still exact reads,
  // but nothing beneath them was ever observed.
  return {
    paths: consumer.consumedKeys.map((key) => ({ path: [key], optional: false, sourceRange: consumer.sourceRange, certainty: 'exact' as const })),
    coverage: partialApiCoverage(['legacy-consumer-facts']),
  };
}

const VERDICT_RANK: Record<ShapeCheckVerdict, number> = { breaking: 0, unknown: 1, compatible: 2 };

function judgePath(
  consumer: ShapeCheckConsumer,
  access: ConsumerAccessPath,
  variants: readonly SuccessVariant[],
  nestedWholeUse: Set<string>,
): ShapeCheckFinding {
  const path = formatAccessPath(access.path);
  const matched: Array<number | 'default'> = [];
  const missing: Array<number | 'default'> = [];
  const unresolved: Array<number | 'default'> = [];
  const reasons: string[] = [];
  let producerOptionalAncestor = false;

  for (const variant of variants) {
    if (!variant.fields) {
      unresolved.push(variant.status);
      continue;
    }
    const resolution = resolvePath(variant.fields, access.path);
    if (resolution.state === 'present') {
      matched.push(variant.status);
      producerOptionalAncestor ||= resolution.producerOptionalAncestor;
      if (access.wholeValueUse && resolution.field.nested && resolution.field.nested.length > 0) nestedWholeUse.add(path);
    } else if (resolution.state === 'missing' && variant.complete) {
      missing.push(variant.status);
      reasons.push(`"${resolution.missingAt}" is not in the status ${variant.status} response`);
    } else {
      unresolved.push(variant.status);
      reasons.push(resolution.state === 'unresolved' ? resolution.reason : `status ${variant.status} response shape is only partially known`);
    }
  }

  const exactConsumer = access.certainty === 'exact' && (consumer.matchCertainty ?? 'exact') === 'exact';
  let verdict: ShapeCheckVerdict;
  let reason: string;
  const boundaryReasons: ApiBoundaryReason[] = [];
  if (variants.length === 0) {
    verdict = 'unknown';
    reason = 'route has no statically known success response';
    boundaryReasons.push('unresolved-response-shape');
  } else if (missing.length === variants.length) {
    verdict = exactConsumer ? 'breaking' : 'unknown';
    reason = exactConsumer
      ? `consumer reads "${path}" but ${reasons.join('; ')}`
      : `consumer may read "${path}" (non-exact evidence) but ${reasons.join('; ')}`;
  } else if (matched.length === variants.length) {
    if (producerOptionalAncestor && !access.optional) {
      verdict = 'unknown';
      reason = `"${path}" sits under an optional producer field but the consumer does not guard its absence`;
    } else {
      verdict = 'compatible';
      reason = `"${path}" is returned by every success response`;
    }
  } else {
    verdict = 'unknown';
    reason = missing.length > 0 && matched.length > 0
      ? `"${path}" is returned by only some success responses (${reasons.join('; ')})`
      : reasons.join('; ') || `"${path}" could not be resolved against the producer shape`;
    boundaryReasons.push('unresolved-response-shape');
  }

  return {
    consumerFactId: consumer.factId,
    path,
    verdict,
    optional: access.optional,
    matchedStatuses: matched,
    missingStatuses: missing,
    unresolvedStatuses: unresolved,
    reason,
    evidence: [
      `${consumer.filePath}:${access.sourceRange.startLine}`,
      ...variants.map((variant) => variant.fingerprint).filter((fingerprint): fingerprint is string => Boolean(fingerprint)),
    ],
    boundaryReasons,
  };
}

/**
 * Compares the response fields each consumer statically reads against `route`'s success
 * response shapes. A path is `breaking` only when every success response has a complete
 * inline shape that lacks it AND the read is exact; anything the producer or consumer evidence
 * cannot settle is `unknown`. The overall verdict is `compatible` only when nothing broke and
 * both producer and consumer coverage are complete — an empty finding list is never a pass.
 */
export function checkConsumerResponseShapes(
  route: HttpRouteFact,
  consumers: readonly ShapeCheckConsumer[],
  responseShapes: ReadonlyMap<string, HttpRequestShapeFact | HttpResponseShapeFact>,
  options: { maxFindings?: number } = {},
): ShapeCheckResult {
  const variants = successVariants(route, responseShapes);
  const producerReasons = new Set<ApiBoundaryReason>(route.coverage.boundaryReasons);
  if (variants.length === 0 || variants.some((variant) => !variant.complete)) producerReasons.add('unresolved-response-shape');

  const consumerReasons = new Set<ApiBoundaryReason>();
  const nestedWholeUse = new Set<string>();
  const findings: ShapeCheckFinding[] = [];
  for (const consumer of [...consumers].sort((a, b) => a.factId.localeCompare(b.factId))) {
    const { paths, coverage } = consumerPaths(consumer);
    for (const reason of coverage.boundaryReasons) consumerReasons.add(reason);
    if (consumer.matchCertainty && consumer.matchCertainty !== 'exact') consumerReasons.add('dynamic-path-segment');
    for (const access of paths) findings.push(judgePath(consumer, access, variants, nestedWholeUse));
  }
  // A known object passed on whole may have any of its nested fields read elsewhere.
  if (nestedWholeUse.size > 0) consumerReasons.add('local-data-flow-exceeded');

  findings.sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] || a.consumerFactId.localeCompare(b.consumerFactId) || a.path.localeCompare(b.path));
  const maxFindings = Math.max(1, options.maxFindings ?? DEFAULT_SHAPE_CHECK_MAX_FINDINGS);

  const producerCoverage = producerReasons.size === 0 ? fullApiCoverage() : partialApiCoverage([...producerReasons]);
  // No matched consumer is "no evidence", never "nothing reads this route".
  const consumerCoverage = consumers.length === 0
    ? partialApiCoverage([])
    : consumerReasons.size === 0 ? fullApiCoverage() : partialApiCoverage([...consumerReasons]);

  let verdict: ShapeCheckVerdict = 'compatible';
  if (findings.some((finding) => finding.verdict === 'breaking')) verdict = 'breaking';
  else if (consumers.length === 0 || !producerCoverage.complete || !consumerCoverage.complete || findings.some((finding) => finding.verdict === 'unknown')) verdict = 'unknown';

  return {
    routeFactId: route.factId,
    verdict,
    findings: findings.slice(0, maxFindings),
    totalFindings: findings.length,
    truncated: findings.length > maxFindings,
    consumerCount: consumers.length,
    producerCoverage,
    consumerCoverage,
  };
}
