import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { loadGraphToDB } from '../../../src/storage/graph-loader.js';
import { DbManager } from '../../../src/storage/db-manager.js';
import { createIndexGeneration, publishIndexGeneration } from '../../../src/storage/index-generation.js';
import { saveRegistry } from '../../../src/storage/repo-registry.js';
import { saveGroup } from '../../../src/multi-repo/group-registry.js';
import { queryGroup } from '../../../src/multi-repo/group-query.js';

const originalHome = process.env['HOME'];

function writeRepoGeneration(repoDir: string, generationId: string, opts: { embeddingsEnabled: boolean; embeddingsStatus?: 'ready' | 'stale'; content: string }) {
  const graph = createKnowledgeGraph();
  graph.addNode({
    id: `function:${generationId}`,
    kind: 'function',
    name: `symbol-${generationId}`,
    filePath: `src/${generationId}.ts`,
    content: opts.content,
  });

  const gen = createIndexGeneration(repoDir, generationId);
  const db = new DbManager(gen.graphDbPath, false);
  return db.init()
    .then(async () => {
      await loadGraphToDB(graph, db);
      fs.writeFileSync(gen.bm25DbPath, 'bm25-placeholder');
      fs.writeFileSync(gen.vectorDbPath, 'not-a-real-sqlite-db');
      publishIndexGeneration(repoDir, gen, {
        indexedAt: `2025-01-01T00:00:00.000Z`,
        repoId: 'repo-1',
        embeddings: {
          enabled: opts.embeddingsEnabled,
          status: opts.embeddingsStatus ?? 'ready',
          provider: 'openai',
          model: 'text-embedding-3-small',
          dimension: 1536,
        },
        stats: { nodes: 1, edges: 0, files: 1, duration: 1 },
      }, { vectorRequired: true });
    })
    .finally(() => db.close());
}

describe('queryGroup pinned metadata contract', () => {
  let home: string;
  let repoDir: string;

  before(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-group-home-'));
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-group-repo-'));
    process.env['HOME'] = home;
  });

  afterEach(() => {
    saveRegistry([]);
  });

  afterEach(() => {
    try { fs.rmSync(path.join(home, '.code-intel', 'groups.json'), { force: true }); } catch {}
  });

  afterEach(() => {
    for (const entry of fs.readdirSync(path.join(repoDir, '.code-intel', 'generations'), { withFileTypes: true })) {
      fs.rmSync(path.join(repoDir, '.code-intel', 'generations', entry.name), { recursive: true, force: true });
    }
    fs.rmSync(path.join(repoDir, '.code-intel', 'current.json'), { force: true });
  });

  after(() => {
    if (originalHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = originalHome;
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(repoDir, { recursive: true, force: true }); } catch {}
  });

  it('uses pinned snapshot metadata rather than active root metadata', async () => {
    await writeRepoGeneration(repoDir, 'gen-a', {
      embeddingsEnabled: false,
      content: 'repoScopedSearch pinned generation content',
    });
    await writeRepoGeneration(repoDir, 'gen-b', {
      embeddingsEnabled: true,
      content: 'newer generation content',
    });

    const currentPath = path.join(repoDir, '.code-intel', 'current.json');
    fs.writeFileSync(currentPath, JSON.stringify({ version: 2, generationId: 'gen-a' }, null, 2));

    saveRegistry([{ id: 'repo-1', name: 'repo-a', path: repoDir, indexedAt: new Date(0).toISOString(), stats: { nodes: 1, edges: 0, files: 1 } }]);
    const group = {
      name: 'team',
      createdAt: new Date(0).toISOString(),
      members: [{ repoId: 'repo-1', registryName: 'repo-a', groupPath: 'services/repo-a' }],
    };
    saveGroup(group);

    const result = await queryGroup(group, 'repoScopedSearch', 10, { mode: 'vector' });

    assert.equal(result.searchMode, 'bm25');
    assert.equal(result.vectorReady, false);
    assert.equal(result.perRepo[0]?.vectorReady, false);
    assert.match(result.perRepo[0]?.results[0]?.snippet ?? '', /pinned generation content/);
  });
});
