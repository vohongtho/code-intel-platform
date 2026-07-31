import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  getCurrentCommitHash,
  getChangedFilesSince,
  filterChangedByMtime,
  buildMtimeSnapshot,
  decideIncremental,
} from '../../../src/pipeline/incremental.js';

// ── getCurrentCommitHash ───────────────────────────────────────────────────────

describe('getCurrentCommitHash', () => {
  it('returns null for a non-git directory', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-test-'));
    try {
      const hash = getCurrentCommitHash(tmp);
      assert.equal(hash, null);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns a 40-char hex string for a real git repo', () => {
    // Use the repo root itself — it is definitely a git repo
    const repoRoot = path.resolve(process.cwd(), '../../..');
    const hash = getCurrentCommitHash(repoRoot);
    if (hash === null) return; // git not available in this env — skip
    assert.match(hash, /^[0-9a-f]{40}$/);
  });
});

// ── getChangedFilesSince ───────────────────────────────────────────────────────

describe('getChangedFilesSince', () => {
  it('returns null for a non-git directory', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-test-'));
    try {
      const result = getChangedFilesSince(tmp, 'HEAD~1');
      assert.equal(result, null);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns an array for a real git repo with a valid hash', () => {
    const repoRoot = path.resolve(process.cwd(), '../../..');
    const hash = getCurrentCommitHash(repoRoot);
    if (!hash) return; // git unavailable — skip
    // diff from HEAD to HEAD should be empty
    const result = getChangedFilesSince(repoRoot, hash);
    assert.ok(Array.isArray(result));
    assert.equal(result!.length, 0);
  });
});

// ── filterChangedByMtime ───────────────────────────────────────────────────────

describe('filterChangedByMtime', () => {
  let tmpDir: string;
  let fileA: string;
  let fileB: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-mtime-'));
    fileA = path.join(tmpDir, 'a.ts');
    fileB = path.join(tmpDir, 'b.ts');
    fs.writeFileSync(fileA, 'export const a = 1;');
    fs.writeFileSync(fileB, 'export const b = 2;');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('unchanged file (same mtime) is NOT returned', () => {
    const { mtimeMs } = fs.statSync(fileA);
    const stored = { 'a.ts': mtimeMs };
    const changed = filterChangedByMtime([fileA], tmpDir, stored);
    assert.equal(changed.length, 0);
  });

  it('modified file (new mtime) IS returned', () => {
    const { mtimeMs } = fs.statSync(fileA);
    // Store a mtime in the past
    const stored = { 'a.ts': mtimeMs - 10000 };
    const changed = filterChangedByMtime([fileA], tmpDir, stored);
    assert.equal(changed.length, 1);
    assert.equal(changed[0], fileA);
  });

  it('new file (no stored mtime) IS returned', () => {
    const changed = filterChangedByMtime([fileB], tmpDir, {});
    assert.equal(changed.length, 1);
    assert.equal(changed[0], fileB);
  });

  it('multiple files — only changed ones returned', () => {
    const { mtimeMs: mtimeA } = fs.statSync(fileA);
    const { mtimeMs: mtimeB } = fs.statSync(fileB);
    const stored = { 'a.ts': mtimeA, 'b.ts': mtimeB - 5000 };
    const changed = filterChangedByMtime([fileA, fileB], tmpDir, stored);
    assert.equal(changed.length, 1);
    assert.equal(changed[0], fileB);
  });
});

// ── buildMtimeSnapshot ────────────────────────────────────────────────────────

describe('buildMtimeSnapshot', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-snap-'));
    fs.writeFileSync(path.join(tmpDir, 'x.ts'), 'const x = 1;');
    fs.writeFileSync(path.join(tmpDir, 'y.ts'), 'const y = 2;');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns mtime for each existing file', () => {
    const files = [path.join(tmpDir, 'x.ts'), path.join(tmpDir, 'y.ts')];
    const snap = buildMtimeSnapshot(files, tmpDir);
    assert.ok(snap['x.ts'] > 0);
    assert.ok(snap['y.ts'] > 0);
  });

  it('skips non-existent files', () => {
    const snap = buildMtimeSnapshot([path.join(tmpDir, 'nonexistent.ts')], tmpDir);
    assert.equal(Object.keys(snap).length, 0);
  });

  it('keys are relative to workspaceRoot', () => {
    const snap = buildMtimeSnapshot([path.join(tmpDir, 'x.ts')], tmpDir);
    assert.ok('x.ts' in snap);
    assert.ok(!Object.keys(snap).some((k) => k.startsWith('/')));
  });
});

// ── decideIncremental ─────────────────────────────────────────────────────────

describe('decideIncremental', () => {
  let tmpDir: string;
  const files: string[] = [];

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-decide-'));
    for (let i = 0; i < 5; i++) {
      const f = path.join(tmpDir, `file${i}.ts`);
      fs.writeFileSync(f, `const x${i} = ${i};`);
      files.push(f);
    }
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('falls back when no previous hash and no stored mtimes', () => {
    const result = decideIncremental(tmpDir, files, undefined, undefined);
    assert.equal(result.incremental, false);
    assert.ok(result.fallbackReason?.includes('no previous commit hash'));
  });

  it('uses mtime fallback when mtimes are available and no git', () => {
    // Store mtimes for all but file0
    const snap = buildMtimeSnapshot(files.slice(1), tmpDir);
    const result = decideIncremental(tmpDir, files, undefined, snap);
    assert.equal(result.incremental, true);
    // file0 has no stored mtime → should be in changedFiles
    assert.ok(result.changedFiles!.includes(files[0]));
  });

  it('falls back when changed > 20% of total (mtime)', () => {
    // Store very-old mtimes for ALL 5 files so all are "changed"
    const oldTime = Date.now() - 1_000_000;
    const storedAll: Record<string, number> = {};
    for (let i = 0; i < 5; i++) storedAll[`file${i}.ts`] = oldTime;
    const result = decideIncremental(tmpDir, files, undefined, storedAll);
    // 5/5 = 100% > 20% → fallback
    assert.equal(result.incremental, false);
    assert.ok(result.fallbackReason?.includes('20%'));
  });

  it('no changedFiles → empty array and incremental=true', () => {
    // All files have current mtime stored
    const snap = buildMtimeSnapshot(files, tmpDir);
    const result = decideIncremental(tmpDir, files, undefined, snap);
    assert.equal(result.incremental, true);
    assert.equal(result.changedFiles!.length, 0);
  });
});


describe('dirty working tree detection', () => {
  it('detects unstaged, staged and untracked files when baseHash equals HEAD', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-dirty-git-'));
    try {
      execSync('git init -q', { cwd: repo });
      execSync('git config user.email test@example.com', { cwd: repo });
      execSync('git config user.name Test', { cwd: repo });
      fs.writeFileSync(path.join(repo, 'unstaged.ts'), 'export const a = 1;');
      fs.writeFileSync(path.join(repo, 'staged.ts'), 'export const b = 1;');
      execSync('git add . && git commit -qm initial', { cwd: repo });
      const base = getCurrentCommitHash(repo)!;
      fs.writeFileSync(path.join(repo, 'unstaged.ts'), 'export const a = 2;');
      fs.writeFileSync(path.join(repo, 'staged.ts'), 'export const b = 2;');
      execSync('git add staged.ts', { cwd: repo });
      fs.writeFileSync(path.join(repo, 'untracked.ts'), 'export const c = 1;');
      assert.deepEqual(getChangedFilesSince(repo, base), ['staged.ts', 'unstaged.ts', 'untracked.ts']);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('unions git and mtime evidence', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-git-mtime-'));
    try {
      execSync('git init -q', { cwd: repo });
      execSync('git config user.email test@example.com', { cwd: repo });
      execSync('git config user.name Test', { cwd: repo });
      const files: string[] = [];
      for (let i = 0; i < 10; i++) {
        const file = path.join(repo, `file${i}.ts`);
        fs.writeFileSync(file, `export const v${i} = ${i};`);
        files.push(file);
      }
      execSync('git add . && git commit -qm initial', { cwd: repo });
      const base = getCurrentCommitHash(repo)!;
      const mtimes = buildMtimeSnapshot(files, repo);
      mtimes['file0.ts'] -= 10_000;
      const result = decideIncremental(repo, files, base, mtimes);
      assert.equal(result.incremental, true);
      assert.deepEqual(result.changedExistingFiles, [files[0]]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
