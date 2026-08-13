import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { DbManager } from '../../../src/storage/db-manager.js';
import { loadGraphToDB } from '../../../src/storage/graph-loader.js';
import { saveMetadata } from '../../../src/storage/metadata.js';
import { loadCurrentGenerationManifest } from '../../../src/storage/index-generation.js';
import { CURRENT_SCHEMA_VERSION } from '../../../src/migrations/migration-runner.js';
import { Bm25Index, getBm25DbPath } from '../../../src/search/bm25-index.js';

const CORE_ROOT = path.resolve(import.meta.dirname, '../../../..');
const CLI_MAIN = path.join(CORE_ROOT, 'dist-tests', 'src', 'cli', 'main.js');
const DIST_TESTS_ROOT = path.join(CORE_ROOT, 'dist-tests');
const created: string[] = [];

function ensureDistTestsPackageJson() {
  const target = path.join(DIST_TESTS_ROOT, 'package.json');
  if (!fs.existsSync(target)) {
    fs.copyFileSync(path.join(CORE_ROOT, 'package.json'), target);
  }
}

function mkRepo(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  created.push(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, private: true }, null, 2));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'index.ts'), 'export const value = 1;\n');
  return dir;
}

async function withGlobalDir<T>(fn: (globalDir: string) => T | Promise<T>): Promise<T> {
  const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-global-'));
  created.push(globalDir);
  const prev = process.env['HOME'];
  process.env['HOME'] = globalDir;
  try {
    return await fn(globalDir);
  } finally {
    if (prev === undefined) delete process.env['HOME'];
    else process.env['HOME'] = prev;
  }
}

function runCli(args: string[], options: { cwd?: string; timeout?: number } = {}) {
  ensureDistTestsPackageJson();
  return spawnSync(process.execPath, [CLI_MAIN, ...args], {
    cwd: options.cwd ?? CORE_ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: options.timeout ?? 15000,
  });
}

async function writeRepoIndex(repoPath: string, spec: {
  indexVersion: string;
  nodes: Array<{ id: string; name: string; filePath: string; exported?: boolean }>;
}): Promise<void> {
  const graph = createKnowledgeGraph();
  for (const node of spec.nodes) {
    graph.addNode({
      id: node.id,
      name: node.name,
      kind: 'function',
      filePath: node.filePath,
      exported: node.exported,
    });
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
    parser: 'tree-sitter',
    stats: { nodes: graph.size.nodes, edges: graph.size.edges, files: 1, duration: 0 },
  });
}

afterEach(() => {
  while (created.length > 0) fs.rmSync(created.pop()!, { recursive: true, force: true });
});

describe('CLI mcp startup', () => {
  it('connects without an index and does not create .code-intel', async () => {
    await withGlobalDir(async () => {
      const repoDir = mkRepo('mcp-missing-index');
      const child = runCli(['mcp', repoDir], { timeout: 1200 });

      assert.equal(child.status, 0);
      assert.equal(child.stderr.includes('No published index found for:'), false);
      assert.equal(fs.existsSync(path.join(repoDir, '.code-intel')), false);
    });
  });

  it('accepts an existing published index without rebuilding the index', async () => {
    await withGlobalDir(async () => {
      const repoDir = mkRepo('mcp-existing-index');
      await writeRepoIndex(repoDir, {
        indexVersion: 'v1',
        nodes: [{ id: 'n1', name: 'ReadySymbol', filePath: 'src/index.ts', exported: true }],
      });

      const beforeGraphStat = fs.statSync(path.join(repoDir, '.code-intel', 'graph.db')).mtimeMs;
      const beforeManifest = loadCurrentGenerationManifest(repoDir);
      const beforeMeta = fs.readFileSync(path.join(repoDir, '.code-intel', 'meta.json'), 'utf8');

      const child = runCli(['mcp', repoDir], { timeout: 1200 });
      assert.equal(child.status, 0);
      assert.equal(child.stderr.includes('No published index found for:'), false);

      const afterGraphStat = fs.statSync(path.join(repoDir, '.code-intel', 'graph.db')).mtimeMs;
      const afterManifest = loadCurrentGenerationManifest(repoDir);
      const afterMeta = fs.readFileSync(path.join(repoDir, '.code-intel', 'meta.json'), 'utf8');

      assert.equal(afterGraphStat, beforeGraphStat);
      assert.deepEqual(afterManifest, beforeManifest);
      assert.equal(afterMeta, beforeMeta);
    });
  });

  it('serve fallback still works for an unindexed current repo when another repo is indexed', async () => {
    await withGlobalDir(async () => {
      const indexedRepo = mkRepo('serve-indexed-repo');
      const currentRepo = mkRepo('serve-current-repo');
      await writeRepoIndex(indexedRepo, {
        indexVersion: 'v1',
        nodes: [{ id: 'n1', name: 'IndexedSymbol', filePath: 'src/index.ts', exported: true }],
      });
      const homeRegistryDir = path.join(process.env['HOME']!, '.code-intel');
      fs.mkdirSync(homeRegistryDir, { recursive: true });
      fs.writeFileSync(path.join(homeRegistryDir, 'repos.json'), JSON.stringify([
        {
          id: 'indexed-repo-id',
          name: 'indexed-repo',
          path: indexedRepo,
          indexedAt: new Date().toISOString(),
          stats: { nodes: 1, edges: 0, files: 1 },
        },
      ], null, 2));

      const child = runCli(['serve', currentRepo, '--port', '0'], { timeout: 1200 });
      assert.equal((child.error as NodeJS.ErrnoException | undefined)?.code, 'ETIMEDOUT');
      assert.match(child.stdout, /No index found for:/);
      assert.match(child.stdout, /Falling back to most recently indexed repo:/);
      assert.match(child.stdout, /To index this folder run: code-intel analyze/);
    });
  });

  it('serve starts empty when no indexed repos exist', async () => {
    await withGlobalDir(async () => {
      const repoDir = mkRepo('serve-empty-repo');
      const child = runCli(['serve', repoDir, '--port', '0'], { timeout: 1200 });

      assert.equal((child.error as NodeJS.ErrnoException | undefined)?.code, 'ETIMEDOUT');
      assert.match(child.stdout, /No indexed repositories found\. Starting server with empty graph\./);
      assert.match(child.stdout, /Run `code-intel analyze` to index a repository, then reload the UI\./);
    });
  });
});
