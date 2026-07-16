import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { DbManager } from '../../../src/storage/db-manager.js';
import { loadGraphToDB } from '../../../src/storage/graph-loader.js';
import { saveMetadata } from '../../../src/storage/metadata.js';
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
  nodes: Array<{ id: string; name: string; kind?: 'function' | 'class'; filePath: string; exported?: boolean }>;
  edges?: Array<{ id: string; source: string; target: string; kind?: 'calls' | 'imports' }>;
}): Promise<void> {
  const graph = createKnowledgeGraph();
  for (const node of spec.nodes) {
    graph.addNode({
      id: node.id,
      name: node.name,
      kind: node.kind ?? 'function',
      filePath: node.filePath,
      exported: node.exported,
    });
  }
  for (const edge of spec.edges ?? []) {
    graph.addEdge({ id: edge.id, source: edge.source, target: edge.target, kind: edge.kind ?? 'calls' });
  }

  const db = new DbManager(path.join(repoPath, '.code-intel', 'graph.db'));
  await db.init();
  await loadGraphToDB(graph, db);
  db.close();

  const bm25 = new Bm25Index(getBm25DbPath(repoPath));
  bm25.build(graph);

  saveMetadata(repoPath, {
    indexedAt: new Date().toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    indexVersion: spec.indexVersion,
    stats: { nodes: graph.size.nodes, edges: graph.size.edges, files: 1, duration: 0 },
  });
}

describe('MCP graph reload on index change', () => {
  beforeEach(() => {
    resetRepoGraphCacheForTests();
  });

  it('reloads when meta.json indexVersion changes', async () => {
    const repoPath = mkRepo('mcp-reload');
    saveRegistry([{ name: 'repo-a', path: repoPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 0, files: 1 } }]);

    await writeRepoIndex(repoPath, {
      indexVersion: 'v1',
      nodes: [{ id: 'n1', name: 'OldSymbol', filePath: 'src/old.ts' }],
    });

    const first = await dispatchTool('search', { query: 'OldSymbol', repo: 'repo-a' }, createKnowledgeGraph(), 'fallback', undefined);
    const firstText = first.content[0]?.text ?? '';
    assert.match(firstText, /OldSymbol/);

    await writeRepoIndex(repoPath, {
      indexVersion: 'v2',
      nodes: [{ id: 'n2', name: 'NewSymbol', filePath: 'src/new.ts' }],
    });

    const second = await dispatchTool('search', { query: 'NewSymbol', repo: 'repo-a' }, createKnowledgeGraph(), 'fallback', undefined);
    const secondText = second.content[0]?.text ?? '';
    assert.match(secondText, /NewSymbol/);
    assert.doesNotMatch(secondText, /OldSymbol/);
  });

  it('reuses cached graph when indexVersion is unchanged', async () => {
    const repoPath = mkRepo('mcp-cache');
    saveRegistry([{ name: 'repo-cache', path: repoPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 0, files: 1 } }]);

    await writeRepoIndex(repoPath, {
      indexVersion: 'same-v1',
      nodes: [{ id: 'n1', name: 'StableSymbol', filePath: 'src/stable.ts' }],
    });

    const first = await dispatchTool('search', { query: 'StableSymbol', repo: 'repo-cache' }, createKnowledgeGraph(), 'fallback', undefined);
    assert.match(first.content[0]?.text ?? '', /StableSymbol/);

    await writeRepoIndex(repoPath, {
      indexVersion: 'same-v1',
      nodes: [{ id: 'n2', name: 'ChangedButSameVersion', filePath: 'src/changed.ts' }],
    });

    const second = await dispatchTool('search', { query: 'StableSymbol', repo: 'repo-cache' }, createKnowledgeGraph(), 'fallback', undefined);
    const secondText = second.content[0]?.text ?? '';
    assert.match(secondText, /StableSymbol/);
    assert.doesNotMatch(secondText, /ChangedButSameVersion/);
  });

  it('repo-scoped search does not leak results from another repo', async () => {
    const repoA = mkRepo('mcp-repo-a');
    const repoB = mkRepo('mcp-repo-b');
    saveRegistry([
      { name: 'repo-a', path: repoA, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 0, files: 1 } },
      { name: 'repo-b', path: repoB, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 0, files: 1 } },
    ]);

    await writeRepoIndex(repoA, {
      indexVersion: 'a1',
      nodes: [{ id: 'a1', name: 'SharedQueryHit', filePath: 'src/repo-a.ts' }],
    });
    await writeRepoIndex(repoB, {
      indexVersion: 'b1',
      nodes: [{ id: 'b1', name: 'SharedQueryHit', filePath: 'src/repo-b.ts' }],
    });

    const result = await dispatchTool('search', { query: 'SharedQueryHit', repo: 'repo-a' }, createKnowledgeGraph(), 'fallback', undefined);
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as { results?: Array<{ filePath?: string }> };
    assert.ok(Array.isArray(payload.results));
    assert.ok(payload.results!.length >= 1);
    for (const row of payload.results!) {
      assert.match(row.filePath ?? '', /repo-a\.ts$/);
      assert.doesNotMatch(row.filePath ?? '', /repo-b\.ts$/);
    }
  });
});
