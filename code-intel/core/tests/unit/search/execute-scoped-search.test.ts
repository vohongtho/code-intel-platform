import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { executeSearchRequest } from '../../../src/search/execute-scoped-search.js';
import type { IndexSnapshot } from '../../../src/storage/index-snapshot.js';

describe('executeSearchRequest pinned metadata contract', () => {
  it('uses pinned context metadata instead of repo-root metadata for vector fallback', async () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'function:repoScopedSearch',
      kind: 'function',
      name: 'repoScopedSearch',
      filePath: 'src/search.ts',
      content: 'export function repoScopedSearch() {}',
    });

    const result = await executeSearchRequest({
      query: 'repoScopedSearch',
      mode: 'vector',
      scope: { type: 'repo', repoId: 'repo-1' },
      explain: true,
    }, {
      repoName: 'repo-main',
      workspaceRoot: '/workspace/main',
      ensureBm25Index: () => null,
      getGraphForRepo: async () => {
        throw new Error('should use getRepoSearchContext graph');
      },
      getRepoSearchContext: async () => ({
        graph,
        bm25Index: null,
        vectorDbPath: '/definitely/missing/vector.db',
        snapshot: {
          repositoryRoot: '/workspace/main',
          generationId: 'gen-a',
          generationDir: '/snapshots/gen-a',
          legacy: false,
          manifestVersion: 2,
          manifest: null,
          graphDbPath: '/snapshots/gen-a/graph.db',
          bm25DbPath: '/snapshots/gen-a/bm25.db',
          vectorDbPath: '/definitely/missing/vector.db',
          metadataPath: '/snapshots/gen-a/meta.json',
        } satisfies IndexSnapshot,
        metadata: {
          indexedAt: '2025-01-01T00:00:00.000Z',
          repoId: 'repo-1',
          embeddings: {
            enabled: false,
            status: 'ready',
            provider: 'openai',
            model: 'text-embedding-3-small',
            dimension: 1536,
          },
          stats: { nodes: 1, edges: 0, files: 1, duration: 0 },
        },
      }),
    });

    assert.ok('body' in result);
    if (!('body' in result)) return;
    assert.equal(result.body.actualMode, 'bm25');
    assert.equal(result.body.fallbackReason, 'VECTOR_INDEX_UNAVAILABLE');
    assert.equal(result.body.vectorReady, false);
    assert.match(result.body.explanation?.summary ?? '', /VECTOR_INDEX_UNAVAILABLE/);
  });
});
