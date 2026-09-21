/**
 * invalidation-closure.ts
 *
 * Deterministic breadth-first traversal of the reverse dependency index that
 * expands a set of changed/removed producer facts into the full set of
 * unchanged consumer facts (in other files) whose resolution may now differ.
 *
 * Correctness over completeness: any uncertainty (missing/incompatible index,
 * breadth/depth budget exceeded) reports `truncated: true` so the caller
 * falls back to a full rebuild rather than publish a partial closure.
 */
import type { DependencyKey, ReverseDependencyEntry, ReverseDependencyIndex } from './reverse-dependency-index.js';
import { factRef, isReverseDependencyIndexCompatible, lookupConsumers } from './reverse-dependency-index.js';

export interface InvalidationClosureLimits {
  /** Maximum number of distinct consumer facts the closure may include before forcing full fallback. */
  maxBreadth: number;
  /** Maximum number of re-export/producer-chain hops to follow. */
  maxDepth: number;
}

export const DEFAULT_INVALIDATION_CLOSURE_LIMITS: InvalidationClosureLimits = {
  maxBreadth: 2000,
  maxDepth: 6,
};

export interface InvalidationClosureResult {
  invalidatedFacts: readonly ReverseDependencyEntry[];
  invalidatedFiles: ReadonlySet<string>;
  truncated: boolean;
  reason?: string;
}

function truncatedResult(reason: string): InvalidationClosureResult {
  return {
    invalidatedFacts: [],
    invalidatedFiles: new Set(),
    truncated: true,
    reason,
  };
}

/**
 * @param seedKeys Dependency keys published/removed by producer facts in changed or deleted files.
 * @param excludeFiles Files whose consumer facts are already covered by direct re-parse (the changed/deleted files themselves).
 */
export function computeInvalidationClosure(args: {
  seedKeys: readonly DependencyKey[];
  index: ReverseDependencyIndex | null;
  excludeFiles: ReadonlySet<string>;
  limits?: InvalidationClosureLimits;
}): InvalidationClosureResult {
  const { seedKeys, index, excludeFiles } = args;
  const limits = args.limits ?? DEFAULT_INVALIDATION_CLOSURE_LIMITS;

  if (seedKeys.length === 0) {
    return { invalidatedFacts: [], invalidatedFiles: new Set(), truncated: false };
  }
  if (!isReverseDependencyIndexCompatible(index)) {
    return truncatedResult('reverse dependency index missing or incompatible');
  }

  const invalidated = new Map<string, ReverseDependencyEntry>();
  const visitedKeys = new Set<string>();
  let frontier: DependencyKey[] = [...seedKeys];

  for (let depth = 0; frontier.length > 0; depth += 1) {
    if (depth > limits.maxDepth) {
      return truncatedResult(`invalidation closure exceeded max depth (${limits.maxDepth})`);
    }
    const nextFrontier: DependencyKey[] = [];
    for (const dependencyKey of frontier) {
      const keyId = `${dependencyKey.domain} ${dependencyKey.key}`;
      if (visitedKeys.has(keyId)) continue;
      visitedKeys.add(keyId);

      for (const consumer of lookupConsumers(index, dependencyKey.domain, dependencyKey.key)) {
        if (excludeFiles.has(consumer.filePath)) continue;
        const ref = factRef(consumer.filePath, consumer.factId);
        if (!invalidated.has(ref)) {
          invalidated.set(ref, consumer);
          if (invalidated.size > limits.maxBreadth) {
            return truncatedResult(`invalidation closure exceeded max breadth (${limits.maxBreadth})`);
          }
          const producedKeys = index.producedByFactId.get(ref);
          if (producedKeys) nextFrontier.push(...producedKeys);
        }
      }
    }
    frontier = nextFrontier;
  }

  const invalidatedFacts = [...invalidated.values()].sort((a, b) => factRef(a.filePath, a.factId).localeCompare(factRef(b.filePath, b.factId)));
  return {
    invalidatedFacts,
    invalidatedFiles: new Set(invalidatedFacts.map((entry) => entry.filePath)),
    truncated: false,
  };
}
