import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { computeSemanticGraphDiff } from '../../../src/snapshots/service.js';
import { getCurrentManifestPath, getGenerationsDir } from '../../../src/storage/index-generation.js';
import { loadRegistry } from '../../../src/storage/repo-registry.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

interface RepoState {
  head: string;
  /** Status lines for tracked files only — `.code-intel/` appearing as a new
   * untracked (`??`) entry is expected and fine, the same as running
   * `code-intel analyze` on a repo without it in .gitignore. What matters is
   * that no *tracked* file was modified, staged, or deleted. */
  trackedStatus: string;
  currentManifestExists: boolean;
  generationsDirExists: boolean;
  registrySnapshot: string;
}

function trackedFileStatus(repoDir: string): string {
  return git(['status', '--porcelain'], repoDir)
    .split('\n')
    .filter((line) => line.trim().length > 0 && !line.startsWith('??'))
    .sort()
    .join('\n');
}

function captureState(repoDir: string): RepoState {
  return {
    head: git(['rev-parse', 'HEAD'], repoDir),
    trackedStatus: trackedFileStatus(repoDir),
    currentManifestExists: fs.existsSync(getCurrentManifestPath(repoDir)),
    generationsDirExists: fs.existsSync(getGenerationsDir(repoDir)),
    registrySnapshot: JSON.stringify(loadRegistry()),
  };
}

function assertUnchanged(before: RepoState, after: RepoState, label: string): void {
  assert.equal(after.head, before.head, `${label}: HEAD must be unchanged`);
  assert.equal(after.trackedStatus, before.trackedStatus, `${label}: no tracked file may be modified, staged, or deleted`);
  assert.equal(after.currentManifestExists, before.currentManifestExists, `${label}: current.json must not be created`);
  assert.equal(after.currentManifestExists, false, `${label}: current.json must never exist for a diff-only repo`);
  assert.equal(after.generationsDirExists, before.generationsDirExists, `${label}: generations/ must not be created`);
  assert.equal(after.generationsDirExists, false, `${label}: generations/ must never exist for a diff-only repo`);
  assert.equal(after.registrySnapshot, before.registrySnapshot, `${label}: the global repo registry must be unchanged`);
}

describe('semantic graph diff: Generation V2 isolation', { timeout: 120_000 }, () => {
  it('never mutates the working tree, HEAD, current.json, generations/, or the repo registry on success', async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-diff-safety-ok-'));
    try {
      git(['init', '--quiet'], repoDir);
      git(['config', 'user.email', 'test@example.com'], repoDir);
      git(['config', 'user.name', 'Test'], repoDir);
      fs.writeFileSync(path.join(repoDir, 'index.ts'), 'export function greet(name: string): string {\n  return `hello ${name}`;\n}\n');
      git(['add', '.'], repoDir);
      git(['commit', '--quiet', '-m', 'base'], repoDir);
      const baseCommit = git(['rev-parse', 'HEAD'], repoDir);

      fs.writeFileSync(path.join(repoDir, 'index.ts'), 'export function greet(name: string): string {\n  return `hi ${name}`;\n}\n\nexport function farewell(name: string): string {\n  return `bye ${name}`;\n}\n');
      git(['add', '.'], repoDir);
      git(['commit', '--quiet', '-m', 'head'], repoDir);
      const headCommit = git(['rev-parse', 'HEAD'], repoDir);

      const before = captureState(repoDir);
      const { diff, base, head } = await computeSemanticGraphDiff({ repoDir, base: baseCommit, head: headCommit });
      const after = captureState(repoDir);

      assertUnchanged(before, after, 'success case');
      assert.ok(diff, 'diff should be produced for two valid commits');
      assert.equal(base.status, 'built');
      assert.equal(head.status, 'built');
      assert.equal(diff!.coverage.complete, true);
      assert.ok(diff!.nodes.some((n) => n.kind === 'added' && n.headName === 'farewell'), 'the added function should appear as an added node delta');
      assert.ok(diff!.nodes.every((n) => n.baseId !== headCommit && n.headId !== baseCommit), 'delta IDs should be canonical node IDs, never raw ref strings');

      // Snapshot cache lives only under repoDir's .code-intel/snapshots/, a
      // sibling of (never inside) generations/.
      const snapshotsDir = path.join(repoDir, '.code-intel', 'snapshots');
      assert.ok(fs.existsSync(snapshotsDir), 'snapshot cache directory should exist after a successful diff');

      // Re-running should hit the cache rather than rebuilding.
      const beforeCached = captureState(repoDir);
      const cachedResult = await computeSemanticGraphDiff({ repoDir, base: baseCommit, head: headCommit });
      const afterCached = captureState(repoDir);
      assertUnchanged(beforeCached, afterCached, 'cached re-run');
      assert.equal(cachedResult.base.fromCache, true);
      assert.equal(cachedResult.head.fromCache, true);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('never mutates repository state even when a ref cannot be resolved', async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-diff-safety-fail-'));
    try {
      git(['init', '--quiet'], repoDir);
      git(['config', 'user.email', 'test@example.com'], repoDir);
      git(['config', 'user.name', 'Test'], repoDir);
      fs.writeFileSync(path.join(repoDir, 'index.ts'), 'export const x = 1;\n');
      git(['add', '.'], repoDir);
      git(['commit', '--quiet', '-m', 'base'], repoDir);
      const headCommit = git(['rev-parse', 'HEAD'], repoDir);

      const before = captureState(repoDir);
      const { diff, base } = await computeSemanticGraphDiff({ repoDir, base: 'this-ref-does-not-exist', head: headCommit });
      const after = captureState(repoDir);

      assertUnchanged(before, after, 'unknown-ref failure case');
      assert.equal(diff, null, 'an unresolvable ref must never produce a diff object');
      assert.equal(base.status, 'failed');
      assert.ok(base.boundaries.some((b) => b.kind === 'unknown-ref'));
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('rejects a ref that looks like a command-line flag rather than passing it to git', async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-diff-safety-argv-'));
    try {
      git(['init', '--quiet'], repoDir);
      git(['config', 'user.email', 'test@example.com'], repoDir);
      git(['config', 'user.name', 'Test'], repoDir);
      fs.writeFileSync(path.join(repoDir, 'index.ts'), 'export const x = 1;\n');
      git(['add', '.'], repoDir);
      git(['commit', '--quiet', '-m', 'base'], repoDir);
      const headCommit = git(['rev-parse', 'HEAD'], repoDir);

      const before = captureState(repoDir);
      const { diff, base } = await computeSemanticGraphDiff({ repoDir, base: '--upload-pack=touch /tmp/pwned', head: headCommit });
      const after = captureState(repoDir);

      assertUnchanged(before, after, 'unsafe-ref case');
      assert.equal(diff, null);
      assert.equal(base.status, 'failed');
      assert.equal(fs.existsSync('/tmp/pwned'), false);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
