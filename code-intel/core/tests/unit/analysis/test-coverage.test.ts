import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { computeCoverage } from '../../../src/analysis/test-coverage.js';

describe('computeCoverage', () => {
  it('node imported by a test file is marked as tested', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn1', kind: 'function', name: 'myFunc', filePath: 'src/utils.ts', exported: true });
    graph.addNode({ id: 'testFn', kind: 'function', name: 'testMyFunc', filePath: 'src/utils.test.ts' });
    graph.addEdge({ id: 'e1', source: 'testFn', target: 'fn1', kind: 'imports' });

    const summary = computeCoverage(graph);
    assert.equal(summary.totalExported, 1);
    assert.equal(summary.testedExported, 1);
    assert.equal(summary.coveragePct, 100);
    assert.equal(summary.untestedByRisk.length, 0);
  });

  it('exported node with no test coverage appears in untestedByRisk', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn1', kind: 'function', name: 'untestedFn', filePath: 'src/core.ts', exported: true });

    const summary = computeCoverage(graph);
    assert.equal(summary.totalExported, 1);
    assert.equal(summary.testedExported, 0);
    assert.equal(summary.coveragePct, 0);
    assert.equal(summary.untestedByRisk.length, 1);
    assert.equal(summary.untestedByRisk[0].name, 'untestedFn');
  });

  it('tested function does NOT appear in untestedByRisk', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn1', kind: 'function', name: 'testedFn', filePath: 'src/core.ts', exported: true });
    graph.addNode({ id: 'test1', kind: 'function', name: 'testTestedFn', filePath: 'src/__tests__/core.ts' });
    graph.addEdge({ id: 'e1', source: 'test1', target: 'fn1', kind: 'imports' });

    const summary = computeCoverage(graph);
    assert.equal(summary.untestedByRisk.length, 0);
    const tested = summary.untestedByRisk.find((r) => r.name === 'testedFn');
    assert.equal(tested, undefined);
  });

  it('coverage percentage calculated correctly', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn1', kind: 'function', name: 'fn1', filePath: 'src/a.ts', exported: true });
    graph.addNode({ id: 'fn2', kind: 'function', name: 'fn2', filePath: 'src/b.ts', exported: true });
    graph.addNode({ id: 'fn3', kind: 'function', name: 'fn3', filePath: 'src/c.ts', exported: true });
    graph.addNode({ id: 'fn4', kind: 'function', name: 'fn4', filePath: 'src/d.ts', exported: true });
    // test file imports fn1 and fn2
    graph.addNode({ id: 'testNode', kind: 'function', name: 'testAll', filePath: 'src/all.test.ts' });
    graph.addEdge({ id: 'e1', source: 'testNode', target: 'fn1', kind: 'imports' });
    graph.addEdge({ id: 'e2', source: 'testNode', target: 'fn2', kind: 'imports' });

    const summary = computeCoverage(graph);
    assert.equal(summary.totalExported, 4);
    assert.equal(summary.testedExported, 2);
    assert.equal(summary.coveragePct, 50);
    assert.equal(summary.untestedByRisk.length, 2);
  });

  it('sorted by blast radius (highest first)', () => {
    const graph = createKnowledgeGraph();
    // fn1 has many callers (higher blast radius)
    graph.addNode({ id: 'fn1', kind: 'function', name: 'hotFn', filePath: 'src/a.ts', exported: true });
    graph.addNode({ id: 'fn2', kind: 'function', name: 'coldFn', filePath: 'src/b.ts', exported: true });
    // Add 25 callers to fn1 to push blast radius > 20
    for (let i = 0; i < 25; i++) {
      graph.addNode({ id: `caller${i}`, kind: 'function', name: `caller${i}`, filePath: `src/caller${i}.ts` });
      graph.addEdge({ id: `ec${i}`, source: `caller${i}`, target: 'fn1', kind: 'calls' });
    }

    const summary = computeCoverage(graph);
    assert.ok(summary.untestedByRisk.length >= 2);
    // hotFn should appear first (higher blast radius)
    assert.equal(summary.untestedByRisk[0].name, 'hotFn');
    assert.equal(summary.untestedByRisk[0].risk, 'HIGH');
  });

  it('returns 100 coverage when no exported symbols', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn1', kind: 'function', name: 'privateFn', filePath: 'src/a.ts', exported: false });

    const summary = computeCoverage(graph);
    assert.equal(summary.totalExported, 0);
    assert.equal(summary.coveragePct, 100);
  });

  it('node with tested_by edge is marked as tested', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn1', kind: 'function', name: 'subjectFn', filePath: 'src/subject.ts', exported: true });
    graph.addNode({ id: 'testFn', kind: 'function', name: 'test_subjectFn', filePath: 'tests/subject.test.ts' });
    graph.addEdge({ id: 'e1', source: 'fn1', target: 'testFn', kind: 'tested_by' });

    const summary = computeCoverage(graph);
    assert.equal(summary.testedExported, 1);
    assert.equal(summary.untestedByRisk.length, 0);
  });

  it('scope filter limits to matching path prefix', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn1', kind: 'function', name: 'authFn', filePath: 'src/auth/login.ts', exported: true });
    graph.addNode({ id: 'fn2', kind: 'function', name: 'apiFn', filePath: 'src/api/handler.ts', exported: true });

    const summary = computeCoverage(graph, 'src/auth/');
    assert.equal(summary.totalExported, 1);
    assert.equal(summary.untestedByRisk[0].name, 'authFn');
  });
});
