import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveContextSeed } from '../../../src/context/selection.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { CodeNode } from '../../../src/shared/index.js';

function addNode(graph: ReturnType<typeof createKnowledgeGraph>, node: CodeNode): void {
  graph.addNode(node);
}

describe('resolveContextSeed — canonical selection semantics', () => {
  it('exact: unambiguous simple name resolves to the single matching node', () => {
    const g = createKnowledgeGraph();
    addNode(g, { id: 'n1', kind: 'function', name: 'createUser', filePath: 'src/user.ts' });
    const resolution = resolveContextSeed(g, 'createUser');
    assert.equal(resolution.status, 'exact');
    assert.equal(resolution.status === 'exact' ? resolution.node.id : undefined, 'n1');
  });

  it('missing: no candidates for an unknown name', () => {
    const g = createKnowledgeGraph();
    addNode(g, { id: 'n1', kind: 'function', name: 'createUser', filePath: 'src/user.ts' });
    const resolution = resolveContextSeed(g, 'doesNotExist');
    assert.equal(resolution.status, 'missing');
  });

  it('ambiguous: two distinct symbols sharing one simple name never silently resolve to the first candidate', () => {
    const g = createKnowledgeGraph();
    // Two unrelated `Handler` symbols in different files/owners.
    addNode(g, { id: 'n1', kind: 'class', name: 'Handler', filePath: 'src/auth/handler.ts', startLine: 1 });
    addNode(g, { id: 'n2', kind: 'class', name: 'Handler', filePath: 'src/billing/handler.ts', startLine: 1 });
    const resolution = resolveContextSeed(g, 'Handler');
    assert.equal(resolution.status, 'ambiguous');
    if (resolution.status === 'ambiguous') {
      assert.equal(resolution.candidates.length, 2);
      const ids = resolution.candidates.map((c) => c.id).sort();
      assert.deepEqual(ids, ['n1', 'n2']);
    }
  });

  it('exact: fully qualified selector (kind:name@path:line) disambiguates a same-name pair', () => {
    const g = createKnowledgeGraph();
    addNode(g, { id: 'n1', kind: 'class', name: 'Handler', filePath: 'src/auth/handler.ts', startLine: 1 });
    addNode(g, { id: 'n2', kind: 'class', name: 'Handler', filePath: 'src/billing/handler.ts', startLine: 1 });
    const resolution = resolveContextSeed(g, 'class:Handler@src/billing/handler.ts:1');
    assert.equal(resolution.status, 'exact');
    assert.equal(resolution.status === 'exact' ? resolution.node.id : undefined, 'n2');
  });
});
