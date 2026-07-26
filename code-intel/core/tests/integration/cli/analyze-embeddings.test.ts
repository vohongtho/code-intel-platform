import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadMetadata, getVectorDbPath, getDbPath } from '../../../src/storage/metadata.js';

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
  const repoDir = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'tmp-repo', private: true }, null, 2));
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
  for (let i = 1; i <= 5; i++) {
    fs.writeFileSync(path.join(repoDir, 'src', `extra-${i}.ts`), `export const extra${i} = ${i};\n`);
  }
  return repoDir;
}

function runCli(repoDir: string, args: string[]) {
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
  return { stdout: child.stdout, stderr: child.stderr };
}

describe('CLI analyze sticky embeddings', () => {
  it('plain analyze auto-increments graph work and rebuilds remembered embeddings when vector.db is missing', () => {
    const repoDir = mkRepo('sticky-plain');
    runCli(repoDir, ['--embeddings']);

    const meta1 = loadMetadata(repoDir);
    assert.ok(meta1?.embeddings?.enabled);
    assert.equal(meta1?.embeddings?.status, 'ready');

    const vdbPath = getVectorDbPath(repoDir);
    assert.ok(fs.existsSync(vdbPath), 'vector.db should exist after explicit embeddings run');
    fs.rmSync(vdbPath, { force: true });
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

    const second = runCli(repoDir, []);
    assert.match(second.stdout, /Auto-incremental:/);
    assert.match(second.stdout, /Embeddings: auto-enabled from previous index|Embeddings: enabled/);
    assert.ok(fs.existsSync(vdbPath), 'plain analyze should rebuild missing remembered vector.db');

    const meta2 = loadMetadata(repoDir);
    assert.equal(meta2?.embeddings?.status, 'ready');
  });

  it('incremental analyze updates remembered embeddings without explicit flag', () => {
    const repoDir = mkRepo('sticky-incremental');
    runCli(repoDir, ['--embeddings']);

    const vdbPath = getVectorDbPath(repoDir);
    const before = fs.statSync(vdbPath).mtimeMs;
    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), [
      'export function greet(name: string) {',
      '  return `hi ${name}`;',
      '}',
      '',
      'export function welcome() {',
      '  return greet("friend");',
      '}',
      '',
    ].join('\n'));

    const out = runCli(repoDir, ['--incremental']);
    assert.match(out.stdout, /Embeddings: auto-enabled from previous index/);
    const after = fs.statSync(vdbPath).mtimeMs;
    assert.ok(after >= before, 'incremental analyze should touch remembered vector.db');
    assert.equal(loadMetadata(repoDir)?.embeddings?.status, 'ready');
  });

  it('force analyze rebuilds remembered embeddings without explicit flag', () => {
    const repoDir = mkRepo('sticky-force');
    runCli(repoDir, ['--embeddings']);

    const vdbPath = getVectorDbPath(repoDir);
    const before = fs.statSync(vdbPath).mtimeMs;
    const out = runCli(repoDir, ['--force']);
    assert.match(out.stdout, /Embeddings: auto-enabled from previous index/);
    const after = fs.statSync(vdbPath).mtimeMs;
    assert.ok(after >= before, 'force analyze should rebuild remembered vector.db');
    assert.equal(loadMetadata(repoDir)?.embeddings?.status, 'ready');
  });

  it('skip-embeddings marks remembered state stale on graph-changing run', () => {
    const repoDir = mkRepo('sticky-skip');
    runCli(repoDir, ['--embeddings']);

    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), [
      'export function greet(name: string) {',
      '  return `bye ${name}`;',
      '}',
      '',
    ].join('\n'));

    const out = runCli(repoDir, ['--skip-embeddings']);
    assert.match(out.stdout, /Repository preference preserved/);
    assert.equal(loadMetadata(repoDir)?.embeddings?.status, 'stale');
  });

  it('legacy vector.db without embedding metadata normalizes on next analyze', () => {
    const repoDir = mkRepo('sticky-legacy');
    runCli(repoDir, ['--embeddings']);

    const metaPath = path.join(repoDir, '.code-intel', 'meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
    delete meta['embeddings'];
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    const out = runCli(repoDir, []);
    assert.match(out.stdout, /legacy vector index/);
    const normalized = loadMetadata(repoDir);
    assert.ok(normalized?.embeddings?.enabled);
    assert.equal(normalized?.embeddings?.status, 'ready');
  });

  it('new metadata fields are tolerated by follow-up analyze runs (mixed-version format compatibility)', () => {
    const repoDir = mkRepo('sticky-compat');
    runCli(repoDir, ['--embeddings']);

    const meta = loadMetadata(repoDir);
    assert.ok(meta?.embeddings);
    assert.ok(fs.existsSync(getDbPath(repoDir)));

    const out = runCli(repoDir, []);
    assert.match(out.stderr, /analyze started|DB persisted|Embeddings built|analyze complete/);
    assert.ok(loadMetadata(repoDir)?.embeddings?.enabled);
  });

  it('plain analyze without prior metadata falls back to full analysis', () => {
    const repoDir = mkRepo('plain-full-fallback');
    const out = runCli(repoDir, []);
    assert.doesNotMatch(out.stdout, /Auto-incremental:/);
    assert.doesNotMatch(out.stdout, /Auto-incremental unavailable:/);
    assert.equal(loadMetadata(repoDir)?.embeddings, undefined);
  });
});
