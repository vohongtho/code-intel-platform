import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSearchRequest, validateSearchScope } from '../../../src/search/execute-scoped-search.js';

describe('scoped search request normalization', () => {
  it('preserves canonical scope object', () => {
    const result = normalizeSearchRequest({ query: 'auth', scope: { type: 'repo', repoId: 'repo-api' }, mode: 'vector' });
    assert.deepEqual(result, {
      query: 'auth',
      limit: 20,
      mode: 'vector',
      scope: { type: 'repo', repoId: 'repo-api' },
      deprecated: false,
      explain: false,
    });
  });

  it('normalizes legacy group field', () => {
    const result = normalizeSearchRequest({ query: 'auth', group: 'platform' });
    assert.deepEqual(result, {
      query: 'auth',
      limit: 20,
      mode: 'auto',
      scope: { type: 'group', name: 'platform' },
      deprecated: true,
      explain: false,
    });
  });

  it('rejects mixed canonical and legacy shape', () => {
    const result = normalizeSearchRequest({ query: 'auth', scope: { type: 'repo', repoId: 'repo-api' }, repo: 'api' });
    assert.equal('error' in result, true);
    if ('error' in result && result.error) assert.equal(result.error.message, 'Ambiguous request shape');
  });

  it('rejects repoId mixed with legacy shape', () => {
    const result = normalizeSearchRequest({ query: 'auth', repoId: 'repo-a', group: 'b' });
    assert.equal('error' in result, true);
    if ('error' in result && result.error) assert.equal(result.error.message, 'Ambiguous flat scope');
  });

  it('rejects legacy repo and group together', () => {
    const result = normalizeSearchRequest({ query: 'auth', repo: 'a', group: 'b' });
    assert.equal('error' in result, true);
    if ('error' in result && result.error) assert.equal(result.error.message, 'Ambiguous legacy scope');
  });

  it('rejects unknown scope type', () => {
    const result = validateSearchScope({ type: 'weird' });
    assert.equal('error' in result, true);
    if ('error' in result) assert.equal(result.error.message, 'Invalid scope.type');
  });

  it('rejects repo scope without repoId', () => {
    const result = normalizeSearchRequest({ query: 'auth', scope: { type: 'repo' } as never });
    assert.equal('error' in result, true);
    if ('error' in result && result.error) assert.equal(result.error.message, 'Invalid scope.repoId');
  });

  it('rejects group scope without name', () => {
    const result = normalizeSearchRequest({ query: 'auth', scope: { type: 'group' } as never });
    assert.equal('error' in result, true);
    if ('error' in result && result.error) assert.equal(result.error.message, 'Invalid scope.name');
  });
});
