import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildHeritageEdges } from '../../../src/inheritance/heritage-builder.js';
import { detectOverrides } from '../../../src/inheritance/override-detector.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';

describe('buildHeritageEdges', () => {
  it('creates extends edge', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'parent', kind: 'class', name: 'Animal', filePath: '/src/a.ts' });
    graph.addNode({ id: 'child', kind: 'class', name: 'Dog', filePath: '/src/b.ts' });
    const edges = buildHeritageEdges([
      { classNodeId: 'child', extendsNames: ['Animal'], implementsNames: [] },
    ], graph);
    assert.equal(edges.length, 1);
    assert.equal(edges[0]!.kind, 'extends');
    assert.equal(edges[0]!.source, 'child');
    assert.equal(edges[0]!.target, 'parent');
    assert.ok(edges[0]!.label?.includes('Animal'));
  });

  it('creates implements edge', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'iface', kind: 'interface', name: 'Runnable', filePath: '/src/a.ts' });
    graph.addNode({ id: 'cls', kind: 'class', name: 'Task', filePath: '/src/b.ts' });
    const edges = buildHeritageEdges([
      { classNodeId: 'cls', extendsNames: [], implementsNames: ['Runnable'] },
    ], graph);
    assert.equal(edges.length, 1);
    assert.equal(edges[0]!.kind, 'implements');
    assert.equal(edges[0]!.source, 'cls');
    assert.equal(edges[0]!.target, 'iface');
  });

  it('skips unresolvable names', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'cls', kind: 'class', name: 'Dog', filePath: '/src/b.ts' });
    const edges = buildHeritageEdges([
      { classNodeId: 'cls', extendsNames: ['Unknown'], implementsNames: ['AlsoUnknown'] },
    ], graph);
    assert.equal(edges.length, 0);
  });

  it('handles empty heritages array', () => {
    const graph = createKnowledgeGraph();
    const edges = buildHeritageEdges([], graph);
    assert.equal(edges.length, 0);
  });

  it('creates both extends and implements edges for same class', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'base', kind: 'class', name: 'Base', filePath: '/src/a.ts' });
    graph.addNode({ id: 'iface', kind: 'interface', name: 'IFoo', filePath: '/src/a.ts' });
    graph.addNode({ id: 'cls', kind: 'class', name: 'Derived', filePath: '/src/b.ts' });
    const edges = buildHeritageEdges([
      { classNodeId: 'cls', extendsNames: ['Base'], implementsNames: ['IFoo'] },
    ], graph);
    assert.equal(edges.length, 2);
    assert.ok(edges.some((e) => e.kind === 'extends'));
    assert.ok(edges.some((e) => e.kind === 'implements'));
  });

  it('indexes trait and struct nodes too', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'tr', kind: 'trait', name: 'Serializable', filePath: '/src/a.ts' });
    graph.addNode({ id: 'st', kind: 'struct', name: 'Point', filePath: '/src/b.ts' });
    const edges = buildHeritageEdges([
      { classNodeId: 'st', extendsNames: [], implementsNames: ['Serializable'] },
    ], graph);
    assert.equal(edges.length, 1);
    assert.equal(edges[0]!.kind, 'implements');
  });
});

describe('detectOverrides', () => {
  it('detects overridden method in child class', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'parent-cls', kind: 'class', name: 'Animal', filePath: '/src/a.ts' });
    graph.addNode({ id: 'child-cls', kind: 'class', name: 'Dog', filePath: '/src/b.ts' });
    graph.addNode({ id: 'parent-method', kind: 'method', name: 'speak', filePath: '/src/a.ts' });
    graph.addNode({ id: 'child-method', kind: 'method', name: 'speak', filePath: '/src/b.ts' });
    graph.addEdge({ id: 'hm1', source: 'parent-cls', target: 'parent-method', kind: 'has_member', weight: 1 });
    graph.addEdge({ id: 'hm2', source: 'child-cls', target: 'child-method', kind: 'has_member', weight: 1 });
    graph.addEdge({ id: 'ext1', source: 'child-cls', target: 'parent-cls', kind: 'extends', weight: 1 });
    const edges = detectOverrides(graph);
    assert.equal(edges.length, 1);
    assert.equal(edges[0]!.kind, 'overrides');
    assert.equal(edges[0]!.source, 'child-method');
    assert.equal(edges[0]!.target, 'parent-method');
    assert.ok(edges[0]!.label?.includes('speak'));
  });

  it('returns empty when method names differ (no override)', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'parent-cls', kind: 'class', name: 'Animal', filePath: '/src/a.ts' });
    graph.addNode({ id: 'child-cls', kind: 'class', name: 'Dog', filePath: '/src/b.ts' });
    graph.addNode({ id: 'pm', kind: 'method', name: 'eat', filePath: '/src/a.ts' });
    graph.addNode({ id: 'cm', kind: 'method', name: 'fetch', filePath: '/src/b.ts' });
    graph.addEdge({ id: 'hm1', source: 'parent-cls', target: 'pm', kind: 'has_member', weight: 1 });
    graph.addEdge({ id: 'hm2', source: 'child-cls', target: 'cm', kind: 'has_member', weight: 1 });
    graph.addEdge({ id: 'ext1', source: 'child-cls', target: 'parent-cls', kind: 'extends', weight: 1 });
    const edges = detectOverrides(graph);
    assert.equal(edges.length, 0);
  });

  it('returns empty for empty graph', () => {
    const graph = createKnowledgeGraph();
    const edges = detectOverrides(graph);
    assert.equal(edges.length, 0);
  });

  it('returns empty when child has no methods', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'parent-cls', kind: 'class', name: 'Base', filePath: '/src/a.ts' });
    graph.addNode({ id: 'child-cls', kind: 'class', name: 'Child', filePath: '/src/b.ts' });
    graph.addNode({ id: 'pm', kind: 'method', name: 'doIt', filePath: '/src/a.ts' });
    graph.addEdge({ id: 'hm1', source: 'parent-cls', target: 'pm', kind: 'has_member', weight: 1 });
    graph.addEdge({ id: 'ext1', source: 'child-cls', target: 'parent-cls', kind: 'extends', weight: 1 });
    const edges = detectOverrides(graph);
    assert.equal(edges.length, 0);
  });

  it('detects multiple overrides in same hierarchy', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'pcls', kind: 'class', name: 'Base', filePath: '/src/a.ts' });
    graph.addNode({ id: 'ccls', kind: 'class', name: 'Child', filePath: '/src/b.ts' });
    graph.addNode({ id: 'pm1', kind: 'method', name: 'foo', filePath: '/src/a.ts' });
    graph.addNode({ id: 'pm2', kind: 'method', name: 'bar', filePath: '/src/a.ts' });
    graph.addNode({ id: 'cm1', kind: 'method', name: 'foo', filePath: '/src/b.ts' });
    graph.addNode({ id: 'cm2', kind: 'method', name: 'bar', filePath: '/src/b.ts' });
    graph.addEdge({ id: 'h1', source: 'pcls', target: 'pm1', kind: 'has_member', weight: 1 });
    graph.addEdge({ id: 'h2', source: 'pcls', target: 'pm2', kind: 'has_member', weight: 1 });
    graph.addEdge({ id: 'h3', source: 'ccls', target: 'cm1', kind: 'has_member', weight: 1 });
    graph.addEdge({ id: 'h4', source: 'ccls', target: 'cm2', kind: 'has_member', weight: 1 });
    graph.addEdge({ id: 'ext1', source: 'ccls', target: 'pcls', kind: 'extends', weight: 1 });
    const edges = detectOverrides(graph);
    assert.equal(edges.length, 2);
  });
});
