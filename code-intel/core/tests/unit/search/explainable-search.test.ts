import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchExplanation,
  normalizeSearchRequest,
} from '../../../src/search/execute-scoped-search.js';

describe('explainable search contract', () => {
  it('keeps explanation opt-in during normalization', () => {
    const compact = normalizeSearchRequest({ query: 'auth' });
    const verbose = normalizeSearchRequest({ query: 'auth', explain: true });
    assert.equal('error' in compact, false);
    assert.equal('error' in verbose, false);
    if (!('error' in compact)) assert.equal(compact.explain, false);
    if (!('error' in verbose)) assert.equal(verbose.explain, true);
  });

  it('describes RRF execution without fallback', () => {
    const value = buildSearchExplanation('auto', 'hybrid', true);
    assert.equal(value.ranking, 'RECIPROCAL_RANK_FUSION');
    assert.equal(value.fallbackReason, undefined);
    assert.match(value.summary, /executed hybrid/);
  });

  it('reports vector fallback truthfully', () => {
    const value = buildSearchExplanation(
      'vector',
      'bm25',
      false,
      'VECTOR_INDEX_UNAVAILABLE',
    );
    assert.equal(value.ranking, 'BM25');
    assert.equal(value.fallbackReason, 'VECTOR_INDEX_UNAVAILABLE');
    assert.match(value.summary, /Requested vector/);
  });
});
