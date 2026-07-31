import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { hybridSearch } from '../../../src/search/hybrid-search.js';

describe('search score evidence', () => {
  it('is omitted by default and included for explained BM25 fallback', async () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'n1',
      kind: 'function',
      name: 'authenticateUser',
      filePath: 'src/auth.ts',
      content: 'authenticate user token',
    });

    const compact = await hybridSearch(graph, 'authenticate', 10);
    const explained = await hybridSearch(graph, 'authenticate', 10, { explainResults: true });

    assert.equal(compact.results[0]?.evidence, undefined);
    assert.equal(explained.results[0]?.evidence?.lexicalScore, explained.results[0]?.score);
    assert.equal(explained.results[0]?.evidence?.finalScore, explained.results[0]?.score);
    assert.equal(explained.results[0]?.evidence?.bm25Rank, 1);
  });
});
