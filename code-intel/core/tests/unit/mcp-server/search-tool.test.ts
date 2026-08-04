import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { DbManager } from '../../../src/storage/db-manager.js';
import { loadGraphToDB } from '../../../src/storage/graph-loader.js';
import { saveMetadata, getVectorDbPath } from '../../../src/storage/metadata.js';
import { saveRegistry } from '../../../src/storage/repo-registry.js';
import { dispatchTool, resetRepoGraphCacheForTests } from '../../../src/mcp-server/server.js';
import { CURRENT_SCHEMA_VERSION } from '../../../src/migrations/migration-runner.js';
import { Bm25Index, getBm25DbPath } from '../../../src/search/bm25-index.js';

function mkRepo(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  fs.mkdirSync(path.join(dir, '.code-intel'), { recursive: true });
  return dir;
}

async function writeRepoIndex(repoPath: string, spec: {
  indexVersion: string;
  nodes: Array<{ id: string; name: string; kind?: 'function' | 'class'; filePath: string; content?: string; exported?: boolean }>;
  createVectorDb?: boolean;
}): Promise<void> {
  const graph = createKnowledgeGraph();
  for (const node of spec.nodes) {
    graph.addNode({
      id: node.id,
      name: node.name,
      kind: node.kind ?? 'function',
      filePath: node.filePath,
      content: node.content,
      exported: node.exported,
    });
  }

  const db = new DbManager(path.join(repoPath, '.code-intel', 'graph.db'));
  await db.init();
  await loadGraphToDB(graph, db);
  db.close();

  const bm25 = new Bm25Index(getBm25DbPath(repoPath));
  bm25.build(graph);

  if (spec.createVectorDb) {
    fs.writeFileSync(getVectorDbPath(repoPath), 'stub');
  }

  saveMetadata(repoPath, {
    indexedAt: new Date().toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    indexVersion: spec.indexVersion,
    stats: { nodes: graph.size.nodes, edges: graph.size.edges, files: 1, duration: 0 },
  });
}

describe('MCP search tool', () => {
  beforeEach(() => {
    resetRepoGraphCacheForTests();
  });

  it('mode=bm25 bypasses vector and reports bm25', async () => {
    const repoPath = mkRepo('mcp-search-bm25');
    saveRegistry([{ id: 'repo-id', name: 'repo', path: repoPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 0, files: 1 } }]);
    await writeRepoIndex(repoPath, {
      indexVersion: 'v1',
      createVectorDb: true,
      nodes: [{ id: 'n1', name: 'ExactSymbol', filePath: 'src/exact.ts', content: 'function ExactSymbol() {}' }],
    });

    const result = await dispatchTool('search', { query: 'ExactSymbol', repo: 'repo', mode: 'bm25' }, createKnowledgeGraph(), 'fallback', undefined);
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as { searchMode?: string; results?: Array<{ name?: string }> };
    assert.equal(payload.searchMode, 'bm25');
    assert.equal(payload.results?.[0]?.name, 'ExactSymbol');
  });

  it('mode=vector falls back to bm25 when vector index is unavailable', async () => {
    const repoPath = mkRepo('mcp-search-vector-fallback');
    saveRegistry([{ id: 'repo-id', name: 'repo', path: repoPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 0, files: 1 } }]);
    await writeRepoIndex(repoPath, {
      indexVersion: 'v1',
      nodes: [{ id: 'n1', name: 'LoginService', filePath: 'src/login.ts', content: 'function LoginService() {}' }],
    });

    const result = await dispatchTool('search', { query: 'LoginService', repo: 'repo', mode: 'vector' }, createKnowledgeGraph(), 'fallback', undefined);
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as { searchMode?: string; results?: Array<{ name?: string }> };
    assert.equal(payload.searchMode, 'bm25');
    assert.equal(payload.results?.[0]?.name, 'LoginService');
  });

  it('omitted mode preserves existing default behavior', async () => {
    const repoPath = mkRepo('mcp-search-default');
    saveRegistry([{ id: 'repo-id', name: 'repo', path: repoPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 0, files: 1 } }]);
    await writeRepoIndex(repoPath, {
      indexVersion: 'v1',
      nodes: [{ id: 'n1', name: 'UserService', filePath: 'src/user.ts', content: 'class UserService {}' }],
    });

    const result = await dispatchTool('search', { query: 'UserService', repo: 'repo' }, createKnowledgeGraph(), 'fallback', undefined);
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as { searchMode?: string; results?: Array<{ name?: string }> };
    assert.equal(payload.searchMode, 'bm25');
    assert.equal(payload.results?.[0]?.name, 'UserService');
  });

  it('returns an actionable missing-index error for unindexed repos and succeeds after analyze', async () => {
    const repoPath = mkRepo('mcp-search-missing-index');
    saveRegistry([{ id: 'repo-id', name: 'repo', path: repoPath, indexedAt: new Date().toISOString(), stats: { nodes: 0, edges: 0, files: 0 } }]);

    const first = await dispatchTool('search', { query: 'UserService', repo: 'repo' }, createKnowledgeGraph(), 'fallback', undefined);
    const firstPayload = JSON.parse(first.content[0]?.text ?? '{}') as { error?: string; hint?: string; repo?: string; actionable?: boolean };
    assert.equal(first.isError, true);
    assert.match(firstPayload.error ?? '', /No published index found/);
    assert.match(firstPayload.hint ?? '', /code-intel analyze/);
    assert.equal(firstPayload.repo, 'repo');
    assert.equal(firstPayload.actionable, true);

    await writeRepoIndex(repoPath, {
      indexVersion: 'v1',
      nodes: [{ id: 'n1', name: 'UserService', filePath: 'src/user.ts', content: 'class UserService {}' }],
    });

    const second = await dispatchTool('search', { query: 'UserService', repo: 'repo' }, createKnowledgeGraph(), 'fallback', undefined);
    const secondPayload = JSON.parse(second.content[0]?.text ?? '{}') as { searchMode?: string; results?: Array<{ name?: string }> };
    assert.equal(second.isError, undefined);
    assert.equal(secondPayload.searchMode, 'bm25');
    assert.equal(secondPayload.results?.[0]?.name, 'UserService');
  });
});
