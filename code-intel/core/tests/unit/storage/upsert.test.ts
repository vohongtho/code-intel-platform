/**
 * Tests for incremental DB write helpers:
 * upsertNode, upsertNodes, removeNodesForFile, removeEdgesForFile
 *
 * These tests are unit-style and mock the DbManager to avoid needing a real
 * KùzuDB instance (which requires native binaries at test time).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CodeNode } from '../../../src/shared/index.js';

// ── minimal mock DbManager ─────────────────────────────────────────────────────

function makeMockDb() {
  const executed: string[] = [];
  return {
    executed,
    execute: async (cypher: string) => { executed.push(cypher); },
    query: async () => [],
    close: () => {},
    isOpen: true,
  } as unknown as import('../../../src/storage/db-manager.js').DbManager & { executed: string[] };
}

// ── upsertNode ─────────────────────────────────────────────────────────────────

describe('upsertNode', () => {
  it('issues a DELETE then CREATE for the node', async () => {
    const { upsertNode } = await import('../../../src/storage/graph-loader.js');
    const db = makeMockDb();
    const node: CodeNode = {
      id: 'fn::src/foo.ts::myFn',
      kind: 'function',
      name: 'myFn',
      filePath: 'src/foo.ts',
      startLine: 1,
      endLine: 10,
      exported: true,
    };
    await upsertNode(node, db);
    assert.ok(db.executed.some((s) => s.includes('DELETE') && s.includes('fn::src/foo.ts::myFn')));
    assert.ok(db.executed.some((s) => s.startsWith('CREATE') && s.includes('func_nodes')));
  });

  it('does not throw if the node does not exist (first run)', async () => {
    const { upsertNode } = await import('../../../src/storage/graph-loader.js');
    // Mock that DELETE throws (node not found) — should be swallowed
    const executed: string[] = [];
    const db = {
      executed,
      execute: async (cypher: string) => {
        executed.push(cypher);
        if (cypher.includes('DELETE')) throw new Error('Node not found');
      },
      close: () => {},
      isOpen: true,
    } as unknown as import('../../../src/storage/db-manager.js').DbManager & { executed: string[] };

    const node: CodeNode = { id: 'x', kind: 'class', name: 'Foo', filePath: 'a.ts' };
    await assert.doesNotReject(() => upsertNode(node, db));
    // CREATE should still have been attempted
    assert.ok(executed.some((s) => s.startsWith('CREATE')));
  });
});

// ── upsertNodes (batch) ───────────────────────────────────────────────────────

describe('upsertNodes', () => {
  it('upserts all nodes and returns total count', async () => {
    const { upsertNodes } = await import('../../../src/storage/graph-loader.js');
    const db = makeMockDb();
    const nodes: CodeNode[] = Array.from({ length: 5 }, (_, i) => ({
      id: `fn${i}`,
      kind: 'function' as const,
      name: `fn${i}`,
      filePath: 'src/a.ts',
    }));
    const count = await upsertNodes(nodes, db);
    assert.equal(count, 5);
    // Each node → 2 executes (DELETE + CREATE)
    assert.equal(db.executed.length, 10);
  });

  it('processes nodes in batches of 100', async () => {
    const { upsertNodes } = await import('../../../src/storage/graph-loader.js');
    const db = makeMockDb();
    const nodes: CodeNode[] = Array.from({ length: 150 }, (_, i) => ({
      id: `fn${i}`,
      kind: 'function' as const,
      name: `fn${i}`,
      filePath: 'src/b.ts',
    }));
    const count = await upsertNodes(nodes, db);
    assert.equal(count, 150);
  });

  it('returns 0 for empty array', async () => {
    const { upsertNodes } = await import('../../../src/storage/graph-loader.js');
    const db = makeMockDb();
    const count = await upsertNodes([], db);
    assert.equal(count, 0);
    assert.equal(db.executed.length, 0);
  });
});

// ── removeNodesForFile ────────────────────────────────────────────────────────

describe('removeNodesForFile', () => {
  it('issues DETACH DELETE for every node table', async () => {
    const { removeNodesForFile } = await import('../../../src/storage/graph-loader.js');
    const { ALL_NODE_TABLES } = await import('../../../src/storage/schema.js');
    const db = makeMockDb();
    await removeNodesForFile('src/foo.ts', db);
    // One DETACH DELETE per table
    const detachDeletes = db.executed.filter((s) => s.includes('DETACH DELETE'));
    assert.equal(detachDeletes.length, ALL_NODE_TABLES.length);
    // Each statement targets the file_path
    assert.ok(detachDeletes.every((s) => s.includes('src/foo.ts')));
  });

  it('does not throw when tables do not exist (DB errors swallowed)', async () => {
    const { removeNodesForFile } = await import('../../../src/storage/graph-loader.js');
    const db = {
      execute: async () => { throw new Error('table not found'); },
      close: () => {},
      isOpen: true,
    } as unknown as import('../../../src/storage/db-manager.js').DbManager;
    await assert.doesNotReject(() => removeNodesForFile('src/bar.ts', db));
  });
});

// ── removeEdgesForFile ────────────────────────────────────────────────────────

describe('removeEdgesForFile', () => {
  it('issues a DELETE on code_edges for the file_path', async () => {
    const { removeEdgesForFile } = await import('../../../src/storage/graph-loader.js');
    const db = makeMockDb();
    await removeEdgesForFile('src/baz.ts', db);
    assert.ok(db.executed.some((s) => s.includes('DELETE') && s.includes('code_edges') && s.includes('src/baz.ts')));
  });

  it('does not throw when edges table does not exist', async () => {
    const { removeEdgesForFile } = await import('../../../src/storage/graph-loader.js');
    const db = {
      execute: async () => { throw new Error('rel table not found'); },
      close: () => {},
      isOpen: true,
    } as unknown as import('../../../src/storage/db-manager.js').DbManager;
    await assert.doesNotReject(() => removeEdgesForFile('src/baz.ts', db));
  });
});
