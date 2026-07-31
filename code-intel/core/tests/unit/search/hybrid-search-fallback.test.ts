import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { hybridSearch } from '../../../src/search/hybrid-search.js';

describe('hybrid search vector fallback status', () => {
  it('reports unavailable when no vector index exists', async () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'function:test',
      kind: 'function',
      name: 'searchableFunction',
      filePath: 'src/test.ts',
      content: 'export function searchableFunction() {}',
    });

    const result = await hybridSearch(graph, 'searchableFunction', 10, {
      vectorDbPath: path.join(os.tmpdir(), `missing-vector-${Date.now()}.db`),
    });

    assert.equal(result.searchMode, 'bm25');
    assert.equal(result.vectorStatus, 'unavailable');
  });

  it('reports failed when the vector database cannot be opened', async () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'function:test',
      kind: 'function',
      name: 'searchableFunction',
      filePath: 'src/test.ts',
      content: 'export function searchableFunction() {}',
    });

    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'invalid-vector-'));
    const invalidDbPath = path.join(parent, 'vector.db');
    fs.mkdirSync(invalidDbPath);
    try {
      const result = await hybridSearch(graph, 'searchableFunction', 10, {
        vectorDbPath: invalidDbPath,
      });
      assert.equal(result.searchMode, 'bm25');
      assert.equal(result.vectorStatus, 'failed');
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});
