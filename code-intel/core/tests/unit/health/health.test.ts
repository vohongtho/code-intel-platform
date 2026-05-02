import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { detectDeadCode } from '../../../src/health/dead-code.js';
import { detectCircularDeps } from '../../../src/health/circular-deps.js';
import { detectGodNodes } from '../../../src/health/god-nodes.js';
import { detectOrphanFiles } from '../../../src/health/orphan-files.js';
import { computeHealthReport } from '../../../src/health/health-score.js';
import type { CodeNode, CodeEdge } from '../../../src/shared/index.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

let _idCounter = 0;
function makeId(prefix = 'node'): string {
  return `${prefix}-${_idCounter++}`;
}

function fileNode(id: string, filePath: string): CodeNode {
  return { id, kind: 'file', name: filePath, filePath };
}

function fnNode(id: string, name: string, filePath: string, exported = true): CodeNode {
  return { id, kind: 'function', name, filePath, exported };
}

function classNode(id: string, name: string, filePath: string, exported = true): CodeNode {
  return { id, kind: 'class', name, filePath, exported };
}

function methodNode(id: string, name: string, filePath: string): CodeNode {
  return { id, kind: 'method', name, filePath };
}

function edge(id: string, source: string, target: string, kind: CodeEdge['kind']): CodeEdge {
  return { id, source, target, kind };
}

// ── 1. Dead code: exported function with zero callers → flagged ────────────────

describe('detectDeadCode', () => {
  it('flags exported function with zero callers and zero importers', () => {
    const graph = createKnowledgeGraph();
    const fn = fnNode('fn1', 'orphanFn', '/src/utils.ts');
    graph.addNode(fn);

    const results = detectDeadCode(graph);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.nodeId, 'fn1');
    assert.equal(results[0]!.name, 'orphanFn');
  });

  // ── 2. Dead code: exported function with callers → NOT flagged ──────────────

  it('does NOT flag exported function that has callers', () => {
    const graph = createKnowledgeGraph();
    const fn = fnNode('fn2', 'usedFn', '/src/utils.ts');
    // caller is not exported so it won't be checked for dead code itself
    const caller: CodeNode = { id: 'caller1', kind: 'function', name: 'callerFn', filePath: '/src/main.ts', exported: false };
    graph.addNode(fn);
    graph.addNode(caller);
    graph.addEdge(edge('e1', 'caller1', 'fn2', 'calls'));

    const results = detectDeadCode(graph);
    assert.equal(results.length, 0);
  });

  it('does NOT flag exported function that has importers', () => {
    const graph = createKnowledgeGraph();
    const fn = fnNode('fn3', 'importedFn', '/src/utils.ts');
    const importer = fileNode('f1', '/src/main.ts');
    graph.addNode(fn);
    graph.addNode(importer);
    graph.addEdge(edge('e2', 'f1', 'fn3', 'imports'));

    const results = detectDeadCode(graph);
    assert.equal(results.length, 0);
  });

  // ── 3. Dead code: test file function → excluded ─────────────────────────────

  it('excludes exported functions in test files', () => {
    const graph = createKnowledgeGraph();
    const testFn = fnNode('tfn1', 'testHelper', '/src/utils.test.ts');
    graph.addNode(testFn);

    const results = detectDeadCode(graph);
    assert.equal(results.length, 0);
  });

  it('excludes functions in spec files', () => {
    const graph = createKnowledgeGraph();
    const specFn = fnNode('sfn1', 'specHelper', '/src/foo.spec.ts');
    graph.addNode(specFn);

    const results = detectDeadCode(graph);
    assert.equal(results.length, 0);
  });

  it('excludes deprecated exported functions', () => {
    const graph = createKnowledgeGraph();
    const fn: CodeNode = {
      id: 'dfn1',
      kind: 'function',
      name: 'oldFn',
      filePath: '/src/api.ts',
      exported: true,
      metadata: { deprecated: true },
    };
    graph.addNode(fn);

    const results = detectDeadCode(graph);
    assert.equal(results.length, 0);
  });

  it('excludes entry-point functions by name (main, index, etc.)', () => {
    const graph = createKnowledgeGraph();
    const mainFn = fnNode('main1', 'main', '/src/main.ts');
    const indexFn = fnNode('idx1', 'index', '/src/index.ts');
    graph.addNode(mainFn);
    graph.addNode(indexFn);

    const results = detectDeadCode(graph);
    assert.equal(results.length, 0);
  });

  it('does not flag non-exported functions', () => {
    const graph = createKnowledgeGraph();
    const fn: CodeNode = { id: 'nefn1', kind: 'function', name: 'privateFn', filePath: '/src/utils.ts', exported: false };
    graph.addNode(fn);

    const results = detectDeadCode(graph);
    assert.equal(results.length, 0);
  });

  it('sets metadata.health.deadCode = true on flagged nodes', () => {
    const graph = createKnowledgeGraph();
    const fn = fnNode('fn99', 'deadFn', '/src/utils.ts');
    graph.addNode(fn);

    detectDeadCode(graph);

    const node = graph.getNode('fn99')!;
    const health = (node.metadata as Record<string, unknown>)?.['health'] as Record<string, unknown>;
    assert.equal(health?.['deadCode'], true);
  });
});

// ── 4. Cycle: A→B→A imports → both flagged with same cycleId ──────────────────

describe('detectCircularDeps', () => {
  it('detects A→B→A cycle', () => {
    const graph = createKnowledgeGraph();
    const fileA = fileNode('fileA', '/src/a.ts');
    const fileB = fileNode('fileB', '/src/b.ts');
    graph.addNode(fileA);
    graph.addNode(fileB);
    graph.addEdge(edge('e-ab', 'fileA', 'fileB', 'imports'));
    graph.addEdge(edge('e-ba', 'fileB', 'fileA', 'imports'));

    const results = detectCircularDeps(graph);
    assert.equal(results.length, 1);
    assert.ok(results[0]!.members.includes('fileA'));
    assert.ok(results[0]!.members.includes('fileB'));

    // Both nodes should be marked with same cycleId
    const nodeA = graph.getNode('fileA')!;
    const nodeB = graph.getNode('fileB')!;
    const healthA = (nodeA.metadata as Record<string, unknown>)?.['health'] as Record<string, unknown>;
    const healthB = (nodeB.metadata as Record<string, unknown>)?.['health'] as Record<string, unknown>;
    assert.equal(healthA?.['inCycle'], true);
    assert.equal(healthB?.['inCycle'], true);
    assert.equal(healthA?.['cycleId'], healthB?.['cycleId']);
  });

  // ── 5. No cycle: A→B (one direction) → not flagged ─────────────────────────

  it('does NOT flag one-directional import A→B', () => {
    const graph = createKnowledgeGraph();
    const fileA = fileNode('fa1', '/src/a.ts');
    const fileB = fileNode('fb1', '/src/b.ts');
    graph.addNode(fileA);
    graph.addNode(fileB);
    graph.addEdge(edge('e1', 'fa1', 'fb1', 'imports'));

    const results = detectCircularDeps(graph);
    assert.equal(results.length, 0);
  });

  it('handles three-node cycle A→B→C→A', () => {
    const graph = createKnowledgeGraph();
    const fileA = fileNode('fc-a', '/src/a.ts');
    const fileB = fileNode('fc-b', '/src/b.ts');
    const fileC = fileNode('fc-c', '/src/c.ts');
    graph.addNode(fileA);
    graph.addNode(fileB);
    graph.addNode(fileC);
    graph.addEdge(edge('e-abc1', 'fc-a', 'fc-b', 'imports'));
    graph.addEdge(edge('e-abc2', 'fc-b', 'fc-c', 'imports'));
    graph.addEdge(edge('e-abc3', 'fc-c', 'fc-a', 'imports'));

    const results = detectCircularDeps(graph);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.members.length, 3);
  });

  // ── 12. Tarjan SCC: test with 10k-node chain completes in < 100ms ───────────

  it('handles 10k-node chain in under 100ms', () => {
    const graph = createKnowledgeGraph();
    const n = 10000;

    // Create a linear chain: 0→1→2→...→n-1 (no cycles)
    for (let i = 0; i < n; i++) {
      graph.addNode(fileNode(`perf-file-${i}`, `/src/file${i}.ts`));
    }
    for (let i = 0; i < n - 1; i++) {
      graph.addEdge(edge(`perf-e-${i}`, `perf-file-${i}`, `perf-file-${i + 1}`, 'imports'));
    }

    const start = Date.now();
    const results = detectCircularDeps(graph);
    const elapsed = Date.now() - start;

    assert.equal(results.length, 0, 'chain has no cycles');
    assert.ok(elapsed < 100, `Tarjan on 10k nodes took ${elapsed}ms (expected < 100ms)`);
  });

  it('handles 10k-node graph with a cycle at the end in under 100ms', () => {
    const graph = createKnowledgeGraph();
    const n = 10000;

    for (let i = 0; i < n; i++) {
      graph.addNode(fileNode(`perf2-file-${i}`, `/src/file${i}.ts`));
    }
    // Linear chain
    for (let i = 0; i < n - 1; i++) {
      graph.addEdge(edge(`perf2-e-${i}`, `perf2-file-${i}`, `perf2-file-${i + 1}`, 'imports'));
    }
    // Add a back edge to create one cycle at the very end
    graph.addEdge(edge('perf2-back', `perf2-file-${n - 1}`, `perf2-file-${n - 2}`, 'imports'));

    const start = Date.now();
    const results = detectCircularDeps(graph);
    const elapsed = Date.now() - start;

    assert.equal(results.length, 1, 'one cycle expected');
    assert.ok(elapsed < 100, `Tarjan on 10k nodes (with cycle) took ${elapsed}ms (expected < 100ms)`);
  });
});

// ── 6. God class: class with 25 methods → flagged ─────────────────────────────

describe('detectGodNodes', () => {
  it('flags class with more than 20 methods (default threshold)', () => {
    const graph = createKnowledgeGraph();
    const cls = classNode('gc1', 'BigService', '/src/service.ts');
    graph.addNode(cls);

    // Add 25 method members
    for (let i = 0; i < 25; i++) {
      const m = methodNode(`m-gc1-${i}`, `method${i}`, '/src/service.ts');
      graph.addNode(m);
      graph.addEdge(edge(`e-gc1-${i}`, 'gc1', `m-gc1-${i}`, 'has_member'));
    }

    const results = detectGodNodes(graph);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.nodeId, 'gc1');
    assert.ok(results[0]!.reason.includes('25 methods'));
  });

  // ── 7. God class: class with 5 methods → not flagged ───────────────────────

  it('does NOT flag class with only 5 methods', () => {
    const graph = createKnowledgeGraph();
    const cls = classNode('gc2', 'SmallService', '/src/small.ts');
    graph.addNode(cls);

    for (let i = 0; i < 5; i++) {
      const m = methodNode(`m-gc2-${i}`, `method${i}`, '/src/small.ts');
      graph.addNode(m);
      graph.addEdge(edge(`e-gc2-${i}`, 'gc2', `m-gc2-${i}`, 'has_member'));
    }

    const results = detectGodNodes(graph);
    assert.equal(results.length, 0);
  });

  // ── 8. God class: class with 55 callers → flagged ──────────────────────────

  it('flags class with more than 50 callers (default threshold)', () => {
    const graph = createKnowledgeGraph();
    const cls = classNode('gc3', 'PopularService', '/src/popular.ts');
    graph.addNode(cls);

    // Add 55 callers
    for (let i = 0; i < 55; i++) {
      const caller = fnNode(`caller-gc3-${i}`, `caller${i}`, '/src/other.ts');
      graph.addNode(caller);
      graph.addEdge(edge(`e-caller-gc3-${i}`, `caller-gc3-${i}`, 'gc3', 'calls'));
    }

    const results = detectGodNodes(graph);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.nodeId, 'gc3');
    assert.ok(results[0]!.reason.includes('55 callers'));
  });

  it('respects custom maxMethods threshold', () => {
    const graph = createKnowledgeGraph();
    const cls = classNode('gc4', 'SizedService', '/src/sized.ts');
    graph.addNode(cls);

    // Add 12 methods — above custom limit of 10, below default 20
    for (let i = 0; i < 12; i++) {
      const m = methodNode(`m-gc4-${i}`, `method${i}`, '/src/sized.ts');
      graph.addNode(m);
      graph.addEdge(edge(`e-gc4-${i}`, 'gc4', `m-gc4-${i}`, 'has_member'));
    }

    const resultsDefault = detectGodNodes(graph);
    assert.equal(resultsDefault.length, 0, 'should not flag with default threshold 20');

    const resultsCustom = detectGodNodes(graph, { maxMethods: 10 });
    assert.equal(resultsCustom.length, 1, 'should flag with custom threshold 10');
  });

  it('sets metadata.health.isGodNode = true on flagged nodes', () => {
    const graph = createKnowledgeGraph();
    const cls = classNode('gc5', 'GodService', '/src/god.ts');
    graph.addNode(cls);

    for (let i = 0; i < 21; i++) {
      const m = methodNode(`m-gc5-${i}`, `method${i}`, '/src/god.ts');
      graph.addNode(m);
      graph.addEdge(edge(`e-gc5-${i}`, 'gc5', `m-gc5-${i}`, 'has_member'));
    }

    detectGodNodes(graph);
    const node = graph.getNode('gc5')!;
    const health = (node.metadata as Record<string, unknown>)?.['health'] as Record<string, unknown>;
    assert.equal(health?.['isGodNode'], true);
    assert.ok(typeof health?.['godReason'] === 'string');
  });
});

// ── 9. Orphan file: file node with no imports edges → flagged ──────────────────

describe('detectOrphanFiles', () => {
  it('flags file node with no imports in or out', () => {
    const graph = createKnowledgeGraph();
    const f = fileNode('of1', '/src/standalone.ts');
    graph.addNode(f);

    const results = detectOrphanFiles(graph);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.nodeId, 'of1');
  });

  it('does NOT flag file that imports another', () => {
    const graph = createKnowledgeGraph();
    const fa = fileNode('of-fa', '/src/a.ts');
    const fb = fileNode('of-fb', '/src/b.ts');
    graph.addNode(fa);
    graph.addNode(fb);
    graph.addEdge(edge('of-e1', 'of-fa', 'of-fb', 'imports'));

    const results = detectOrphanFiles(graph);
    // fb is imported by fa, so it has incoming imports
    // fa imports fb, so it has outgoing imports
    // neither should be flagged
    assert.equal(results.length, 0);
  });

  it('does NOT flag file that is imported by another', () => {
    const graph = createKnowledgeGraph();
    const fa = fileNode('of-fa2', '/src/a.ts');
    const fb = fileNode('of-fb2', '/src/b.ts');
    graph.addNode(fa);
    graph.addNode(fb);
    graph.addEdge(edge('of-e2', 'of-fa2', 'of-fb2', 'imports'));

    const results = detectOrphanFiles(graph);
    assert.equal(results.length, 0);
  });

  // ── 10. Orphan file: .d.ts file → excluded ─────────────────────────────────

  it('excludes .d.ts declaration files', () => {
    const graph = createKnowledgeGraph();
    const f = fileNode('of-dts', '/src/types.d.ts');
    graph.addNode(f);

    const results = detectOrphanFiles(graph);
    assert.equal(results.length, 0);
  });

  it('excludes config files', () => {
    const graph = createKnowledgeGraph();
    graph.addNode(fileNode('cfg2', '/babel.config.js'));
    graph.addNode(fileNode('cfg3', '/vite.config.ts'));
    graph.addNode(fileNode('cfg4', '/jest.config.ts'));

    const results = detectOrphanFiles(graph);
    assert.equal(results.length, 0);
  });

  it('excludes fixture files', () => {
    const graph = createKnowledgeGraph();
    const f = fileNode('fix1', '/tests/fixtures/data.fixture');
    graph.addNode(f);

    const results = detectOrphanFiles(graph);
    assert.equal(results.length, 0);
  });

  it('excludes mock files', () => {
    const graph = createKnowledgeGraph();
    const f = fileNode('mock1', '/src/__mocks__/api.mock');
    graph.addNode(f);

    const results = detectOrphanFiles(graph);
    assert.equal(results.length, 0);
  });

  it('sets metadata.health.orphan = true on flagged files', () => {
    const graph = createKnowledgeGraph();
    const f = fileNode('of99', '/src/lonely.ts');
    graph.addNode(f);

    detectOrphanFiles(graph);

    const node = graph.getNode('of99')!;
    const health = (node.metadata as Record<string, unknown>)?.['health'] as Record<string, unknown>;
    assert.equal(health?.['orphan'], true);
  });
});

// ── 11. Health score formula ───────────────────────────────────────────────────

describe('computeHealthReport', () => {
  it('computes score: 100 - (deadCode*0.5 + cycles*5 + godNodes*2 + orphans*1)', () => {
    const graph = createKnowledgeGraph();

    // 2 dead code symbols
    graph.addNode(fnNode('dc1', 'deadA', '/src/a.ts'));
    graph.addNode(fnNode('dc2', 'deadB', '/src/b.ts'));

    // 1 cycle (A→B→A between file nodes)
    const fileA = fileNode('cycle-fa', '/src/cycleA.ts');
    const fileB = fileNode('cycle-fb', '/src/cycleB.ts');
    graph.addNode(fileA);
    graph.addNode(fileB);
    graph.addEdge(edge('cycle-e1', 'cycle-fa', 'cycle-fb', 'imports'));
    graph.addEdge(edge('cycle-e2', 'cycle-fb', 'cycle-fa', 'imports'));

    // 1 god node (21 methods) — make it non-exported so it doesn't count as dead code
    const cls: CodeNode = { id: 'god-cls', kind: 'class', name: 'GodCls', filePath: '/src/god.ts', exported: false };
    graph.addNode(cls);
    for (let i = 0; i < 21; i++) {
      const m = methodNode(`god-m-${i}`, `method${i}`, '/src/god.ts');
      graph.addNode(m);
      graph.addEdge(edge(`god-e-${i}`, 'god-cls', `god-m-${i}`, 'has_member'));
    }

    // 1 orphan file
    const orphan = fileNode('orphan-f1', '/src/orphan.ts');
    graph.addNode(orphan);

    const report = computeHealthReport(graph);

    // Expected: 100 - (2*0.5 + 1*5 + 1*2 + 1*1) = 100 - (1 + 5 + 2 + 1) = 100 - 9 = 91
    const expected = 91;
    assert.equal(report.score, expected);
    assert.equal(report.grade, '🟢'); // >= 80
  });

  it('clamps score to 0 on extremely bad graph', () => {
    const graph = createKnowledgeGraph();

    // 200 dead code → 200 * 0.5 = 100 points deducted → score = 0
    for (let i = 0; i < 200; i++) {
      graph.addNode(fnNode(`dead-clamp-${i}`, `fn${i}`, '/src/unused.ts'));
    }

    const report = computeHealthReport(graph);
    assert.equal(report.score, 0);
    assert.equal(report.grade, '🔴');
  });

  it('returns 100 score and green grade for empty graph', () => {
    const graph = createKnowledgeGraph();
    const report = computeHealthReport(graph);
    assert.equal(report.score, 100);
    assert.equal(report.grade, '🟢');
  });

  it('returns 🟡 grade for score in [60, 80)', () => {
    const graph = createKnowledgeGraph();

    // 40 dead code → 40*0.5 = 20 → score = 80 (green, not yellow)
    // Need 41+ to get 79.5 → rounds to yellow
    // Let's use 43 dead code symbols → 43*0.5 = 21.5 → score = 78.5 → yellow
    for (let i = 0; i < 43; i++) {
      graph.addNode(fnNode(`yellow-dead-${i}`, `fn${i}`, `/src/file${i}.ts`));
    }

    const report = computeHealthReport(graph);
    assert.ok(report.score < 80, `score ${report.score} should be < 80`);
    assert.ok(report.score >= 60, `score ${report.score} should be >= 60`);
    assert.equal(report.grade, '🟡');
  });

  it('returns 🔴 grade for score below 60', () => {
    const graph = createKnowledgeGraph();

    // 82 dead code → 82 * 0.5 = 41 → score = 59 → red
    for (let i = 0; i < 82; i++) {
      graph.addNode(fnNode(`red-dead-${i}`, `fn${i}`, `/src/file${i}.ts`));
    }

    const report = computeHealthReport(graph);
    assert.ok(report.score < 60, `score ${report.score} should be < 60`);
    assert.equal(report.grade, '🔴');
  });

  it('populates all report fields', () => {
    const graph = createKnowledgeGraph();
    const report = computeHealthReport(graph);

    assert.ok(Array.isArray(report.deadCode));
    assert.ok(Array.isArray(report.cycles));
    assert.ok(Array.isArray(report.godNodes));
    assert.ok(Array.isArray(report.orphanFiles));
    assert.ok(typeof report.score === 'number');
    assert.ok(['🟢', '🟡', '🔴'].includes(report.grade));
  });
});
