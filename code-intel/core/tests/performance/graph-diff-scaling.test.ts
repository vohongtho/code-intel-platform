/**
 * Task 13.1: scaling benchmarks for the semantic graph diff at 10k/100k node
 * scale.
 *
 * A true end-to-end benchmark (materializing two 10k/100k-symbol commits into
 * throwaway worktrees and running the real `analyze` CLI pipeline twice) is
 * infeasible as a repeatable test — that's dominated by parser/analyzer wall
 * time unrelated to the diff logic this change adds, and would take minutes
 * per run. What this change actually owns is `diffEntitiesWithContinuity` /
 * `diffRelationships` (graph-diff.ts, continuity.ts): both are `Map`-keyed,
 * single-pass over each side, with no per-item query text generation (see
 * design.md "Query scaling"). This benchmark exercises exactly those
 * functions directly against synthetic `NormalizedGraph` maps of the target
 * size, so it proves the diff stage itself — not analysis — stays linear and
 * bounded at 10k/100k entities. Assertions are correctness-at-scale plus a
 * generous wall-clock ceiling to catch an accidental quadratic regression,
 * not tight timing (shared CI hardware makes tight timing budgets flaky).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { diffEntitiesWithContinuity, diffRelationships } from '../../src/snapshots/graph-diff.js';
import type { NormalizedEdge, NormalizedGraph, NormalizedNode } from '../../src/snapshots/normalizer.js';

/**
 * Builds a deterministic base/head pair of size `n`, partitioned by `i % 100`
 * into five categories so every delta kind graph-diff/continuity can produce
 * is exercised at scale in one pass:
 *  - [0, 2):  removed only in base (no head counterpart) -> unpaired `removed`
 *  - [2, 4):  removed from base + a same-content, same-file, differently-named
 *             node added in head -> continuity proves a single `renamed` delta
 *  - [4, 6):  content fingerprint changes, same id -> `changed`
 *  - [6, 100): identical on both sides -> no delta
 * Plus `n * 0.02` brand-new head-only nodes with unique content, unrelated to
 * any base node -> unpaired `added`.
 */
function buildEntityFixture(n: number): { base: NormalizedGraph; head: NormalizedGraph; expected: { removed: number; renamed: number; changed: number; added: number } } {
  const base = new Map<string, NormalizedNode>();
  const head = new Map<string, NormalizedNode>();

  for (let i = 0; i < n; i += 1) {
    const bucket = i % 100;
    const baseNode: NormalizedNode = {
      id: `fn-${i}`,
      kind: 'function',
      properties: { name: `fn${i}`, filePath: `src/mod${i % 500}.ts`, contentFingerprint: `fp-base-${i}` },
    };
    base.set(baseNode.id, baseNode);

    if (bucket < 2) {
      // removed only
      continue;
    }
    if (bucket < 4) {
      // renamed: same content fingerprint, same file, different id/name
      head.set(`fn-${i}-renamed`, {
        id: `fn-${i}-renamed`,
        kind: 'function',
        properties: { name: `fn${i}Renamed`, filePath: baseNode.properties.filePath, contentFingerprint: `fp-rename-${i}` },
      });
      base.set(baseNode.id, { ...baseNode, properties: { ...baseNode.properties, contentFingerprint: `fp-rename-${i}` } });
      continue;
    }
    if (bucket < 6) {
      // changed: same id, different content
      head.set(baseNode.id, { ...baseNode, properties: { ...baseNode.properties, contentFingerprint: `fp-changed-${i}` } });
      continue;
    }
    // unchanged
    head.set(baseNode.id, baseNode);
  }

  const addedOnlyCount = Math.floor(n * 0.02);
  for (let i = 0; i < addedOnlyCount; i += 1) {
    const id = `new-${i}`;
    head.set(id, { id, kind: 'function', properties: { name: `new${i}`, filePath: `src/new${i % 500}.ts`, contentFingerprint: `fp-new-${i}` } });
  }

  const removedCount = Math.round(n * 0.02);
  const renamedCount = Math.round(n * 0.02);
  const changedCount = Math.round(n * 0.02);

  return {
    base: { nodesById: base, edgesByKey: new Map() },
    head: { nodesById: head, edgesByKey: new Map() },
    expected: { removed: removedCount, renamed: renamedCount, changed: changedCount, added: addedOnlyCount },
  };
}

/**
 * Edge fixture, independent of the entity fixture above: `n` `calls` edges
 * forming a ring (fn-i -> fn-(i+1 mod n)), partitioned the same way -
 * removed/changed/unchanged plus `n * 0.02` head-only additions.
 */
function buildRelationshipFixture(n: number): { base: NormalizedGraph; head: NormalizedGraph; expected: { removed: number; changed: number; added: number } } {
  const baseEdges = new Map<string, NormalizedEdge>();
  const headEdges = new Map<string, NormalizedEdge>();

  for (let i = 0; i < n; i += 1) {
    const bucket = i % 100;
    const source = `fn-${i}`;
    const target = `fn-${(i + 1) % n}`;
    const key = `${source}::calls::${target}::`;
    const baseEdge: NormalizedEdge = { key, source, target, kind: 'calls', certainty: 'exact' };
    baseEdges.set(key, baseEdge);

    if (bucket < 2) continue; // removed
    if (bucket < 4) {
      headEdges.set(key, { ...baseEdge, certainty: 'heuristic' }); // changed (certainty degradation)
      continue;
    }
    headEdges.set(key, baseEdge); // unchanged
  }

  const addedCount = Math.floor(n * 0.02);
  for (let i = 0; i < addedCount; i += 1) {
    const source = `new-${i}`;
    const target = `new-${(i + 1) % addedCount}`;
    const key = `${source}::calls::${target}::`;
    headEdges.set(key, { key, source, target, kind: 'calls', certainty: 'exact' });
  }

  return {
    base: { nodesById: new Map(), edgesByKey: baseEdges },
    head: { nodesById: new Map(), edgesByKey: headEdges },
    expected: { removed: Math.round(n * 0.02), changed: Math.round(n * 0.02), added: addedCount },
  };
}

describe('semantic graph diff performance at scale', () => {
  for (const n of [10_000, 100_000]) {
    it(`diffs ${n} entities with correct rename/change/remove/add counts in bounded time`, () => {
      const { base, head, expected } = buildEntityFixture(n);

      const startedAt = Date.now();
      const deltas = diffEntitiesWithContinuity(base, head);
      const elapsedMs = Date.now() - startedAt;

      const byKind = { removed: 0, renamed: 0, changed: 0, added: 0 };
      for (const delta of deltas) {
        if (delta.kind === 'removed') byKind.removed += 1;
        else if (delta.kind === 'renamed') byKind.renamed += 1;
        else if (delta.kind === 'changed') byKind.changed += 1;
        else if (delta.kind === 'added') byKind.added += 1;
        else assert.fail(`unexpected delta kind at scale: ${delta.kind}`);
      }

      assert.equal(byKind.removed, expected.removed);
      assert.equal(byKind.renamed, expected.renamed);
      assert.equal(byKind.changed, expected.changed);
      assert.equal(byKind.added, expected.added);
      assert.ok(elapsedMs < 15_000, `entity diff over ${n} nodes took ${elapsedMs}ms — expected well under 15s`);
    });

    it(`diffs ${n} relationships with correct changed/remove/add counts in bounded time`, () => {
      const { base, head, expected } = buildRelationshipFixture(n);

      const startedAt = Date.now();
      const deltas = diffRelationships(base, head);
      const elapsedMs = Date.now() - startedAt;

      const byKind = { removed: 0, changed: 0, added: 0 };
      for (const delta of deltas) {
        if (delta.kind === 'removed') byKind.removed += 1;
        else if (delta.kind === 'changed') byKind.changed += 1;
        else if (delta.kind === 'added') byKind.added += 1;
      }

      assert.equal(byKind.removed, expected.removed);
      assert.equal(byKind.changed, expected.changed);
      assert.equal(byKind.added, expected.added);
      assert.ok(elapsedMs < 15_000, `relationship diff over ${n} edges took ${elapsedMs}ms — expected well under 15s`);
    });
  }

  it('scales sub-quadratically: 10x more entities takes nowhere near 10x-squared the time', () => {
    const small = buildEntityFixture(10_000);
    const large = buildEntityFixture(100_000);

    const smallStart = Date.now();
    diffEntitiesWithContinuity(small.base, small.head);
    const smallMs = Math.max(1, Date.now() - smallStart);

    const largeStart = Date.now();
    diffEntitiesWithContinuity(large.base, large.head);
    const largeMs = Math.max(1, Date.now() - largeStart);

    // A true O(n^2) algorithm would show roughly a 100x slowdown for a 10x
    // input increase; a generous 30x ceiling leaves headroom for GC/JIT noise
    // on shared CI while still failing on a real quadratic regression.
    assert.ok(largeMs / smallMs < 30, `100k took ${largeMs}ms vs 10k's ${smallMs}ms — ratio ${(largeMs / smallMs).toFixed(1)}x suggests worse-than-linear scaling`);
  });
});
