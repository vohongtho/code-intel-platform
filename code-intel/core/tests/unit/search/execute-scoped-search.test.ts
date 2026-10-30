import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { executeSearchRequest } from '../../../src/search/execute-scoped-search.js';
import { saveRegistry } from '../../../src/storage/repo-registry.js';
import type { IndexSnapshot } from '../../../src/storage/index-snapshot.js';

describe('executeSearchRequest pinned metadata contract', () => {
  // A canonical scope.repoId must exist in the registry (no name/path fallback since v1.0.10),
  // so the test registers `repo-1` in its own throwaway HOME rather than relying on global state.
  const originalHome = process.env['HOME'];
  let home = '';
  before(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-scoped-search-home-'));
    process.env['HOME'] = home;
    saveRegistry([{ id: 'repo-1', name: 'repo-a', path: '/workspace/repo-a', indexedAt: new Date(0).toISOString(), stats: { nodes: 1, edges: 0, files: 1 } }]);
  });
  after(() => {
    if (originalHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = originalHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

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
          semanticIndexPath: '/snapshots/gen-a/semantic-index.json',
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
