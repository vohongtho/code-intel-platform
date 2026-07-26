import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { formatSymbolTarget, parseSymbolTarget, resolveSymbolTarget } from '../../../src/cli/symbol-target.js';

describe('qualified symbol targets', () => {
  it('round-trips reserved characters while keeping path separators readable', () => {
    const node = { id: '1', kind: 'method', name: 'log@in', filePath: 'src/a:b file.ts', startLine: 12 } as const;
    const selector = formatSymbolTarget(node);
    assert.equal(selector, 'method:log%40in@src/a%3Ab%20file.ts:12');
    assert.deepEqual(parseSymbolTarget(selector), {
      kind: node.kind, name: node.name, filePath: node.filePath, startLine: node.startLine,
    });
  });

  it('reports deterministic ambiguity and prefers source over tests', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'test', kind: 'function', name: 'login', filePath: 'tests/login.test.ts', startLine: 1 });
    graph.addNode({ id: 'source', kind: 'method', name: 'login', filePath: 'src/client.ts', startLine: 2 });
    const resolution = resolveSymbolTarget(graph, 'login');
    assert.equal(resolution.status, 'ambiguous');
    if (resolution.status === 'ambiguous') assert.equal(resolution.candidates[0].id, 'source');
  });

  it('prefers unknown paths over explicit test paths when no main source exists', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'test', kind: 'function', name: 'login', filePath: 'tests/login.test.ts', startLine: 1 });
    graph.addNode({ id: 'unknown', kind: 'function', name: 'login', filePath: 'login.ts', startLine: 1 });
    const resolution = resolveSymbolTarget(graph, 'login');
    assert.equal(resolution.status, 'ambiguous');
    if (resolution.status === 'ambiguous') assert.equal(resolution.candidates[0].id, 'unknown');
  });

  it('resolves a displayed qualified target exactly', () => {
    const graph = createKnowledgeGraph();
    const selected = { id: 'selected', kind: 'method', name: 'login', filePath: 'src/client.ts', startLine: 2 } as const;
    graph.addNode(selected);
    graph.addNode({ id: 'other', kind: 'function', name: 'login', filePath: 'tests/login.ts', startLine: 1 });
    const resolution = resolveSymbolTarget(graph, formatSymbolTarget(selected));
    assert.equal(resolution.status, 'found');
    if (resolution.status === 'found') assert.equal(resolution.node.id, selected.id);
  });
});
