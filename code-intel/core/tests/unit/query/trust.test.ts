import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emptyTrust, summarizeEdgeTrust } from '../../../src/query/trust.js';

describe('emptyTrust', () => {
  it('defaults empty results to lower-bound when no exact-empty proof exists', () => {
    const result = emptyTrust();
    assert.equal(result.certainty, 'lower-bound');
    assert.equal(result.coverage.complete, false);
    assert.deepEqual(result.coverage.incompleteReasons, ['absence-not-proof']);
  });

  it('can represent exact empty proof explicitly', () => {
    const result = emptyTrust({ exact: true });
    assert.equal(result.certainty, 'exact');
    assert.equal(result.coverage.complete, true);
    assert.deepEqual(result.coverage.incompleteReasons, []);
  });

  it('can represent unavailable empty result with visible boundary', () => {
    const result = emptyTrust({ unavailable: true, boundaryKind: 'unavailable-index' });
    assert.equal(result.certainty, 'unavailable');
    assert.equal(result.coverage.complete, false);
    assert.deepEqual(result.boundaries.map((item) => item.kind), ['unavailable-index']);
  });
});

describe('summarizeEdgeTrust', () => {
  it('uses lower-bound for empty traversal without proof', () => {
    const result = summarizeEdgeTrust([]);
    assert.equal(result.certainty, 'lower-bound');
    assert.equal(result.coverage.complete, false);
  });

  it('uses exact for empty traversal when exact proof is supplied', () => {
    const result = summarizeEdgeTrust([], undefined, { emptyProof: { exact: true } });
    assert.equal(result.certainty, 'exact');
    assert.equal(result.coverage.complete, true);
  });
});
