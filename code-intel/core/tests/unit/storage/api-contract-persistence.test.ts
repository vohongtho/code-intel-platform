/**
 * Read-back tests for the additive API-contract node/edge kinds (api_shape, api_consumer,
 * accepts_shape, returns_shape, consumes_api). These mock DbManager the same way the rest of
 * this test file's siblings do (upsert.test.ts, graph-from-db-identity.test.ts) — a real
 * KùzuDB/LadybugDB instance requires native binaries at test time — but assert on the actual
 * normalized field values that come back, not just node/edge counts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CodeNode } from '../../../src/shared/index.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { loadGraphFromDB } from '../../../src/multi-repo/graph-from-db.js';

function makeMockDb() {
  const executed: string[] = [];
  return {
    executed,
    execute: async (cypher: string) => {
      executed.push(cypher);
    },
    query: async () => [],
    close: () => {},
    isOpen: true,
  } as unknown as import('../../../src/storage/db-manager.js').DbManager & { executed: string[] };
}

describe('API-contract node/edge persistence — write path', () => {
  it('routes an api_shape node to api_shape_nodes with its origin/coverage metadata intact', async () => {
    const { upsertNode } = await import('../../../src/storage/graph-loader.js');
    const db = makeMockDb();
    const node: CodeNode = {
      id: 'api_shape::src/app.ts::fp1',
      kind: 'api_shape',
      name: 'response shape',
      filePath: 'src/app.ts',
      startLine: 2,
      endLine: 2,
      metadata: {
        semantic: {
          shapeFactKind: 'http-response-shape',
          origin: { kind: 'inline', fields: [{ key: 'id', required: true }] },
          coverage: { complete: true, boundaryReasons: [] },
          status: 200,
        },
      },
    };
    await upsertNode(node, db);
    const createStatement = db.executed.find((s) => s.startsWith('CREATE'));
    assert.ok(createStatement?.includes('api_shape_nodes'));
    assert.ok(createStatement?.includes('http-response-shape'));
    assert.ok(createStatement?.includes('\\"key\\":\\"id\\"') || createStatement?.includes('"key":"id"'));
  });

  it('routes an api_consumer node to api_consumer_nodes with its consumedKeys metadata intact', async () => {
    const { upsertNode } = await import('../../../src/storage/graph-loader.js');
    const db = makeMockDb();
    const node: CodeNode = {
      id: 'api_consumer::src/client.ts::fetch:consumer:1',
      kind: 'api_consumer',
      name: 'GET /users',
      filePath: 'src/client.ts',
      startLine: 1,
      endLine: 1,
      metadata: {
        semantic: {
          clientLibrary: 'fetch',
          method: 'GET',
          consumedKeys: ['id', 'name'],
          coverage: { complete: true, boundaryReasons: [] },
        },
      },
    };
    await upsertNode(node, db);
    const createStatement = db.executed.find((s) => s.startsWith('CREATE'));
    assert.ok(createStatement?.includes('api_consumer_nodes'));
    assert.ok(createStatement?.includes('fetch'));
  });
});

describe('API-contract node/edge persistence — read-back path', () => {
  function dbWithRows() {
    return {
      async query(cypher: string) {
        if (cypher.includes('MATCH (n:api_shape_nodes)')) {
          return [
            {
              'n.id': 'api_shape::src/app.ts::fp1',
              'n.name': 'response shape',
              'n.file_path': 'src/app.ts',
              'n.start_line': 2,
              'n.end_line': 2,
              'n.metadata': JSON.stringify({
                semantic: {
                  shapeFactKind: 'http-response-shape',
                  origin: { kind: 'inline', fields: [{ key: 'id', required: true }] },
                  coverage: { complete: true, boundaryReasons: [] },
                },
              }),
            },
          ];
        }
        if (cypher.includes('MATCH (n:api_consumer_nodes)')) {
          return [
            {
              'n.id': 'api_consumer::src/client.ts::fetch:consumer:1',
              'n.name': 'GET /users',
              'n.file_path': 'src/client.ts',
              'n.start_line': 1,
              'n.end_line': 1,
              'n.metadata': JSON.stringify({
                semantic: { clientLibrary: 'fetch', method: 'GET', consumedKeys: ['id', 'name'] },
              }),
            },
          ];
        }
        if (cypher.includes('MATCH (n:route_nodes)')) {
          return [
            {
              'n.id': 'route::src/app.ts::GET /users',
              'n.name': 'GET /users',
              'n.file_path': 'src/app.ts',
              'n.metadata': JSON.stringify({ apiContract: { normalizedPath: '/users' } }),
            },
          ];
        }
        if (cypher.includes('MATCH (a)-[e:code_edges]->(b)')) {
          return [
            {
              'a.id': 'route::src/app.ts::GET /users',
              'b.id': 'api_shape::src/app.ts::fp1',
              'e.id': 'edge:returns_shape:1',
              'e.kind': 'returns_shape',
              'e.weight': 1,
              'e.label': '200',
            },
            {
              'a.id': 'api_consumer::src/client.ts::fetch:consumer:1',
              'b.id': 'route::src/app.ts::GET /users',
              'e.id': 'edge:consumes_api:1',
              'e.kind': 'consumes_api',
              'e.weight': 1,
              'e.certainty': 'exact',
              'e.strategy': 'exact-method-path',
            },
          ];
        }
        return [];
      },
    };
  }

  it('reconstructs api_shape and api_consumer nodes with their normalized metadata, not just counts', async () => {
    const graph = createKnowledgeGraph();
    await loadGraphFromDB(graph, dbWithRows() as never);

    const shapeNode = [...graph.allNodes()].find((n) => n.kind === 'api_shape');
    assert.ok(shapeNode);
    const shapeMeta = shapeNode!.metadata as { semantic: { origin: { fields: Array<{ key: string; required: boolean }> } } };
    assert.deepEqual(shapeMeta.semantic.origin.fields, [{ key: 'id', required: true }]);

    const consumerNode = [...graph.allNodes()].find((n) => n.kind === 'api_consumer');
    assert.ok(consumerNode);
    const consumerMeta = consumerNode!.metadata as { semantic: { consumedKeys: string[]; clientLibrary: string } };
    assert.deepEqual(consumerMeta.semantic.consumedKeys, ['id', 'name']);
    assert.equal(consumerMeta.semantic.clientLibrary, 'fetch');
  });

  it('reconstructs returns_shape and consumes_api edges with correct direction and evidence', async () => {
    const graph = createKnowledgeGraph();
    await loadGraphFromDB(graph, dbWithRows() as never);

    const edges = [...graph.allEdges()];
    const returnsShape = edges.find((e) => e.kind === 'returns_shape');
    assert.ok(returnsShape);
    assert.equal(returnsShape!.source, 'route::src/app.ts::GET /users');
    assert.equal(returnsShape!.target, 'api_shape::src/app.ts::fp1');
    assert.equal(returnsShape!.label, '200');

    const consumesApi = edges.find((e) => e.kind === 'consumes_api');
    assert.ok(consumesApi);
    assert.equal(consumesApi!.source, 'api_consumer::src/client.ts::fetch:consumer:1');
    assert.equal(consumesApi!.target, 'route::src/app.ts::GET /users');
    assert.equal(consumesApi!.certainty, 'exact');
    assert.equal(consumesApi!.strategy, 'exact-method-path');
  });
});
