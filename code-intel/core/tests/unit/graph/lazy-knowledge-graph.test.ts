import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LazyKnowledgeGraph, isLazyGraph } from '../../../src/graph/lazy-knowledge-graph.js';
import type { CodeNode, CodeEdge } from '../../../src/shared/index.js';

// ── Minimal mock DbManager ────────────────────────────────────────────────────

function makeNode(id: string, name: string, kind = 'function'): CodeNode {
  return { id, kind: kind as CodeNode['kind'], name, filePath: `${name}.ts` };
}

function makeEdge(source: string, target: string, kind = 'calls'): CodeEdge {
  return {
    id: `${source}::${kind}::${target}`,
    source,
    target,
    kind: kind as CodeEdge['kind'],
    weight: 1,
  };
}

/**
 * Fake DbManager whose `query()` returns pre-seeded rows.
 */
function makeMockDb(
  nodes: CodeNode[],
  edges: CodeEdge[],
): import('../../../src/storage/db-manager.js').DbManager {
  return {
    isOpen: true,
    async init() {},
    close() {},
    async execute() {},
    async query(cypher: string) {
      // COUNT query for getTableNodeCounts
      const countMatch = cypher.match(/MATCH \(n:(\w+)\) RETURN count\(n\)/i);
      if (countMatch) {
        const table = countMatch[1]!;
        const tableToKind: Record<string, string> = {
          func_nodes: 'function',
          class_nodes: 'class',
          method_nodes: 'method',
          file_nodes: 'file',
          iface_nodes: 'interface',
          var_nodes: 'variable',
        };
        const kind = tableToKind[table];
        const cnt = kind ? nodes.filter((n) => n.kind === kind).length : 0;
        return [{ cnt }];
      }
      // Edge query
      if (cypher.includes('code_edges')) {
        return edges.map((e) => ({
          'a.id': e.source,
          'b.id': e.target,
          'e.kind': e.kind,
          'e.weight': e.weight ?? null,
          'e.label': e.label ?? null,
        }));
      }
      // Node query — extract table name (e.g. MATCH (n:func_nodes {id: '...'})
      const idMatch = cypher.match(/\{id:\s*'([^']+)'\}/);
      if (idMatch) {
        const id = idMatch[1];
        const node = nodes.find((n) => n.id === id);
        if (!node) return [];
        return [
          {
            'n.id': node.id,
            'n.name': node.name,
            'n.file_path': node.filePath,
            'n.start_line': node.startLine ?? null,
            'n.end_line': node.endLine ?? null,
            'n.exported': node.exported ?? null,
            'n.content': node.content ?? null,
            'n.metadata': node.metadata ? JSON.stringify(node.metadata) : null,
          },
        ];
      }
      // Bulk MATCH (n:table) with optional SKIP/LIMIT — return nodes for that table
      const tableMatch = cypher.match(/MATCH \(n:(\w+)\)/);
      if (tableMatch) {
        const table = tableMatch[1]!;
        // Map table name back to kind
        const tableToKind: Record<string, string> = {
          func_nodes: 'function',
          class_nodes: 'class',
          method_nodes: 'method',
          file_nodes: 'file',
          iface_nodes: 'interface',
          var_nodes: 'variable',
        };
        const kind = tableToKind[table];
        if (!kind) return [];

        // Parse SKIP and LIMIT from cypher
        const skipMatch = cypher.match(/SKIP\s+(\d+)/i);
        const limitMatch = cypher.match(/LIMIT\s+(\d+)/i);
        const skip = skipMatch ? parseInt(skipMatch[1]!, 10) : 0;
        const limit = limitMatch ? parseInt(limitMatch[1]!, 10) : Infinity;

        return nodes
          .filter((n) => n.kind === kind)
          .slice(skip, skip + limit)
          .map((n) => ({
            'n.id': n.id,
            'n.name': n.name,
            'n.file_path': n.filePath,
            'n.start_line': n.startLine ?? null,
            'n.end_line': n.endLine ?? null,
            'n.exported': n.exported ?? null,
            'n.content': n.content ?? null,
            'n.metadata': n.metadata ? JSON.stringify(n.metadata) : null,
          }));
      }
      return [];
    },
  } as unknown as import('../../../src/storage/db-manager.js').DbManager;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LazyKnowledgeGraph', () => {
  describe('isLazyGraph type guard', () => {
    it('returns true for LazyKnowledgeGraph', () => {
      const g = new LazyKnowledgeGraph();
      assert.ok(isLazyGraph(g));
    });

    it('returns false for a plain object', () => {
      const notLazy = { lazy: false, size: { nodes: 0, edges: 0 } };
      assert.ok(!isLazyGraph(notLazy as never));
    });
  });

  describe('init — loads edges, NOT nodes', () => {
    it('edges are populated after init; cache is empty', async () => {
      const nodes = [makeNode('function:a.ts:foo', 'foo'), makeNode('function:b.ts:bar', 'bar')];
      const edges = [makeEdge('function:a.ts:foo', 'function:b.ts:bar')];
      const db = makeMockDb(nodes, edges);

      const g = new LazyKnowledgeGraph();
      await g.init(db, 2, 1);

      // Size returns meta counts for nodes
      assert.equal(g.size.nodes, 2);
      assert.equal(g.size.edges, 1);

      // Cache is empty — no node queries fired at init
      assert.equal([...g.allNodes()].length, 0, 'cache should be empty after init');

      // Edge is present
      const edgeList = [...g.allEdges()];
      assert.equal(edgeList.length, 1);
      assert.equal(edgeList[0]!.kind, 'calls');
    });
  });

  describe('getNode — cache miss', () => {
    it('returns undefined from sync getNode if not cached', async () => {
      const nodes = [makeNode('function:a.ts:foo', 'foo')];
      const db = makeMockDb(nodes, []);
      const g = new LazyKnowledgeGraph();
      await g.init(db, 1, 0);

      // Sync getNode — cache miss
      assert.equal(g.getNode('function:a.ts:foo'), undefined);
    });
  });

  describe('getNodeAsync — fetches from DB on cache miss', () => {
    it('fetches from DB and caches the result', async () => {
      const nodes = [makeNode('function:a.ts:foo', 'foo')];
      const db = makeMockDb(nodes, []);
      const g = new LazyKnowledgeGraph();
      await g.init(db, 1, 0);

      const node = await g.getNodeAsync('function:a.ts:foo');
      assert.ok(node, 'should return node from DB');
      assert.equal(node.name, 'foo');
      assert.equal(node.kind, 'function');

      // Second call returns from cache (sync getNode works now)
      assert.ok(g.getNode('function:a.ts:foo'), 'should be in LRU cache after first async fetch');
    });

    it('returns undefined for missing node', async () => {
      const db = makeMockDb([], []);
      const g = new LazyKnowledgeGraph();
      await g.init(db, 0, 0);
      const node = await g.getNodeAsync('function:x.ts:missing');
      assert.equal(node, undefined);
    });
  });

  describe('LRU eviction', () => {
    it('evicts least-recently-used node when cache exceeds limit', () => {
      // Override env only for this test
      const orig = process.env['GRAPH_CACHE_SIZE'];
      process.env['GRAPH_CACHE_SIZE'] = '3';
      const g = new LazyKnowledgeGraph();

      // Add 3 nodes
      g.addNode(makeNode('n1', 'n1'));
      g.addNode(makeNode('n2', 'n2'));
      g.addNode(makeNode('n3', 'n3'));
      assert.equal([...g.allNodes()].length, 3);

      // Adding a 4th should evict n1 (LRU)
      g.addNode(makeNode('n4', 'n4'));
      assert.equal(g.getNode('n1'), undefined, 'n1 should have been evicted');
      assert.ok(g.getNode('n4'), 'n4 should be in cache');

      process.env['GRAPH_CACHE_SIZE'] = orig ?? '';
    });
  });

  describe('getNodePage — paginated streaming', () => {
    it('returns correct slice of nodes', async () => {
      const nodes = [
        makeNode('function:a.ts:f1', 'f1'),
        makeNode('function:b.ts:f2', 'f2'),
        makeNode('function:c.ts:f3', 'f3'),
      ];
      const db = makeMockDb(nodes, []);
      const g = new LazyKnowledgeGraph();
      await g.init(db, 3, 0);

      const page = await g.getNodePage(0, 2);
      assert.equal(page.length, 2);

      const page2 = await g.getNodePage(2, 2);
      assert.equal(page2.length, 1);
    });
  });

  describe('addNode / addEdge (serve-time mutations)', () => {
    it('addNode increments node count', () => {
      const g = new LazyKnowledgeGraph();
      g.addNode(makeNode('n1', 'foo'));
      assert.equal(g.size.nodes, 1);
    });

    it('addEdge is indexed and retrievable', async () => {
      const g = new LazyKnowledgeGraph();
      const db = makeMockDb([], [makeEdge('n1', 'n2', 'imports')]);
      await g.init(db, 0, 0);

      const edgesFrom = [...g.findEdgesFrom('n1')];
      assert.equal(edgesFrom.length, 1);
      assert.equal(edgesFrom[0]!.kind, 'imports');

      const edgesTo = [...g.findEdgesTo('n2')];
      assert.equal(edgesTo.length, 1);
    });
  });

  describe('warmTopNodes — background warm', () => {
    it('loads top nodes into cache without throwing', async () => {
      const nodes = [
        makeNode('function:a.ts:a', 'a'),
        makeNode('function:b.ts:b', 'b'),
      ];
      const edges = [
        makeEdge('function:a.ts:a', 'function:b.ts:b'),
        makeEdge('function:a.ts:a', 'function:b.ts:b'), // duplicate key ignored
      ];
      const db = makeMockDb(nodes, edges);
      const g = new LazyKnowledgeGraph();
      await g.init(db, 2, 2);

      // Should not throw
      await g.warmTopNodes(5);

      // 'a' has highest outgoing edge count — should be in cache
      assert.ok(g.getNode('function:a.ts:a'), 'top node should be warmed into cache');
    });
  });

  describe('findEdgesByKind / findEdgesFrom / findEdgesTo', () => {
    it('edge indexes are correct after init', async () => {
      const edges = [
        makeEdge('n1', 'n2', 'calls'),
        makeEdge('n1', 'n3', 'imports'),
      ];
      const db = makeMockDb([], edges);
      const g = new LazyKnowledgeGraph();
      await g.init(db, 0, 2);

      const calls = [...g.findEdgesByKind('calls')];
      assert.equal(calls.length, 1);

      const fromN1 = [...g.findEdgesFrom('n1')];
      assert.equal(fromN1.length, 2);

      const toN2 = [...g.findEdgesTo('n2')];
      assert.equal(toN2.length, 1);
    });
  });

  describe('clear', () => {
    it('resets everything', async () => {
      const nodes = [makeNode('function:a.ts:foo', 'foo')];
      const edges = [makeEdge('function:a.ts:foo', 'function:b.ts:bar')];
      const db = makeMockDb(nodes, edges);
      const g = new LazyKnowledgeGraph();
      await g.init(db, 1, 1);

      g.clear();
      assert.equal(g.size.nodes, 0);
      assert.equal(g.size.edges, 0);
      assert.equal([...g.allEdges()].length, 0);
    });
  });
});
