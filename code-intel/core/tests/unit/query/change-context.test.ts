import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { buildChangeContext } from '../../../src/query/change-context.js';

describe('buildChangeContext', () => {
  it('returns impact, bounded context and test suggestions in one result', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'service', kind: 'function', name: 'createUser', filePath: 'src/user.ts', content: 'export function createUser() { return saveUser(); }' });
    graph.addNode({ id: 'repo', kind: 'function', name: 'saveUser', filePath: 'src/repo.ts', content: 'export function saveUser() { return true; }' });
    graph.addNode({ id: 'controller', kind: 'function', name: 'handleUser', filePath: 'src/controller.ts', content: 'export function handleUser() { return createUser(); }' });
    graph.addEdge({ id: 'service-repo', source: 'service', target: 'repo', kind: 'calls' });
    graph.addEdge({ id: 'controller-service', source: 'controller', target: 'service', kind: 'calls' });

    const result = buildChangeContext(graph, { changedFiles: ['src/user.ts'], maxTokens: 256 });

    assert.deepEqual(result.changedFiles, ['src/user.ts']);
    assert.equal(result.summary.changedSymbolCount, 1);
    assert.ok(result.summary.impactedSymbolCount >= 1);
    assert.ok((result.context.blockTokens?.total ?? Infinity) <= 256);
    assert.equal(result.testSuggestions[0]?.symbol, 'createUser');
  });

  it('normalizes and deduplicates changed paths', () => {
    const graph = createKnowledgeGraph();
    const result = buildChangeContext(graph, { changedFiles: ['src\\user.ts', 'src/user.ts', ''] });
    assert.deepEqual(result.changedFiles, ['src/user.ts']);
    assert.equal(result.summary.highestRisk, 'NONE');
  });
});
