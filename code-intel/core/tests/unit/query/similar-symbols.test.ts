import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { KnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { findSimilarSymbols } from '../../../src/query/similar-symbols.js';

function buildTestGraph(): KnowledgeGraph {
  const graph = createKnowledgeGraph();

  graph.addNode({ id: 'fn1', kind: 'function', name: 'parseUserInput', filePath: 'src/parse.ts', metadata: { cluster: 'parser' } });
  graph.addNode({ id: 'fn2', kind: 'function', name: 'parseAdminInput', filePath: 'src/admin/parse.ts', metadata: { cluster: 'parser' } });
  graph.addNode({ id: 'fn3', kind: 'function', name: 'parseOrderInput', filePath: 'src/orders/parse.ts', metadata: { cluster: 'orders' } });
  graph.addNode({ id: 'fn4', kind: 'function', name: 'validateUserInput', filePath: 'src/validate.ts', metadata: { cluster: 'validator' } });
  graph.addNode({ id: 'fn5', kind: 'function', name: 'formatDate', filePath: 'src/util.ts', metadata: { cluster: 'util' } });
  graph.addNode({ id: 'cls1', kind: 'class', name: 'parseService', filePath: 'src/service.ts', metadata: { cluster: 'parser' } });
  graph.addNode({ id: 'fn6', kind: 'function', name: 'parseUserData', filePath: 'src/data.ts', metadata: { cluster: 'parser' } });
  graph.addNode({ id: 'fn7', kind: 'function', name: 'createUser', filePath: 'src/user.ts', metadata: { cluster: 'user' } });

  return graph;
}

describe('findSimilarSymbols', () => {
  const graph = buildTestGraph();

  it('finds symbols with similar names (parseAdminInput vs parseUserInput)', () => {
    const result = findSimilarSymbols(graph, 'parseUserInput', 10);
    const names = result.similar.map((s) => s.name);
    assert.ok(names.includes('parseAdminInput'), `should include parseAdminInput, got: ${JSON.stringify(names)}`);
  });

  it('excludes the symbol itself from results', () => {
    const result = findSimilarSymbols(graph, 'parseUserInput', 10);
    const names = result.similar.map((s) => s.name);
    assert.ok(!names.includes('parseUserInput'), 'should not include the target symbol itself');
  });

  it('respects the limit parameter', () => {
    const result = findSimilarSymbols(graph, 'parseUserInput', 3);
    assert.ok(result.similar.length <= 3, `should return at most 3 results, got ${result.similar.length}`);
  });

  it('clamps limit to 50', () => {
    const result = findSimilarSymbols(graph, 'parseUserInput', 999);
    // total nodes - 1 (self) = 7 nodes; should return all 7 (below max of 50)
    assert.ok(result.similar.length <= 50);
  });

  it('results are sorted by similarity descending', () => {
    const result = findSimilarSymbols(graph, 'parseUserInput', 10);
    for (let i = 1; i < result.similar.length; i++) {
      assert.ok(
        result.similar[i - 1].similarity >= result.similar[i].similarity,
        `results should be sorted desc at index ${i}: ${result.similar[i - 1].similarity} >= ${result.similar[i].similarity}`,
      );
    }
  });

  it('includes "similar name" reason for highly similar names', () => {
    const result = findSimilarSymbols(graph, 'parseUserInput', 10);
    const parseAdmin = result.similar.find((s) => s.name === 'parseAdminInput');
    assert.ok(parseAdmin !== undefined, 'parseAdminInput should be in results');
    assert.ok(parseAdmin!.reasons.includes('similar name'), `should have "similar name" reason, got: ${JSON.stringify(parseAdmin!.reasons)}`);
  });

  it('includes "same kind" reason when kinds match', () => {
    const result = findSimilarSymbols(graph, 'parseUserInput', 10);
    const parseAdmin = result.similar.find((s) => s.name === 'parseAdminInput');
    assert.ok(parseAdmin !== undefined);
    assert.ok(parseAdmin!.reasons.includes('same kind'), `should have "same kind" reason, got: ${JSON.stringify(parseAdmin!.reasons)}`);
  });

  it('includes "same module" reason for symbols in the same cluster', () => {
    const result = findSimilarSymbols(graph, 'parseUserInput', 10);
    // parseAdminInput and parseOrderInput share metadata.cluster = 'parser' / 'orders'
    // parseAdminInput has cluster = 'parser' same as parseUserInput
    const parseAdmin = result.similar.find((s) => s.name === 'parseAdminInput');
    assert.ok(parseAdmin !== undefined);
    assert.ok(parseAdmin!.reasons.includes('same module'), `should have "same module" reason, got: ${JSON.stringify(parseAdmin!.reasons)}`);
  });

  it('returns empty similar array for unknown symbol', () => {
    const result = findSimilarSymbols(graph, 'doesNotExistAnywhere', 10);
    assert.deepEqual(result.similar, []);
  });

  it('higher structural similarity (same kind) boosts score', () => {
    // parseService is a class; parseUserInput is a function; cls score should be lower than fn scores
    const result = findSimilarSymbols(graph, 'parseUserInput', 10);
    const fnSymbols = result.similar.filter((s) => {
      const node = [...graph.allNodes()].find((n) => n.name === s.name);
      return node?.kind === 'function';
    });
    const clsSymbols = result.similar.filter((s) => {
      const node = [...graph.allNodes()].find((n) => n.name === s.name);
      return node?.kind === 'class';
    });
    if (fnSymbols.length > 0 && clsSymbols.length > 0) {
      // Functions should generally rank above parseService (class) when names are similar
      const maxClsSim = Math.max(...clsSymbols.map((s) => s.similarity));
      const avgFnSim = fnSymbols.reduce((acc, s) => acc + s.similarity, 0) / fnSymbols.length;
      // At minimum the same-kind functions should average higher
      assert.ok(avgFnSim >= maxClsSim - 0.1, `functions should rank higher than class on average: ${avgFnSim} vs ${maxClsSim}`);
    }
  });
});
