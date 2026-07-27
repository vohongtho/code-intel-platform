import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

interface SearchScope {
  type: 'repo' | 'group';
  name: string;
}

function normalizeSearchRequest(body: { query?: string; limit?: number; mode?: 'bm25' | 'vector' | 'hybrid'; scope?: SearchScope; repo?: string; group?: string }) {
  const { query, limit, mode, scope, repo, group } = body;
  if (!query) return { error: { status: 400, message: 'Missing query' } };
  if (scope && (repo || group)) return { error: { status: 400, message: 'Ambiguous request shape' } };
  if (repo && group) return { error: { status: 400, message: 'Ambiguous legacy scope' } };
  const normalizedScope = scope ?? (group ? { type: 'group' as const, name: group } : repo ? { type: 'repo' as const, name: repo } : undefined);
  return { query, limit: limit ?? 20, mode: mode ?? 'hybrid', scope: normalizedScope, deprecated: Boolean(repo || group) };
}

describe('scoped search request normalization', () => {
  it('preserves canonical scope object', () => {
    const result = normalizeSearchRequest({ query: 'auth', scope: { type: 'repo', name: 'api' }, mode: 'vector' });
    assert.deepEqual(result, {
      query: 'auth',
      limit: 20,
      mode: 'vector',
      scope: { type: 'repo', name: 'api' },
      deprecated: false,
    });
  });

  it('normalizes legacy group field', () => {
    const result = normalizeSearchRequest({ query: 'auth', group: 'platform' });
    assert.deepEqual(result, {
      query: 'auth',
      limit: 20,
      mode: 'hybrid',
      scope: { type: 'group', name: 'platform' },
      deprecated: true,
    });
  });

  it('rejects mixed canonical and legacy shape', () => {
    const result = normalizeSearchRequest({ query: 'auth', scope: { type: 'repo', name: 'api' }, repo: 'api' });
    assert.equal('error' in result, true);
    if ('error' in result && result.error) assert.equal(result.error.message, 'Ambiguous request shape');
  });

  it('rejects legacy repo and group together', () => {
    const result = normalizeSearchRequest({ query: 'auth', repo: 'a', group: 'b' });
    assert.equal('error' in result, true);
    if ('error' in result && result.error) assert.equal(result.error.message, 'Ambiguous legacy scope');
  });
});
