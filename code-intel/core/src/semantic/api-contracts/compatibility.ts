import { findAddedFields, findRemovedFields, isSuccessStatus } from './shape-normalizer.js';
import type {
  ApiCompatibilityFinding,
  ApiCompatibilityVerdict,
  HttpRequestShapeFact,
  HttpResponseShapeFact,
  HttpRouteFact,
  HttpShapeFieldFact,
} from './types.js';

export interface KnownConsumer {
  factId: string;
  consumedKeys: readonly string[];
}

interface ResponseStatusEntry {
  /** undefined when the status was observed but its shape could not be statically resolved
   * (distinct from the status not being present at all — see resolveResponseShapesByStatus). */
  shape?: HttpResponseShapeFact;
}

export interface DiffApiContractsInput {
  baseRoutes: readonly HttpRouteFact[];
  headRoutes: readonly HttpRouteFact[];
  /** Both base and head shape facts, keyed by their own shapeFingerprint. A route only ever
   * looks up shapes through its own requestShapeRef/responses[].responseShapeRef — never by
   * matching on symbol/DTO name across routes — so a same-named DTO belonging to an unrelated
   * route is never accidentally compared. */
  shapesByFingerprint: ReadonlyMap<string, HttpRequestShapeFact | HttpResponseShapeFact>;
  /** Consumers already resolved (via matcher.ts) to a given HEAD route's factId. */
  consumersByRouteFactId: ReadonlyMap<string, readonly KnownConsumer[]>;
  /**
   * True only when `consumersByRouteFactId` is known to be the complete consumer set for the
   * scope being compared (matcher ran with certainty and no truncation across every repo in
   * scope). False/absent means "no known consumer for this route" must be read as "we don't
   * know", never as "proven no consumer" — see spec.md's unknown-shape requirement.
   */
  consumerCoverageComplete: boolean;
}

function routeKey(route: HttpRouteFact): string {
  return `${route.method}::${route.normalizedPath}`;
}

function resolveRequestShape(
  route: HttpRouteFact | undefined,
  shapes: ReadonlyMap<string, HttpRequestShapeFact | HttpResponseShapeFact>,
): HttpRequestShapeFact | undefined {
  if (!route?.requestShapeRef) return undefined;
  const shape = shapes.get(route.requestShapeRef);
  return shape?.shapeFactKind === 'http-request-shape' ? shape : undefined;
}

function resolveResponseShapesByStatus(
  route: HttpRouteFact | undefined,
  shapes: ReadonlyMap<string, HttpRequestShapeFact | HttpResponseShapeFact>,
): Map<number | 'default', ResponseStatusEntry> {
  const byStatus = new Map<number | 'default', ResponseStatusEntry>();
  for (const variant of route?.responses ?? []) {
    const shape = variant.responseShapeRef ? shapes.get(variant.responseShapeRef) : undefined;
    // Every observed status enters the map, even with an unresolved shape — a variant with no
    // recoverable shape must still be visible to the diff loop as "present but unknown", not
    // silently absent (which would read as "nothing here to compare").
    byStatus.set(variant.status ?? 'default', { shape: shape?.shapeFactKind === 'http-response-shape' ? shape : undefined });
  }
  return byStatus;
}

function inlineFields(shape: HttpRequestShapeFact | HttpResponseShapeFact | undefined): readonly HttpShapeFieldFact[] | undefined {
  return shape?.origin.kind === 'inline' ? shape.origin.fields : undefined;
}

function typeCategoryText(type: HttpShapeFieldFact['type']): string {
  if (!type) return 'unknown';
  if (type.kind === 'nominal' || type.kind === 'generic-application') return type.name ?? type.text;
  return type.kind;
}

function finding(
  rule: ApiCompatibilityFinding['rule'],
  verdict: ApiCompatibilityVerdict,
  route: HttpRouteFact,
  reason: string,
  extras: Partial<Pick<ApiCompatibilityFinding, 'fieldKey' | 'affectedConsumerFactIds' | 'boundaryReasons'>> = {},
): ApiCompatibilityFinding {
  return {
    rule,
    verdict,
    routeFactId: route.factId,
    affectedConsumerFactIds: extras.affectedConsumerFactIds ?? [],
    fieldKey: extras.fieldKey,
    reason,
    boundaryReasons: extras.boundaryReasons ?? [],
  };
}

function diffRequestShapes(
  headRoute: HttpRouteFact,
  baseShape: HttpRequestShapeFact | undefined,
  headShape: HttpRequestShapeFact | undefined,
): ApiCompatibilityFinding[] {
  const baseFields = inlineFields(baseShape);
  const headFields = inlineFields(headShape);
  if (baseFields === undefined || headFields === undefined) {
    // A route with no request body at all (baseShape/headShape both absent) is not an
    // unknown-shape case; only flag when a shape exists but couldn't be resolved to fields.
    if ((baseShape && baseFields === undefined) || (headShape && headFields === undefined)) {
      return [
        finding('request-field-type-changed', 'unknown', headRoute, 'request shape could not be statically resolved on at least one side', {
          boundaryReasons: ['unresolved-dto'],
        }),
      ];
    }
    return [];
  }

  const findings: ApiCompatibilityFinding[] = [];
  for (const field of findAddedFields(baseFields, headFields)) {
    if (!field.required) continue;
    const evidenceComplete = headShape?.coverage.complete ?? false;
    findings.push(
      finding(
        'request-field-added-required',
        evidenceComplete ? 'breaking' : 'potentially-breaking',
        headRoute,
        `head request requires new field "${field.key}" that base callers would not send`,
        { fieldKey: field.key, boundaryReasons: evidenceComplete ? [] : ['unresolved-dto'] },
      ),
    );
  }

  const headByKey = new Map(headFields.map((field) => [field.key, field] as const));
  for (const baseField of baseFields) {
    const headField = headByKey.get(baseField.key);
    if (!headField) continue;
    const baseType = typeCategoryText(baseField.type);
    const headType = typeCategoryText(headField.type);
    if (baseType !== headType && baseType !== 'unknown' && headType !== 'unknown') {
      findings.push(
        finding(
          'request-field-type-changed',
          'potentially-breaking',
          headRoute,
          `request field "${baseField.key}" changed type category from "${baseType}" to "${headType}"`,
          { fieldKey: baseField.key },
        ),
      );
    }
  }
  return findings;
}

function diffResponseShapesForStatus(
  headRoute: HttpRouteFact,
  status: number | 'default',
  baseEntry: ResponseStatusEntry | undefined,
  headEntry: ResponseStatusEntry | undefined,
  consumers: readonly KnownConsumer[],
  consumerCoverageComplete: boolean,
): ApiCompatibilityFinding[] {
  const baseFields = inlineFields(baseEntry?.shape);
  const headFields = inlineFields(headEntry?.shape);
  if (baseFields === undefined || headFields === undefined) {
    // A variant that was observed at all (base and/or head) but whose shape could not be
    // statically resolved must still surface as `unknown` — silence here would read as "no
    // change found", which is exactly the false safety spec.md prohibits. A status with no
    // variant on either side (already handled by the caller) legitimately produces nothing.
    if (baseEntry || headEntry) {
      return [
        finding(
          'response-field-type-changed',
          'unknown',
          headRoute,
          `response shape for status ${status} could not be statically resolved on at least one side`,
          { boundaryReasons: ['unresolved-response-shape'] },
        ),
      ];
    }
    return [];
  }

  const findings: ApiCompatibilityFinding[] = [];

  for (const field of findRemovedFields(baseFields, headFields)) {
    const readers = consumers.filter((consumer) => consumer.consumedKeys.includes(field.key));
    const verdict: ApiCompatibilityVerdict = readers.length > 0 ? 'breaking' : consumerCoverageComplete ? 'compatible' : 'unknown';
    findings.push(
      finding('response-field-removed', verdict, headRoute, `response field "${field.key}" (status ${status}) was removed`, {
        fieldKey: field.key,
        affectedConsumerFactIds: readers.map((reader) => reader.factId),
        boundaryReasons: verdict === 'unknown' ? ['unresolved-response-shape'] : [],
      }),
    );
  }

  for (const field of findAddedFields(baseFields, headFields)) {
    findings.push(
      finding('response-field-added-optional', 'compatible', headRoute, `response field "${field.key}" (status ${status}) is a new additive field`, {
        fieldKey: field.key,
      }),
    );
  }

  const headByKey = new Map(headFields.map((field) => [field.key, field] as const));
  for (const baseField of baseFields) {
    const headField = headByKey.get(baseField.key);
    if (!headField) continue;
    const baseType = typeCategoryText(baseField.type);
    const headType = typeCategoryText(headField.type);
    if (baseType !== headType && baseType !== 'unknown' && headType !== 'unknown') {
      const readers = consumers.filter((consumer) => consumer.consumedKeys.includes(baseField.key));
      findings.push(
        finding(
          'response-field-type-changed',
          readers.length > 0 ? 'breaking' : 'potentially-breaking',
          headRoute,
          `response field "${baseField.key}" (status ${status}) changed type category from "${baseType}" to "${headType}"`,
          { fieldKey: baseField.key, affectedConsumerFactIds: readers.map((reader) => reader.factId) },
        ),
      );
    }
  }

  return findings;
}

/**
 * Compares a base and head route/shape snapshot and returns compatibility findings. Never
 * returns an empty result to mean "safe": an unresolved shape on either side always produces
 * an `unknown`-verdict finding instead of silently being skipped (spec.md's unknown-shape
 * requirement). Route pairing is by (method, normalizedPath) — never by name/substring.
 */
export function diffApiContracts(input: DiffApiContractsInput): ApiCompatibilityFinding[] {
  const findings: ApiCompatibilityFinding[] = [];
  const baseByKey = new Map(input.baseRoutes.map((route) => [routeKey(route), route] as const));
  const headByKey = new Map(input.headRoutes.map((route) => [routeKey(route), route] as const));
  const headRoutesByPath = new Map<string, HttpRouteFact[]>();
  for (const route of input.headRoutes) {
    const list = headRoutesByPath.get(route.normalizedPath) ?? [];
    list.push(route);
    headRoutesByPath.set(route.normalizedPath, list);
  }

  for (const baseRoute of input.baseRoutes) {
    const pairedHeadRoute = headByKey.get(routeKey(baseRoute));
    if (pairedHeadRoute) continue; // unchanged (method, path) pair — diffed in the second pass below

    const survivingAtPath = headRoutesByPath.get(baseRoute.normalizedPath) ?? [];
    if (survivingAtPath.length === 0) {
      const consumers = input.consumersByRouteFactId.get(baseRoute.factId) ?? [];
      const verdict: ApiCompatibilityVerdict = consumers.length > 0 ? 'breaking' : input.consumerCoverageComplete ? 'compatible' : 'unknown';
      findings.push(
        finding('route-removed', verdict, baseRoute, `route ${routeKey(baseRoute)} no longer exists in head`, {
          affectedConsumerFactIds: consumers.map((consumer) => consumer.factId),
        }),
      );
    } else {
      const consumers = input.consumersByRouteFactId.get(baseRoute.factId) ?? [];
      const verdict: ApiCompatibilityVerdict = consumers.length > 0 ? 'breaking' : 'potentially-breaking';
      findings.push(
        finding(
          'method-changed',
          verdict,
          baseRoute,
          `method ${baseRoute.method} for ${baseRoute.normalizedPath} was removed; other method(s) remain at this path`,
          { affectedConsumerFactIds: consumers.map((consumer) => consumer.factId) },
        ),
      );
    }
  }

  for (const headRoute of input.headRoutes) {
    const baseRoute = baseByKey.get(routeKey(headRoute));
    if (!baseRoute) continue; // newly added route/method — not a compatibility violation

    const consumers = input.consumersByRouteFactId.get(headRoute.factId) ?? [];
    const baseRequestShape = resolveRequestShape(baseRoute, input.shapesByFingerprint);
    const headRequestShape = resolveRequestShape(headRoute, input.shapesByFingerprint);
    findings.push(...diffRequestShapes(headRoute, baseRequestShape, headRequestShape));

    const baseResponses = resolveResponseShapesByStatus(baseRoute, input.shapesByFingerprint);
    const headResponses = resolveResponseShapesByStatus(headRoute, input.shapesByFingerprint);
    const allStatuses = new Set([...baseResponses.keys(), ...headResponses.keys()]);
    for (const status of allStatuses) {
      const baseEntry = baseResponses.get(status);
      const headEntry = headResponses.get(status);
      if (baseEntry && !headEntry && isSuccessStatus(status)) {
        const verdict: ApiCompatibilityVerdict = consumers.length > 0 ? 'breaking' : 'potentially-breaking';
        findings.push(
          finding('success-status-removed', verdict, headRoute, `success status ${status} present in base is no longer returned in head`, {
            affectedConsumerFactIds: consumers.map((consumer) => consumer.factId),
          }),
        );
        continue;
      }
      findings.push(...diffResponseShapesForStatus(headRoute, status, baseEntry, headEntry, consumers, input.consumerCoverageComplete));
    }
  }

  return findings;
}
