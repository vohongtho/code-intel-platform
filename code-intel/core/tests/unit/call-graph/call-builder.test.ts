import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCallEdges } from '../../../src/call-graph/call-builder.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { BindingTracker } from '../../../src/resolver/binding-tracker.js';
import type { CallSite } from '../../../src/call-graph/call-classifier.js';

function makeCallSite(overrides: Partial<CallSite> = {}): CallSite {
  return {
    callerNodeId: 'node-1',
    callerFilePath: '/src/foo.ts',
    name: 'doSomething',
    kind: 'free',
    line: 10,
    argCount: 0,
    ...overrides,
  };
}

describe('buildCallEdges', () => {
  it('returns empty array for no call sites', () => {
    const graph = createKnowledgeGraph();
    const bindings = new BindingTracker();
    const edges = buildCallEdges([], graph, bindings);
    assert.equal(edges.length, 0);
  });

  it('resolves same-file call via symbol index', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn-1', kind: 'function', name: 'doSomething', filePath: '/src/foo.ts' });
    graph.addNode({ id: 'caller-1', kind: 'function', name: 'main', filePath: '/src/foo.ts' });
    const bindings = new BindingTracker();
    const cs = makeCallSite({ callerNodeId: 'caller-1', callerFilePath: '/src/foo.ts', name: 'doSomething' });
    const edges = buildCallEdges([cs], graph, bindings);
    assert.equal(edges.length, 1);
    assert.equal(edges[0]!.kind, 'calls');
    assert.equal(edges[0]!.source, 'caller-1');
    assert.equal(edges[0]!.target, 'fn-1');
  });

  it('resolves imported binding', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn-remote', kind: 'function', name: 'helper', filePath: '/src/utils.ts' });
    graph.addNode({ id: 'caller-2', kind: 'function', name: 'main', filePath: '/src/main.ts' });
    const bindings = new BindingTracker();
    bindings.addBinding('/src/main.ts', {
      localName: 'helper',
      sourcePath: '/src/utils.ts',
      exportedName: 'helper',
      isDefault: false,
      isNamespace: false,
    });
    const cs = makeCallSite({ callerNodeId: 'caller-2', callerFilePath: '/src/main.ts', name: 'helper' });
    const edges = buildCallEdges([cs], graph, bindings);
    assert.equal(edges.length, 1);
    assert.equal(edges[0]!.target, 'fn-remote');
  });

  it('falls back to global symbol index', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn-global', kind: 'function', name: 'globalFn', filePath: '/src/utils.ts' });
    const bindings = new BindingTracker();
    const cs = makeCallSite({ callerNodeId: 'caller-x', callerFilePath: '/src/other.ts', name: 'globalFn' });
    const edges = buildCallEdges([cs], graph, bindings);
    assert.equal(edges.length, 1);
    assert.equal(edges[0]!.target, 'fn-global');
  });

  it('skips self-calls (caller === target)', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn-self', kind: 'function', name: 'recursive', filePath: '/src/foo.ts' });
    const bindings = new BindingTracker();
    const cs = makeCallSite({ callerNodeId: 'fn-self', callerFilePath: '/src/foo.ts', name: 'recursive' });
    const edges = buildCallEdges([cs], graph, bindings);
    assert.equal(edges.length, 0);
  });

  it('returns empty when callee not found anywhere', () => {
    const graph = createKnowledgeGraph();
    const bindings = new BindingTracker();
    const cs = makeCallSite({ name: 'unknownFn' });
    const edges = buildCallEdges([cs], graph, bindings);
    assert.equal(edges.length, 0);
  });

  it('resolves class nodes in same-file symbol index', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'cls-1', kind: 'class', name: 'MyClass', filePath: '/src/foo.ts' });
    const bindings = new BindingTracker();
    const cs = makeCallSite({ callerNodeId: 'caller-3', callerFilePath: '/src/foo.ts', name: 'MyClass' });
    const edges = buildCallEdges([cs], graph, bindings);
    assert.equal(edges.length, 1);
    assert.equal(edges[0]!.target, 'cls-1');
  });

  it('uses positive confidence weight from tier', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn-same', kind: 'function', name: 'util', filePath: '/src/foo.ts' });
    const bindings = new BindingTracker();
    const cs = makeCallSite({ callerNodeId: 'caller-4', callerFilePath: '/src/foo.ts', name: 'util' });
    const edges = buildCallEdges([cs], graph, bindings);
    assert.equal(edges.length, 1);
    assert.ok((edges[0]!.weight ?? 0) > 0);
  });
});
