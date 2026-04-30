import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { KnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { computeHealthReport } from '../../../src/query/health-report.js';
import type { HealthReportResult } from '../../../src/query/health-report.js';

function buildTestGraph(): KnowledgeGraph {
  const graph = createKnowledgeGraph();

  // src/auth/ scope
  graph.addNode({ id: 'authFn', kind: 'function', name: 'authenticate', filePath: 'src/auth/core.ts', exported: true });
  graph.addNode({ id: 'deadAuthFn', kind: 'function', name: 'legacyAuth', filePath: 'src/auth/legacy.ts', exported: false });
  graph.addNode({ id: 'authClass', kind: 'class', name: 'AuthService', filePath: 'src/auth/service.ts', exported: false });

  // src/api/ scope
  graph.addNode({ id: 'apiFn', kind: 'function', name: 'handleRequest', filePath: 'src/api/handler.ts', exported: true });
  graph.addNode({ id: 'deadApiFn', kind: 'function', name: 'unusedHelper', filePath: 'src/api/utils.ts', exported: false });

  // src/util/ — all nodes are orphans (no edges)
  graph.addNode({ id: 'orphan1', kind: 'function', name: 'orphanFn', filePath: 'src/util/orphan.ts' });

  // Connect authFn → apiFn (calls)
  graph.addEdge({ id: 'e1', source: 'authFn', target: 'apiFn', kind: 'calls' });

  // AuthService has incoming edge (not dead code)
  graph.addEdge({ id: 'e2', source: 'apiFn', target: 'authClass', kind: 'calls' });

  // Import cycle: authFn imports deadAuthFn imports authFn
  graph.addEdge({ id: 'e3', source: 'authFn', target: 'deadAuthFn', kind: 'imports' });
  graph.addEdge({ id: 'e4', source: 'deadAuthFn', target: 'authFn', kind: 'imports' });

  // God node: a node with many outgoing edges
  graph.addNode({ id: 'godNode', kind: 'class', name: 'GodClass', filePath: 'src/core/god.ts' });
  for (let i = 0; i < 12; i++) {
    graph.addNode({ id: `dep${i}`, kind: 'function', name: `dep${i}`, filePath: `src/deps/dep${i}.ts` });
    graph.addEdge({ id: `eGod${i}`, source: 'godNode', target: `dep${i}`, kind: 'calls' });
  }

  return graph;
}

function buildCleanGraph(): KnowledgeGraph {
  const graph = createKnowledgeGraph();
  // Fully connected graph, no dead code, no cycles
  graph.addNode({ id: 'a', kind: 'function', name: 'funcA', filePath: 'src/a.ts', exported: true });
  graph.addNode({ id: 'b', kind: 'function', name: 'funcB', filePath: 'src/b.ts', exported: true });
  graph.addEdge({ id: 'eab', source: 'a', target: 'b', kind: 'calls' });
  return graph;
}

describe('computeHealthReport', () => {
  it('scope filter limits dead code to that directory', () => {
    const graph = buildTestGraph();
    const result = computeHealthReport(graph, 'src/api/') as HealthReportResult;

    // Only nodes in src/api/ should appear
    for (const dc of result.deadCode) {
      assert.ok(
        dc.filePath.startsWith('src/api/'),
        `Dead code filePath should start with src/api/, got: ${dc.filePath}`,
      );
    }
    // unusedHelper is dead code in src/api/
    const hasUnused = result.deadCode.some((dc) => dc.name === 'unusedHelper');
    assert.ok(hasUnused, 'unusedHelper should be detected as dead code in src/api/ scope');
  });

  it('scope "." returns whole-repo health including all nodes', () => {
    const graph = buildTestGraph();
    const result = computeHealthReport(graph, '.') as HealthReportResult;

    // Should detect the god node across the whole repo
    const godFound = result.godNodes.some((gn) => gn.name === 'GodClass');
    assert.ok(godFound, 'GodClass should be detected as a god node in whole-repo scope');
  });

  it('dead code detection: unexported nodes with no incoming edges', () => {
    const graph = buildTestGraph();
    const result = computeHealthReport(graph, '.') as HealthReportResult;

    const deadNames = result.deadCode.map((d) => d.name);
    // legacyAuth is unexported and has only incoming from a cycle partner, but
    // deadAuthFn has an incoming imports edge from authFn — so NOT dead.
    // unusedHelper has no incoming edges and is not exported → dead
    assert.ok(deadNames.includes('unusedHelper'), 'unusedHelper should be dead code');
    // AuthService has an incoming call from apiFn → not dead
    assert.ok(!deadNames.includes('AuthService'), 'AuthService should not be dead code (has callers)');
  });

  it('score is 100 when no issues', () => {
    const graph = buildCleanGraph();
    const result = computeHealthReport(graph, '.') as HealthReportResult;

    assert.equal(result.deadCode.length, 0, 'should have no dead code');
    assert.equal(result.cycles.length, 0, 'should have no cycles');
    assert.equal(result.godNodes.length, 0, 'should have no god nodes');
    assert.equal(result.healthScore, 100, 'health score should be 100');
  });

  it('god nodes detected for nodes with > 10 outgoing edges', () => {
    const graph = buildTestGraph();
    const result = computeHealthReport(graph, '.') as HealthReportResult;

    const godNodeNames = result.godNodes.map((gn) => gn.name);
    assert.ok(godNodeNames.includes('GodClass'), 'GodClass should be in godNodes');
    const godEntry = result.godNodes.find((gn) => gn.name === 'GodClass');
    assert.ok(godEntry!.edgeCount > 10, `GodClass edgeCount should be > 10, got ${godEntry!.edgeCount}`);
  });

  it('cycles detected in import graph', () => {
    const graph = buildTestGraph();
    const result = computeHealthReport(graph, 'src/auth/') as HealthReportResult;

    assert.ok(result.cycles.length > 0, 'should detect import cycles in src/auth/');
    // The cycle should involve both authenticate and legacyAuth
    const cycleFlat = result.cycles.flat();
    assert.ok(
      cycleFlat.includes('authenticate') || cycleFlat.includes('legacyAuth'),
      `cycle should include authenticate or legacyAuth, got: ${JSON.stringify(result.cycles)}`,
    );
  });

  it('health score decreases with dead code and god nodes', () => {
    const graph = buildTestGraph();
    const result = computeHealthReport(graph, '.') as HealthReportResult;

    assert.ok(result.healthScore < 100, 'health score should be below 100 with issues');
    assert.ok(result.healthScore >= 0, 'health score should be >= 0');
  });

  it('orphan files contain files with no edges at all', () => {
    const graph = buildTestGraph();
    const result = computeHealthReport(graph, '.') as HealthReportResult;

    // orphanFn in src/util/orphan.ts has no edges
    assert.ok(
      result.orphanFiles.includes('src/util/orphan.ts'),
      `orphanFiles should include src/util/orphan.ts, got: ${JSON.stringify(result.orphanFiles)}`,
    );
  });

  it('complexity hotspots returns at most 5 entries', () => {
    const graph = buildTestGraph();
    const result = computeHealthReport(graph, '.') as HealthReportResult;

    assert.ok(result.complexityHotspots.length <= 5, 'should return at most 5 complexity hotspots');
  });

  it('dead code list capped at 20', () => {
    const graph = createKnowledgeGraph();
    // Create 25 unexported functions with no edges
    for (let i = 0; i < 25; i++) {
      graph.addNode({ id: `fn${i}`, kind: 'function', name: `fn${i}`, filePath: `src/dead/fn${i}.ts`, exported: false });
    }
    const result = computeHealthReport(graph, '.') as HealthReportResult;
    assert.ok(result.deadCode.length <= 20, 'dead code list should be capped at 20');
  });
});
