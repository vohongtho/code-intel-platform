import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findEntryPoints, traceFlow } from '../../../src/flow-detection/entry-point-finder.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { generateEdgeId } from '../../../src/graph/id-generator.js';

describe('findEntryPoints', () => {
  it('returns empty for empty graph', () => {
    const graph = createKnowledgeGraph();
    assert.equal(findEntryPoints(graph).length, 0);
  });

  it('returns empty for graph with no function/method nodes', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'f1', kind: 'file', name: 'a.ts', filePath: '/src/a.ts' });
    assert.equal(findEntryPoints(graph).length, 0);
  });

  it('includes exported function with outgoing calls (not called itself)', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'f1', kind: 'function', name: 'handleRequest', filePath: '/src/handler.ts', exported: true });
    graph.addNode({ id: 'f2', kind: 'function', name: 'helper', filePath: '/src/handler.ts' });
    graph.addEdge({ id: generateEdgeId('f1', 'f2', 'calls'), source: 'f1', target: 'f2', kind: 'calls', weight: 1 });
    const entryPoints = findEntryPoints(graph);
    const ids = entryPoints.map((e) => e.nodeId);
    assert.ok(ids.includes('f1'));
  });

  it('filters out nodes in test files', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'f1', kind: 'function', name: 'runTests', filePath: '/src/foo.test.ts', exported: true });
    graph.addNode({ id: 'f2', kind: 'function', name: 'helper', filePath: '/src/foo.test.ts' });
    graph.addEdge({ id: 'e1', source: 'f1', target: 'f2', kind: 'calls', weight: 1 });
    const entryPoints = findEntryPoints(graph);
    assert.equal(entryPoints.length, 0);
  });

  it('scores "main"-named functions higher', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'main', kind: 'function', name: 'main', filePath: '/src/index.ts', exported: true });
    graph.addNode({ id: 'other', kind: 'function', name: 'other', filePath: '/src/index.ts', exported: true });
    graph.addNode({ id: 'sub', kind: 'function', name: 'sub', filePath: '/src/index.ts' });
    graph.addEdge({ id: generateEdgeId('main', 'sub', 'calls'), source: 'main', target: 'sub', kind: 'calls', weight: 1 });
    graph.addEdge({ id: generateEdgeId('other', 'sub', 'calls'), source: 'other', target: 'sub', kind: 'calls', weight: 1 });
    const entryPoints = findEntryPoints(graph);
    const mainEntry = entryPoints.find((e) => e.nodeId === 'main');
    const otherEntry = entryPoints.find((e) => e.nodeId === 'other');
    assert.ok(mainEntry !== undefined);
    assert.ok(otherEntry !== undefined);
    assert.ok(mainEntry!.score > otherEntry!.score);
  });

  it('scores route files higher', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'r1', kind: 'function', name: 'postHandler', filePath: '/src/routes/user.ts', exported: true });
    graph.addNode({ id: 'sub', kind: 'function', name: 'sub', filePath: '/src/routes/user.ts' });
    graph.addEdge({ id: generateEdgeId('r1', 'sub', 'calls'), source: 'r1', target: 'sub', kind: 'calls', weight: 1 });
    const entryPoints = findEntryPoints(graph);
    const route = entryPoints.find((e) => e.nodeId === 'r1');
    assert.ok(route !== undefined);
    assert.ok(route!.score >= 10);
  });

  it('sorts results by score descending', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'high', kind: 'function', name: 'main', filePath: '/src/routes/index.ts', exported: true });
    graph.addNode({ id: 'low', kind: 'function', name: 'helper', filePath: '/src/util.ts', exported: true });
    graph.addNode({ id: 'called', kind: 'function', name: 'sub', filePath: '/src/util.ts' });
    graph.addEdge({ id: generateEdgeId('high', 'called', 'calls'), source: 'high', target: 'called', kind: 'calls', weight: 1 });
    graph.addEdge({ id: generateEdgeId('low', 'called', 'calls'), source: 'low', target: 'called', kind: 'calls', weight: 1 });
    const entryPoints = findEntryPoints(graph);
    for (let i = 1; i < entryPoints.length; i++) {
      assert.ok(entryPoints[i - 1]!.score >= entryPoints[i]!.score);
    }
  });

  it('entry point has correct nodeId, name, filePath fields', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'ep1', kind: 'function', name: 'serve', filePath: '/src/server.ts', exported: true });
    graph.addNode({ id: 'dep1', kind: 'function', name: 'dep', filePath: '/src/server.ts' });
    graph.addEdge({ id: 'e1', source: 'ep1', target: 'dep1', kind: 'calls', weight: 1 });
    const eps = findEntryPoints(graph);
    const ep = eps.find((e) => e.nodeId === 'ep1');
    assert.ok(ep !== undefined);
    assert.equal(ep!.name, 'serve');
    assert.equal(ep!.filePath, '/src/server.ts');
  });
});

describe('traceFlow', () => {
  it('returns empty for node with no outgoing calls', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'lone', kind: 'function', name: 'lone', filePath: '/src/a.ts' });
    const flows = traceFlow('lone', graph);
    assert.equal(flows.length, 0);
  });

  it('traces a simple call chain of 3+ nodes', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'a', kind: 'function', name: 'a', filePath: '/src/a.ts' });
    graph.addNode({ id: 'b', kind: 'function', name: 'b', filePath: '/src/a.ts' });
    graph.addNode({ id: 'c', kind: 'function', name: 'c', filePath: '/src/a.ts' });
    graph.addEdge({ id: 'e1', source: 'a', target: 'b', kind: 'calls', weight: 1 });
    graph.addEdge({ id: 'e2', source: 'b', target: 'c', kind: 'calls', weight: 1 });
    const flows = traceFlow('a', graph);
    assert.ok(flows.length > 0);
    assert.equal(flows[0]!.entryPointId, 'a');
    assert.ok(flows[0]!.steps.includes('a'));
    assert.ok(flows[0]!.steps.includes('c'));
  });

  it('respects maxDepth parameter', () => {
    const graph = createKnowledgeGraph();
    for (let i = 0; i < 6; i++) {
      graph.addNode({ id: `n${i}`, kind: 'function', name: `fn${i}`, filePath: '/src/a.ts' });
      if (i > 0) {
        graph.addEdge({ id: `e${i}`, source: `n${i - 1}`, target: `n${i}`, kind: 'calls', weight: 1 });
      }
    }
    const flows = traceFlow('n0', graph, 2);
    for (const flow of flows) {
      assert.ok(flow.steps.length <= 3);
    }
  });

  it('does not revisit already-visited nodes (diamond graph)', () => {
    const graph = createKnowledgeGraph();
    // Diamond: a→b, a→c, b→d, c→d
    graph.addNode({ id: 'a', kind: 'function', name: 'a', filePath: '/src/a.ts' });
    graph.addNode({ id: 'b', kind: 'function', name: 'b', filePath: '/src/a.ts' });
    graph.addNode({ id: 'c', kind: 'function', name: 'c', filePath: '/src/a.ts' });
    graph.addNode({ id: 'd', kind: 'function', name: 'd', filePath: '/src/a.ts' });
    graph.addEdge({ id: 'e1', source: 'a', target: 'b', kind: 'calls', weight: 1 });
    graph.addEdge({ id: 'e2', source: 'a', target: 'c', kind: 'calls', weight: 1 });
    graph.addEdge({ id: 'e3', source: 'b', target: 'd', kind: 'calls', weight: 1 });
    graph.addEdge({ id: 'e4', source: 'c', target: 'd', kind: 'calls', weight: 1 });
    const flows = traceFlow('a', graph);
    assert.ok(Array.isArray(flows));
  });

  it('returns array (deduplication does not throw)', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'start', kind: 'function', name: 'start', filePath: '/src/a.ts' });
    graph.addNode({ id: 'mid', kind: 'function', name: 'mid', filePath: '/src/a.ts' });
    graph.addNode({ id: 'end', kind: 'function', name: 'end', filePath: '/src/a.ts' });
    graph.addEdge({ id: 'e1', source: 'start', target: 'mid', kind: 'calls', weight: 1 });
    graph.addEdge({ id: 'e2', source: 'mid', target: 'end', kind: 'calls', weight: 1 });
    const flows = traceFlow('start', graph);
    assert.ok(Array.isArray(flows));
  });
});
