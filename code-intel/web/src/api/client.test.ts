import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiClient, InvalidGQLResultError } from './client';
import type { QueryScope } from 'code-intel-shared';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('ApiClient.queryGQL', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('returns normalized successful results', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'csrf-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ groups: [{ key: 'auth', count: 2 }], executionTimeMs: 1, truncated: false, totalCount: 2 }) });

    const client = new ApiClient('http://localhost:4747');
    const result = await client.queryGQL('COUNT function GROUP BY cluster');

    expect(result.kind).toBe('aggregate');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.groups).toEqual([{ key: 'auth', count: 2 }]);
    expect(result.path).toBeNull();
  });

  it('sends scope when provided', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'csrf-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ kind: 'nodes', nodes: [], edges: [], groups: [], path: null, executionTimeMs: 1, truncated: false, totalCount: 0, scope: { type: 'repo', repoId: 'repo-1', repoName: 'demo' } }) });

    const client = new ApiClient('http://localhost:4747');
    const scope: QueryScope = { type: 'repo', repoId: 'repo-1' };
    await client.queryGQL('FIND function', scope);

    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://localhost:4747/api/v1/query', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ gql: 'FIND function', scope }),
    }));
  });

  it('surfaces structured 500 error messages', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'csrf-1' }) })
      .mockResolvedValueOnce({ ok: false, statusText: 'Internal Server Error', json: async () => ({ error: { message: 'Internal server error' } }) });

    const client = new ApiClient('http://localhost:4747');
    await expect(client.queryGQL('COUNT function')).rejects.toThrow('Internal server error');
  });

  it('falls back for non-JSON error responses', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'csrf-1' }) })
      .mockResolvedValueOnce({ ok: false, statusText: 'Internal Server Error', json: async () => { throw new Error('not json'); } });

    const client = new ApiClient('http://localhost:4747');
    await expect(client.queryGQL('COUNT function')).rejects.toThrow('Query failed: Internal Server Error');
  });

  it('rejects unusable success payloads', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'csrf-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ kind: 'aggregate', nodes: [], edges: [], groups: [], path: null, executionTimeMs: 'bad', truncated: false, totalCount: 0 }) });

    const client = new ApiClient('http://localhost:4747');
    await expect(client.queryGQL('COUNT function')).rejects.toThrow(InvalidGQLResultError);
  });
});
