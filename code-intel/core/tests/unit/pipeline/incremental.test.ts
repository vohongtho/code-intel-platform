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

  it('detects staged, unstaged, untracked AND deleted files together, deterministically across repeated calls', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-dirty-full-'));
    try {
      execSync('git init -q', { cwd: repo });
      execSync('git config user.email test@example.com', { cwd: repo });
      execSync('git config user.name Test', { cwd: repo });
      const staged = path.join(repo, 'staged.ts');
      const unstaged = path.join(repo, 'unstaged.ts');
      const deleted = path.join(repo, 'deleted.ts');
      const stable = path.join(repo, 'stable.ts');
      fs.writeFileSync(staged, 'export const a = 1;');
      fs.writeFileSync(unstaged, 'export const b = 1;');
      fs.writeFileSync(deleted, 'export const c = 1;');
      fs.writeFileSync(stable, 'export const d = 1;');
      execSync('git add . && git commit -qm initial', { cwd: repo });
      const base = getCurrentCommitHash(repo)!;
      const allFiles = [staged, unstaged, deleted, stable];
      const mtimes = buildMtimeSnapshot(allFiles, repo);

      fs.writeFileSync(staged, 'export const a = 2;');
      execSync('git add staged.ts', { cwd: repo });
      fs.writeFileSync(unstaged, 'export const b = 2;');
      fs.rmSync(deleted);
      const untracked = path.join(repo, 'untracked.ts');
      fs.writeFileSync(untracked, 'export const e = 1;');

      const currentFiles = [staged, unstaged, stable, untracked];
      const first = decideIncremental(repo, currentFiles, base, mtimes);
      const second = decideIncremental(repo, currentFiles, base, mtimes);

      assert.deepEqual(first, second, 'the decision must be deterministic across repeated calls against the same dirty tree');
      assert.equal(first.incremental, false);
      // Fallback to full rebuild is the correctness-first response to any non-empty
      // change set — it doesn't need to enumerate deletions to be safe, but the
      // count in its reason must faithfully reflect all 4 kinds of dirty state.
      assert.match(first.fallbackReason ?? '', /3 changed and 1 deleted file\(s\)/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('decideIncremental dependency-aware candidate gate', () => {
  function proven(overrides: Partial<import('../../../src/incremental/semantic-delta.js').SemanticDelta> = {}) {
    return {
      changedFiles: [], deletedFiles: [], addedFacts: [], removedFacts: [], changedFacts: [],
      bodyOnlyFiles: [], invalidatedReferences: [], invalidatedCallSites: [], invalidatedSymbols: [],
      affectedArtifacts: new Set(['graph', 'bm25'] as const),
      requiresFullResolution: false,
      ...overrides,
    };
  }

  it('keeps the correctness-first full rebuild fallback when no options are passed (unchanged behavior)', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-gate-default-'));
    try {
      const file = path.join(repo, 'a.ts');
      fs.writeFileSync(file, 'export const a = 1;\n');
      const mtimes = buildMtimeSnapshot([file], repo);
      mtimes['a.ts'] -= 10_000;
      const result = decideIncremental(repo, [file], undefined, mtimes);
      assert.equal(result.incremental, false);
      assert.match(result.fallbackReason ?? '', /correctness-first full rebuild/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('still falls back when the gate is enabled but no candidate delta is supplied', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-gate-no-delta-'));
    try {
      const file = path.join(repo, 'a.ts');
      fs.writeFileSync(file, 'export const a = 1;\n');
      const mtimes = buildMtimeSnapshot([file], repo);
      mtimes['a.ts'] -= 10_000;
      const result = decideIncremental(repo, [file], undefined, mtimes, { incrementalSemanticEnabled: true });
      assert.equal(result.incremental, false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('still falls back when a candidate delta requires full resolution, even with the gate enabled', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-gate-truncated-'));
    try {
      const file = path.join(repo, 'a.ts');
      fs.writeFileSync(file, 'export const a = 1;\n');
      const mtimes = buildMtimeSnapshot([file], repo);
      mtimes['a.ts'] -= 10_000;
      const result = decideIncremental(repo, [file], undefined, mtimes, {
        incrementalSemanticEnabled: true,
        dependencyAwareDelta: proven({ requiresFullResolution: true, reason: 'closure truncated' }),
      });
      assert.equal(result.incremental, false);
      assert.equal(result.dependencyAwareCandidate?.requiresFullResolution, true);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('publishes incrementally only when the gate is enabled AND the candidate proves a complete closure', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-gate-proven-'));
    try {
      const file = path.join(repo, 'a.ts');
      fs.writeFileSync(file, 'export const a = 1;\n');
      const mtimes = buildMtimeSnapshot([file], repo);
      mtimes['a.ts'] -= 10_000;
      const delta = proven();
      const result = decideIncremental(repo, [file], undefined, mtimes, {
        incrementalSemanticEnabled: true,
        dependencyAwareDelta: delta,
      });
      assert.equal(result.incremental, true);
      assert.equal(result.dependencyAwareCandidate, delta);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('still falls back when the changed set includes a non-fact-based language, even with the gate enabled and a proven candidate', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-gate-mixed-lang-'));
    try {
      const tsFile = path.join(repo, 'a.ts');
      const javaFile = path.join(repo, 'Service.java');
      fs.writeFileSync(tsFile, 'export const a = 1;\n');
      fs.writeFileSync(javaFile, 'class Service {}\n');
      const mtimes = buildMtimeSnapshot([tsFile, javaFile], repo);
      mtimes['a.ts'] -= 10_000;
      mtimes['Service.java'] -= 10_000;
      const result = decideIncremental(repo, [tsFile, javaFile], undefined, mtimes, {
        incrementalSemanticEnabled: true,
        dependencyAwareDelta: proven({ changedFiles: ['a.ts', 'Service.java'] }),
      });
      assert.equal(result.incremental, false);
      assert.match(result.fallbackReason ?? '', /correctness-first full rebuild/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
