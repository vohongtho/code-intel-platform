/**
 * Proves the interprocedural gate (task 16) fails closed by default and
 * only opens for a genuinely `trusted` semantic graph — reusing the
 * platform's own index-trust verification (storage/index-trust.ts)
 * rather than a bespoke check, and built against a REAL index (same
 * construction the CLI's own startup test uses), not a mock.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { DbManager } from '../../../src/storage/db-manager.js';
import { loadGraphToDB } from '../../../src/storage/graph-loader.js';
import { saveMetadata, computeIndexVersionForPaths, getDbPath, getVectorDbPath } from '../../../src/storage/metadata.js';
import { Bm25Index, getBm25DbPath } from '../../../src/search/bm25-index.js';
import { CURRENT_SCHEMA_VERSION } from '../../../src/migrations/migration-runner.js';
import { gateInterproceduralAnalysis, boundCertaintyByCallRelationship } from '../../../src/program-analysis/semantic-graph-gate.js';

const created: string[] = [];

afterEach(() => {
  while (created.length > 0) fs.rmSync(created.pop()!, { recursive: true, force: true });
});

function mkRepoDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-semantic-gate-test-'));
  created.push(dir);
  return dir;
}

async function writeTrustedIndex(repoPath: string): Promise<void> {
  const graph = createKnowledgeGraph();
  graph.addNode({ id: 'n1', name: 'ReadySymbol', kind: 'function', filePath: 'src/index.ts', exported: true });

  const db = new DbManager(path.join(repoPath, '.code-intel', 'graph.db'));
  await db.init();
  await loadGraphToDB(graph, db);
  db.close();

  const bm25 = new Bm25Index(getBm25DbPath(repoPath));
  bm25.build(graph);

  const indexedAt = new Date().toISOString();
  const indexVersion = computeIndexVersionForPaths(CURRENT_SCHEMA_VERSION, indexedAt, {
    graphDbPath: getDbPath(repoPath),
    bm25DbPath: getBm25DbPath(repoPath),
    vectorDbPath: getVectorDbPath(repoPath),
  });

  saveMetadata(repoPath, {
    indexedAt,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    indexVersion,
    parser: 'tree-sitter',
    stats: { nodes: graph.size.nodes, edges: graph.size.edges, files: 1, duration: 0 },
  });
}

describe('gateInterproceduralAnalysis', () => {
  it('fails closed when no index exists at all', () => {
    const repoDir = mkRepoDir();
    const result = gateInterproceduralAnalysis(repoDir);
    assert.equal(result.allowed, false);
    assert.equal(result.indexTrust.state, 'missing');
    assert.ok(result.reason?.includes('not trusted'));
  });

  it('opens for a genuinely trusted, freshly-built real index', async () => {
    const repoDir = mkRepoDir();
    await writeTrustedIndex(repoDir);
    const result = gateInterproceduralAnalysis(repoDir);
    assert.equal(result.indexTrust.state, 'trusted');
    assert.equal(result.allowed, true);
    assert.equal(result.reason, undefined);
  });

  it('re-exports the certainty-bounding helper used once an interprocedural result is authorized', () => {
    assert.equal(boundCertaintyByCallRelationship('exact', 'heuristic'), 'heuristic');
  });
});
