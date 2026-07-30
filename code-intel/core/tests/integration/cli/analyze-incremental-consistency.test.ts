import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadMetadata, getDbPath, getVectorDbPath } from '../../../src/storage/metadata.js';

const CORE_ROOT = path.resolve(import.meta.dirname, '../../../..');
const CLI_MAIN = path.join(CORE_ROOT, 'dist-tests', 'src', 'cli', 'main.js');
const DIST_TESTS_ROOT = path.join(CORE_ROOT, 'dist-tests');

function ensureDistTestsPackageJson() {
  const target = path.join(DIST_TESTS_ROOT, 'package.json');
  if (!fs.existsSync(target)) {
    fs.copyFileSync(path.join(CORE_ROOT, 'package.json'), target);
  }
}

function mkRepo(name: string) {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'tmp-incremental-repo', private: true }, null, 2));
  fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), [
    'export function greet(name: string) {',
    '  return `hello ${name}`;',
    '}',
    '',
    'export function welcome() {',
    '  return greet("world");',
    '}',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(repoDir, 'src', 'extra.ts'), 'export const extra = 1;\n');
  return repoDir;
}

function runAnalyze(repoDir: string, args: string[] = []) {
  ensureDistTestsPackageJson();
  const child = spawnSync(process.execPath, [CLI_MAIN, 'analyze', repoDir, '--skip-git', '--skip-agents-md', ...args], {
    cwd: CORE_ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 120000,
  });
  if (child.status !== 0) {
    throw new Error(`analyze failed (${child.status})\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`);
  }
  return { stdout: child.stdout, stderr: child.stderr, meta: loadMetadata(repoDir) };
}

function runStatus(repoDir: string) {
  ensureDistTestsPackageJson();
  const child = spawnSync(process.execPath, [CLI_MAIN, 'status', repoDir], {
    cwd: CORE_ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 120000,
  });
  if (child.status !== 0) {
    throw new Error(`status failed (${child.status})\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`);
  }
  return child.stdout;
}

describe('CLI analyze incremental consistency', () => {
  it('DB persist failure preserves the previously published on-disk index', () => {
    const repoDir = mkRepo('incremental-persist-failure');
    const first = runAnalyze(repoDir);
    const firstMeta = first.meta!;

    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), [
      'export function greet(name: string) {',
      '  return `hello again ${name}`;',
      '}',
      '',
      'export function welcome() {',
      '  return greet("world");',
      '}',
      '',
    ].join('\n'));

    const dbPathNew = `${getDbPath(repoDir)}.new`;
    fs.mkdirSync(dbPathNew, { recursive: true });

    const second = runAnalyze(repoDir);
    const secondMeta = loadMetadata(repoDir)!;

    assert.match(second.stderr, /DB persist failed/);
    assert.equal(secondMeta.indexVersion, firstMeta.indexVersion);
    assert.equal(secondMeta.stats.nodes, firstMeta.stats.nodes);
    assert.equal(secondMeta.stats.edges, firstMeta.stats.edges);
    assert.equal(secondMeta.stats.files, firstMeta.stats.files);

    const status = runStatus(repoDir);
    assert.match(status, new RegExp(`Nodes\\s+: ${firstMeta.stats.nodes}`));
    assert.match(status, new RegExp(`Edges\\s+: ${firstMeta.stats.edges}`));
    assert.match(status, new RegExp(`Files\\s+: ${firstMeta.stats.files}`));
  });

  it('second plain analyze with no changes preserves full stats', () => {
    const repoDir = mkRepo('incremental-no-change');
    const first = runAnalyze(repoDir);
    const firstMeta = first.meta!;
    const second = runAnalyze(repoDir);
    const secondMeta = second.meta!;

    assert.match(second.stdout, /Auto-incremental:/);
    assert.equal(secondMeta.stats.nodes, firstMeta.stats.nodes);
    assert.equal(secondMeta.stats.edges, firstMeta.stats.edges);
    assert.equal(secondMeta.stats.files, firstMeta.stats.files);

    const status = runStatus(repoDir);
    assert.match(status, new RegExp(`Nodes\\s+: ${firstMeta.stats.nodes}`));
    assert.match(status, new RegExp(`Edges\\s+: ${firstMeta.stats.edges}`));
    assert.match(status, new RegExp(`Files\\s+: ${firstMeta.stats.files}`));
  });

  it('deleted-file run falls back safely and removes stale metadata paths', () => {
    const repoDir = mkRepo('incremental-delete');
    runAnalyze(repoDir);
    fs.rmSync(path.join(repoDir, 'src', 'extra.ts'));

    const out = runAnalyze(repoDir);
    const meta = out.meta!;
    assert.match(out.stdout, /Falling back to full analysis/);
    assert.equal(meta.stats.files, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(meta.lastAnalyzedMtimes ?? {}, 'src/extra.ts'), false);
  });

  it('zero-change remembered embeddings do not rebuild vector.db', () => {
    const repoDir = mkRepo('incremental-embeddings-zero');
    runAnalyze(repoDir, ['--embeddings']);
    const vectorDbPath = getVectorDbPath(repoDir);
    const before = fs.statSync(vectorDbPath).mtimeMs;

    const out = runAnalyze(repoDir);
    const after = fs.statSync(vectorDbPath).mtimeMs;

    assert.match(out.stdout, /Auto-incremental:/);
    assert.match(out.stdout, /Embeddings: preserved existing vector index \(zero-change incremental run\)/);
    assert.equal(after, before, 'vector.db should not be rebuilt on zero-change incremental run');
    assert.equal(loadMetadata(repoDir)?.embeddings?.status, 'ready');
  });
});
