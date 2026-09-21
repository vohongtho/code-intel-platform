import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { loadGraphFromDB } from '../../../src/multi-repo/graph-from-db.js';

function dbWithRows() {
  return {
    async query(cypher: string) {
      if (cypher.includes('MATCH (n:func_nodes)')) {
        return [
          {
            'n.id': 'sym:v2:function:a',
            'n.name': 'caller',
            'n.file_path': 'src/a.ts',
            'n.start_line': 1,
            'n.end_line': 3,
            'n.exported': true,
            'n.content': 'function caller() {}',
            'n.identity_id': 'sym:v2:function:a',
            'n.legacy_ids': JSON.stringify(['function:src/a.ts:caller']),
            'n.metadata': JSON.stringify({ semantic: { qualifiedName: 'src/a.ts:caller' } }),
          },
          {
            'n.id': 'sym:v2:function:b',
            'n.name': 'callee',
            'n.file_path': 'src/b.ts',
            'n.start_line': 1,
            'n.end_line': 3,
            'n.exported': true,
            'n.content': 'function callee() {}',
            'n.identity_id': 'sym:v2:function:b',
            'n.legacy_ids': JSON.stringify(['function:src/b.ts:callee']),
            'n.metadata': JSON.stringify({ semantic: { qualifiedName: 'src/b.ts:callee' } }),
          },
        ];
      }
      if (cypher.includes('MATCH (a)-[e:code_edges]->(b)')) {
        return [
          {
            'a.id': 'sym:v2:function:a',
            'b.id': 'sym:v2:function:b',
            'e.id': 'edge:v2:calls:callsite:v1:1:sym:v2:function:b',
            'e.kind': 'calls',
            'e.weight': 1,
            'e.label': 'callee',
            'e.callsite_id': 'callsite:v1:1',
            'e.metadata': JSON.stringify({ ordinal: 1 }),
          },
          {
            'a.id': 'sym:v2:function:a',
            'b.id': 'sym:v2:function:b',
            'e.id': 'edge:v2:calls:callsite:v1:2:sym:v2:function:b',
            'e.kind': 'calls',
            'e.weight': 1,
            'e.label': 'callee',
            'e.callsite_id': 'callsite:v1:2',
            'e.metadata': JSON.stringify({ ordinal: 2 }),
          },
        ];
      }
      return [];
    },
  };
}

describe('loadGraphFromDB identity metadata', () => {
  it('preserves repeated call sites and identity metadata after reopen', async () => {
    const graph = createKnowledgeGraph();
    await loadGraphFromDB(graph, dbWithRows() as never);

    const nodes = [...graph.allNodes()];
    const edges = [...graph.allEdges()].filter((edge) => edge.kind === 'calls');

    assert.equal(nodes.length, 2);
    assert.equal(nodes[0]?.identityId?.startsWith('sym:v2:'), true);
    assert.deepEqual(nodes[0]?.legacyIds, ['function:src/a.ts:caller']);
    assert.equal(edges.length, 2);
    assert.notEqual(edges[0]?.id, edges[1]?.id);
    assert.notEqual(edges[0]?.callSiteId, edges[1]?.callSiteId);
  });
});
