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

async function writeRepoIndex(repoPath: string): Promise<void> {
  const graph = createKnowledgeGraph();
  graph.addNode({
    id: 'svc',
    kind: 'class',
    name: 'UserService',
    filePath: 'src/user.ts',
    content: ['class UserService {', '  save() {', '    return true;', '  }', '}'].join('\n'),
    startLine: 1,
    metadata: { summary: 'Handles user operations.' },
  });
  graph.addNode({
    id: 'ctrl',
    kind: 'class',
    name: 'UserController',
    filePath: 'src/controller.ts',
    content: 'class UserController { handle() { return new UserService().save(); } }',
    startLine: 1,
  });
  graph.addNode({
    id: 'repo',
    kind: 'class',
    name: 'UserRepo',
    filePath: 'src/repo.ts',
    content: 'class UserRepo { insert() {} }',
    startLine: 1,
  });
  graph.addEdge({ id: 'ctrl-calls-svc', source: 'ctrl', target: 'svc', kind: 'calls' });
  graph.addEdge({ id: 'svc-calls-repo', source: 'svc', target: 'repo', kind: 'calls' });

  const db = new DbManager(path.join(repoPath, '.code-intel', 'graph.db'));
  await db.init();
  await loadGraphToDB(graph, db);
  db.close();

  const bm25 = new Bm25Index(getBm25DbPath(repoPath));
  bm25.build(graph);

  saveMetadata(repoPath, {
    indexedAt: new Date().toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    indexVersion: 'v1',
    stats: { nodes: graph.size.nodes, edges: graph.size.edges, files: 3, duration: 0 },
  });
}

describe('MCP context tool', () => {
  beforeEach(() => {
    resetRepoGraphCacheForTests();
  });

  async function setup() {
    const repoPath = mkRepo('mcp-context');
    saveRegistry([{ id: 'repo-id', name: 'repo', path: repoPath, indexedAt: new Date().toISOString(), stats: { nodes: 3, edges: 2, files: 3 } }]);
    await writeRepoIndex(repoPath);
    return repoPath;
  }

  it('returns structured document for single seed', async () => {
    const repoPath = await setup();
    const result = await dispatchTool('context', { repo: 'repo', symbols: ['UserService'] }, createKnowledgeGraph(), 'fallback', repoPath);
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as {
      summary?: string; logic?: string; relation?: string; focusCode?: string; truncated?: boolean; symbols?: string[];
    };
    assert.deepEqual(payload.symbols, ['UserService']);
    assert.match(payload.summary ?? '', /\[SUMMARY\]/);
    assert.match(payload.logic ?? '', /\[LOGIC\]/);
    assert.match(payload.relation ?? '', /\[RELATION\]/);
    assert.match(payload.focusCode ?? '', /\[FOCUS CODE\]/);
    assert.equal(typeof payload.truncated, 'boolean');
  });

  it('combines multiple seeds', async () => {
    const repoPath = await setup();
    const result = await dispatchTool('context', { repo: 'repo', symbols: ['UserService', 'UserController'] }, createKnowledgeGraph(), 'fallback', repoPath);
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as { symbols?: string[]; summary?: string };
    assert.deepEqual(payload.symbols, ['UserService', 'UserController']);
    assert.match(payload.summary ?? '', /UserService/);
    assert.match(payload.summary ?? '', /UserController/);
  });

  it('omits unresolved seeds when at least one resolves', async () => {
    const repoPath = await setup();
    const result = await dispatchTool('context', { repo: 'repo', symbols: ['UserService', 'MissingSymbol'] }, createKnowledgeGraph(), 'fallback', repoPath);
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as { symbols?: string[]; unresolvedSymbols?: string[] };
    assert.deepEqual(payload.symbols, ['UserService']);
    assert.deepEqual(payload.unresolvedSymbols, ['MissingSymbol']);
  });

  it('returns error text when no seeds resolve', async () => {
    const repoPath = await setup();
    const result = await dispatchTool('context', { repo: 'repo', symbols: ['MissingSymbol'] }, createKnowledgeGraph(), 'fallback', repoPath);
    assert.match(result.content[0]?.text ?? '', /No symbols resolved/);
  });

  it('respects explicit intent and clamps max_tokens', async () => {
    const repoPath = await setup();
    const result = await dispatchTool('context', { repo: 'repo', symbols: ['UserService'], intent: 'callers', max_tokens: 999999 }, createKnowledgeGraph(), 'fallback', repoPath);
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as { intent?: string; relation?: string };
    assert.equal(payload.intent, 'callers');
    assert.match(payload.relation ?? '', /UserController|\[RELATION\]/);
  });
});
