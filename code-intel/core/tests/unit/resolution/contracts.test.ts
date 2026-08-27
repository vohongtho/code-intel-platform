import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createResolutionOutcome, orderResolutionCandidates, RESOLVER_VERSION } from '../../../src/resolution/contracts.js';

describe('resolution contracts', () => {
  it('orders candidates deterministically by confidence, evidence, strategy, target', () => {
    const ordered = orderResolutionCandidates([
      { targetId: 'b', confidence: 0.7, strategy: 'beta', evidenceRefs: ['e1'] },
      { targetId: 'a', confidence: 0.7, strategy: 'alpha', evidenceRefs: ['e1', 'e2'] },
      { targetId: 'c', confidence: 0.9, strategy: 'zeta', evidenceRefs: [] },
    ]);

    assert.deepEqual(ordered.map((item) => item.targetId), ['c', 'a', 'b']);
  });

  it('normalizes outcome ordering and defaults resolver version', () => {
    const outcome = createResolutionOutcome({
      referenceId: 'ref-1',
      certainty: 'candidate-set',
      candidates: [
        { targetId: 'b', confidence: 0.4, strategy: 'beta', evidenceRefs: ['z'] },
        { targetId: 'a', confidence: 0.4, strategy: 'alpha', evidenceRefs: ['a', 'b'] },
      ],
      coverage: {
        complete: false,
        emittedCandidates: 2,
        incompleteReasons: ['zeta', 'alpha'],
      },
      resolverVersion: '',
    });

    assert.equal(outcome.resolverVersion, RESOLVER_VERSION);
    assert.deepEqual(outcome.candidates.map((item) => item.targetId), ['a', 'b']);
    assert.deepEqual(outcome.coverage.incompleteReasons, ['alpha', 'zeta']);
  });
});
