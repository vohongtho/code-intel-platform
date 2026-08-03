import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { VectorIndex } from '../../../src/search/vector-index.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { collectEmbeddingCandidates } from '../../../src/search/embedder.js';
import type { EmbeddedNode } from '../../../src/search/embedder.js';

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `vector-index-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function makeEmbeddedNode(id: string, filePath: string, embeddingValue: number): EmbeddedNode {
  const embedding = new Array(384).fill(0);
  embedding[0] = embeddingValue;
  return {
    id,
    name: id,
    kind: 'function',
    filePath,
    text: `${id} ${filePath}`,
    embedding,
  };
}

describe('VectorIndex incremental updates', () => {
  it('replaces changed-file vectors without touching other files', async () => {
    const dbPath = tmpDbPath();
    const idx = new VectorIndex(dbPath);
    await idx.init();

    await idx.buildIndex([
      makeEmbeddedNode('a1', 'src/a.ts', 1),
      makeEmbeddedNode('a2', 'src/a.ts', 2),
      makeEmbeddedNode('b1', 'src/b.ts', 3),
    ]);

    const deleted = await idx.deleteByFilePaths(['src/a.ts']);
    const upserted = await idx.upsertIndex([
      makeEmbeddedNode('a3', 'src/a.ts', 4),
    ]);

    assert.equal(deleted, 2);
    assert.equal(upserted, 1);

    const keep = await idx.search(makeEmbeddedNode('q', 'q.ts', 3).embedding, 5);
    assert.ok(keep.some((hit) => hit.nodeId === 'b1'), 'unchanged file vector should remain');

    const changed = await idx.search(makeEmbeddedNode('q', 'q.ts', 4).embedding, 5);
    assert.ok(changed.some((hit) => hit.nodeId === 'a3'), 'new changed-file vector should exist');
    assert.ok(!changed.some((hit) => hit.nodeId === 'a1'), 'stale vector a1 should be removed');
    assert.ok(!changed.some((hit) => hit.nodeId === 'a2'), 'stale vector a2 should be removed');

    idx.close();
    fs.unlinkSync(dbPath);
  });

  it('removes deleted-file vectors', async () => {
    const dbPath = tmpDbPath();
    const idx = new VectorIndex(dbPath);
    await idx.init();

    await idx.buildIndex([
      makeEmbeddedNode('old', 'src/old.ts', 1),
      makeEmbeddedNode('keep', 'src/keep.ts', 2),
    ]);

    const deleted = await idx.deleteByFilePaths(['src/old.ts']);
    assert.equal(deleted, 1);

    const results = await idx.search(makeEmbeddedNode('q', 'q.ts', 1).embedding, 5);
    assert.ok(!results.some((hit) => hit.nodeId === 'old'), 'deleted file vector should be removed');
    assert.ok(results.some((hit) => hit.nodeId === 'keep'), 'other file vector should remain');

    idx.close();
    fs.unlinkSync(dbPath);
  });

  it('rejects vectors that do not match the configured model dimension', async () => {
    const dbPath = tmpDbPath();
    const idx = new VectorIndex(dbPath, 3);
    await idx.init();
    await assert.rejects(
      () => idx.buildIndex([makeEmbeddedNode('bad', 'src/bad.ts', 1)]),
      /dimension 384; expected 3/,
    );
    idx.close();
    fs.unlinkSync(dbPath);
  });

  it('stores and searches vectors using a non-default dimension', async () => {
    const dbPath = tmpDbPath();
    const idx = new VectorIndex(dbPath, 3);
    await idx.init();
    await idx.buildIndex([{ id: 'small', name: 'small', kind: 'function', filePath: 'small.ts', text: 'small', embedding: [1, 0, 0] }]);
    const hits = await idx.search([1, 0, 0], 1);
    assert.equal(hits[0]?.nodeId, 'small');
    idx.close();
    fs.unlinkSync(dbPath);
  });
});

describe('collectEmbeddingCandidates', () => {
  it('filters to changed files only', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'a1', kind: 'function', name: 'a1', filePath: 'src/a.ts', content: 'a1' });
    graph.addNode({ id: 'b1', kind: 'function', name: 'b1', filePath: 'src/b.ts', content: 'b1' });
    graph.addNode({ id: 'd1', kind: 'directory', name: 'src', filePath: 'src', content: '' });

    const all = collectEmbeddingCandidates(graph);
    const filtered = collectEmbeddingCandidates(graph, ['src/b.ts']);

    assert.equal(all.length, 2);
    assert.deepEqual(filtered.map((node) => node.id), ['b1']);
  });
});
