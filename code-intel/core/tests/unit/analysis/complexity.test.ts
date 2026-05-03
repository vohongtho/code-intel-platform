import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { computeComplexity } from '../../../src/analysis/complexity.js';

describe('computeComplexity', () => {
  it('simple function with no outgoing calls has cyclomatic = 1', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn1', kind: 'function', name: 'simpleFn', filePath: 'src/a.ts' });
    const results = computeComplexity(graph);
    assert.equal(results.length, 1);
    assert.equal(results[0].cyclomatic, 1);
    assert.equal(results[0].severity, 'LOW');
  });

  it('function with 3 outgoing calls has higher complexity', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn1', kind: 'function', name: 'complexFn', filePath: 'src/a.ts' });
    graph.addNode({ id: 'dep1', kind: 'function', name: 'dep1', filePath: 'src/b.ts' });
    graph.addNode({ id: 'dep2', kind: 'function', name: 'dep2', filePath: 'src/b.ts' });
    graph.addNode({ id: 'dep3', kind: 'function', name: 'dep3', filePath: 'src/b.ts' });
    graph.addEdge({ id: 'e1', source: 'fn1', target: 'dep1', kind: 'calls' });
    graph.addEdge({ id: 'e2', source: 'fn1', target: 'dep2', kind: 'calls' });
    graph.addEdge({ id: 'e3', source: 'fn1', target: 'dep3', kind: 'calls' });
    const results = computeComplexity(graph);
    // Only fn1 is returned (dep1/dep2/dep3 are also functions with 0 calls)
    const fn1 = results.find((r) => r.name === 'complexFn');
    assert.ok(fn1, 'complexFn should be in results');
    // 3 outgoing calls: cyclomatic = 1 + floor(3/2) = 2
    assert.equal(fn1!.cyclomatic, 2);
    assert.ok(fn1!.cognitive > fn1!.cyclomatic, 'cognitive should be >= cyclomatic');
  });

  it('uses metadata complexity if present', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'fn1',
      kind: 'function',
      name: 'annotatedFn',
      filePath: 'src/a.ts',
      metadata: { complexity: { cyclomatic: 15, cognitive: 22 } },
    });
    const results = computeComplexity(graph);
    assert.equal(results.length, 1);
    assert.equal(results[0].cyclomatic, 15);
    assert.equal(results[0].cognitive, 22);
    assert.equal(results[0].severity, 'HIGH');
  });

  it('sorted correctly by cyclomatic descending', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'low', kind: 'function', name: 'lowFn', filePath: 'src/a.ts', metadata: { complexity: { cyclomatic: 2, cognitive: 3 } } });
    graph.addNode({ id: 'high', kind: 'function', name: 'highFn', filePath: 'src/a.ts', metadata: { complexity: { cyclomatic: 25, cognitive: 30 } } });
    graph.addNode({ id: 'med', kind: 'method', name: 'medMethod', filePath: 'src/b.ts', metadata: { complexity: { cyclomatic: 8, cognitive: 11 } } });
    const results = computeComplexity(graph);
    assert.equal(results[0].name, 'highFn');
    assert.equal(results[1].name, 'medMethod');
    assert.equal(results[2].name, 'lowFn');
  });

  it('scope filter limits to matching file prefix', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn1', kind: 'function', name: 'inScope', filePath: 'src/auth/core.ts' });
    graph.addNode({ id: 'fn2', kind: 'function', name: 'outOfScope', filePath: 'src/api/handler.ts' });
    const results = computeComplexity(graph, 'src/auth/');
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'inScope');
  });

  it('excludes non-function/method nodes', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'cls', kind: 'class', name: 'SomeClass', filePath: 'src/a.ts' });
    graph.addNode({ id: 'fn', kind: 'function', name: 'someFunc', filePath: 'src/a.ts' });
    const results = computeComplexity(graph);
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'someFunc');
  });

  it('severity thresholds: LOW(1-5), MEDIUM(6-10), HIGH(11-20), CRITICAL(>20)', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'a', kind: 'function', name: 'a', filePath: 'src/a.ts', metadata: { complexity: { cyclomatic: 3, cognitive: 4 } } });
    graph.addNode({ id: 'b', kind: 'function', name: 'b', filePath: 'src/b.ts', metadata: { complexity: { cyclomatic: 8, cognitive: 10 } } });
    graph.addNode({ id: 'c', kind: 'function', name: 'c', filePath: 'src/c.ts', metadata: { complexity: { cyclomatic: 15, cognitive: 20 } } });
    graph.addNode({ id: 'd', kind: 'function', name: 'd', filePath: 'src/d.ts', metadata: { complexity: { cyclomatic: 25, cognitive: 32 } } });
    const results = computeComplexity(graph);
    const bySeverity = Object.fromEntries(results.map((r) => [r.name, r.severity]));
    assert.equal(bySeverity['a'], 'LOW');
    assert.equal(bySeverity['b'], 'MEDIUM');
    assert.equal(bySeverity['c'], 'HIGH');
    assert.equal(bySeverity['d'], 'CRITICAL');
  });
});
