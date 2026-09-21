import { createResolutionOutcome } from '../../resolution/contracts.js';
import type { ResolutionCandidate, ResolutionCertainty } from '../../resolution/contracts.js';
import type { ApiContractMatch, ApiMatchStrategy, HttpConsumerFact, HttpRouteFact } from './types.js';

export const API_MATCHER_RESOLVER_VERSION = 'api-contract-matcher-v1';
export const DEFAULT_CANDIDATE_CAP = 20;

export interface ScopedFact<T> {
  repoId: string;
  fact: T;
}

export interface MatchApiContractsOptions {
  /** Hard cap on emitted candidates per consumer. Exceeding it truncates the candidate list
   * and reports lower-bound coverage rather than silently returning every match. */
  candidateCap?: number;
}

/** Per-run counters, mirroring `resolution/indexes.ts`'s `ResolutionInstrumentation` pattern:
 * a mutable object the caller creates once and passes in, incremented in place so it can be
 * read after the call (and across multiple calls, e.g. one per repo in a group sync). */
export interface ApiMatchInstrumentation {
  producerFactCount: number;
  consumerFactCount: number;
  exactMatchCount: number;
  candidateSetMatchCount: number;
  unresolvedMatchCount: number;
  candidateCapHitCount: number;
  /** Number of (consumer, route) pairs examined across all consumers. */
  comparisonCount: number;
  elapsedMs: number;
}

export function createApiMatchInstrumentation(): ApiMatchInstrumentation {
  return {
    producerFactCount: 0,
    consumerFactCount: 0,
    exactMatchCount: 0,
    candidateSetMatchCount: 0,
    unresolvedMatchCount: 0,
    candidateCapHitCount: 0,
    comparisonCount: 0,
    elapsedMs: 0,
  };
}

/** Consumer normalized path, built the same way route-normalizer builds a route's
 * normalizedPath: literal segments verbatim, dynamic segments as `{}`. Undefined when the URL
 * expression could not be decomposed at all (an opaque call-site expression). */
function consumerNormalizedPath(consumer: HttpConsumerFact): string | undefined {
  if (consumer.url.literalSegments.length === 0 && !consumer.url.isFullyStatic) return undefined;
  return '/' + consumer.url.literalSegments.join('/');
}

function methodsCompatible(consumerMethod: HttpConsumerFact['method'], routeMethod: HttpRouteFact['method']): boolean {
  if (!consumerMethod || consumerMethod === 'ANY' || routeMethod === 'ANY') return true;
  return consumerMethod === routeMethod;
}

/** Deterministic candidate order: same repo as the consumer first, then repoId, then factId.
 * Never relies on input array order (which is not guaranteed stable across analysis runs). */
function compareCandidates(consumerRepoId: string, a: ScopedFact<HttpRouteFact>, b: ScopedFact<HttpRouteFact>): number {
  const sameRepoA = a.repoId === consumerRepoId ? 0 : 1;
  const sameRepoB = b.repoId === consumerRepoId ? 0 : 1;
  if (sameRepoA !== sameRepoB) return sameRepoA - sameRepoB;
  if (a.repoId !== b.repoId) return a.repoId.localeCompare(b.repoId);
  return a.fact.factId.localeCompare(b.fact.factId);
}

/**
 * Resolves each consumer fact to zero or more candidate route facts. Matching is
 * method + normalizedPath equality only — a normalizedPath already collapses framework
 * parameter spelling to `{}` while keeping every literal segment distinct, so this alone
 * satisfies "route parameters must match, literal segments must not fuzz together" without
 * separate parameter-aware logic. Simple suffix/substring equality is never used.
 *
 * Scope (which repos' routes are eligible) is entirely the caller's choice — pass a single
 * repo's routes for same-repo matching, or a whole group's routes for cross-repo matching.
 */
export function matchApiContracts(
  routes: readonly ScopedFact<HttpRouteFact>[],
  consumers: readonly ScopedFact<HttpConsumerFact>[],
  options: MatchApiContractsOptions = {},
  instrumentation: ApiMatchInstrumentation = createApiMatchInstrumentation(),
): ApiContractMatch[] {
  const candidateCap = options.candidateCap ?? DEFAULT_CANDIDATE_CAP;
  const results: ApiContractMatch[] = [];
  const startedAt = Date.now();
  instrumentation.producerFactCount += routes.length;
  instrumentation.consumerFactCount += consumers.length;

  for (const { repoId: consumerRepoId, fact: consumer } of consumers) {
    const normalizedPath = consumerNormalizedPath(consumer);

    if (normalizedPath === undefined) {
      instrumentation.unresolvedMatchCount += 1;
      results.push(
        createResolutionOutcome({
          referenceId: consumer.factId,
          certainty: 'unresolved',
          candidates: [],
          coverage: { complete: false, emittedCandidates: 0, incompleteReasons: ['dynamic-url-expression'] },
          boundary: 'unresolved-dynamic-url' satisfies ApiMatchStrategy,
          resolverVersion: API_MATCHER_RESOLVER_VERSION,
        }),
      );
      continue;
    }

    instrumentation.comparisonCount += routes.length;
    const matchingRoutes = routes.filter(
      (route) => route.fact.normalizedPath === normalizedPath && methodsCompatible(consumer.method, route.fact.method),
    );

    if (matchingRoutes.length === 0) {
      instrumentation.unresolvedMatchCount += 1;
      results.push(
        createResolutionOutcome({
          referenceId: consumer.factId,
          certainty: 'unresolved',
          candidates: [],
          coverage: { complete: true, emittedCandidates: 0, incompleteReasons: [] },
          resolverVersion: API_MATCHER_RESOLVER_VERSION,
        }),
      );
      continue;
    }

    const ordered = [...matchingRoutes].sort((a, b) => compareCandidates(consumerRepoId, a, b));
    const ambiguous = ordered.length > 1 || consumer.url.dynamicSegmentIndices.length > 0;
    const strategy: ApiMatchStrategy = ambiguous
      ? 'candidate-dynamic-segment'
      : consumer.url.basePath
        ? 'exact-normalized-base-path'
        : 'exact-method-path';

    const truncated = ordered.length > candidateCap;
    const emitted = ordered.slice(0, candidateCap);
    // createResolutionOutcome re-sorts candidates by confidence (desc) as its primary key, so
    // the same-repo-first / repoId / factId ordering established above must be encoded as a
    // strictly decreasing confidence sequence — equal confidences would fall through to
    // orderResolutionCandidates' own tie-breaker (targetId), silently discarding this order.
    const baseConfidence = ambiguous ? 1 / ordered.length : 1;

    const candidates: ResolutionCandidate[] = emitted.map((route, index) => ({
      targetId: route.fact.factId,
      confidence: ambiguous ? Math.max(0.0001, baseConfidence - index * 0.0001) : baseConfidence,
      strategy,
      evidenceRefs: [consumer.factId, route.fact.factId],
    }));

    const certainty: ResolutionCertainty = ambiguous ? 'candidate-set' : 'exact';
    if (certainty === 'exact') instrumentation.exactMatchCount += 1;
    else instrumentation.candidateSetMatchCount += 1;
    if (truncated) instrumentation.candidateCapHitCount += 1;

    results.push(
      createResolutionOutcome({
        referenceId: consumer.factId,
        certainty,
        candidates,
        coverage: {
          complete: !truncated,
          totalKnownCandidates: ordered.length,
          emittedCandidates: emitted.length,
          incompleteReasons: truncated ? ['candidate-cap-exceeded'] : [],
        },
        resolverVersion: API_MATCHER_RESOLVER_VERSION,
      }),
    );
  }

  instrumentation.elapsedMs += Date.now() - startedAt;
  return results;
}
