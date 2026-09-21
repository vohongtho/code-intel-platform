import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { getOrBuildSnapshot } from '../../../src/snapshots/cache.js';
import { getSnapshotLockPath, getSnapshotsRoot } from '../../../src/snapshots/paths.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function mkBuiltRepo(): { repoDir: string; commit: string } {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-failure-'));
  git(['init', '--quiet'], repoDir);
  git(['config', 'user.email', 'test@example.com'], repoDir);
  git(['config', 'user.name', 'Test'], repoDir);
  fs.writeFileSync(path.join(repoDir, 'index.ts'), 'export const x = 1;\n');
  git(['add', '.'], repoDir);
  git(['commit', '--quiet', '-m', 'base'], repoDir);
  return { repoDir, commit: git(['rev-parse', 'HEAD'], repoDir) };
}

function onlyCacheEntryDir(repoDir: string): string {
  const root = getSnapshotsRoot(repoDir);
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.staging-') && e.name !== '.locks');
  assert.equal(entries.length, 1, 'expected exactly one cache entry after a single build');
  return path.join(root, entries[0]!.name);
}

describe('snapshot cache: corruption and interrupted-state recovery', { timeout: 120_000 }, () => {
  it('rebuilds rather than serving a cache entry with unreadable metadata', async () => {
    const { repoDir, commit } = mkBuiltRepo();
    try {
      const first = await getOrBuildSnapshot({ repoDir, ref: commit });
      assert.equal(first.status, 'built');
      const entryDir = onlyCacheEntryDir(repoDir);

      fs.writeFileSync(path.join(entryDir, 'snapshot.json'), '{not valid json');

      const second = await getOrBuildSnapshot({ repoDir, ref: commit });
      assert.equal(second.status, 'built', 'a corrupt cache entry must never be served — it should be discarded and rebuilt');
      assert.equal(second.fromCache, false);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('rebuilds rather than serving a cache entry missing its graph.db (partial deletion)', async () => {
    const { repoDir, commit } = mkBuiltRepo();
    try {
      const first = await getOrBuildSnapshot({ repoDir, ref: commit });
      assert.equal(first.status, 'built');
      const entryDir = onlyCacheEntryDir(repoDir);

      fs.rmSync(path.join(entryDir, 'graph.db'), { force: true });

      const second = await getOrBuildSnapshot({ repoDir, ref: commit });
      assert.equal(second.status, 'built', 'a partially-deleted cache entry must never be served — it should be discarded and rebuilt');
      assert.equal(second.fromCache, false);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('rebuilds rather than serving a cache entry from an incompatible schema version', async () => {
    const { repoDir, commit } = mkBuiltRepo();
    try {
      const first = await getOrBuildSnapshot({ repoDir, ref: commit });
      assert.equal(first.status, 'built');
      const entryDir = onlyCacheEntryDir(repoDir);
      const metaPath = path.join(entryDir, 'snapshot.json');
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { schemaVersion: number };
      meta.schemaVersion = 999999;
      fs.writeFileSync(metaPath, JSON.stringify(meta));

      const second = await getOrBuildSnapshot({ repoDir, ref: commit });
      assert.equal(second.status, 'built', 'a cache entry with an incompatible schema version must never be served as healthy');
      assert.equal(second.fromCache, false);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('is not blocked by a stale build lock left by a dead process', async () => {
    const { repoDir, commit } = mkBuiltRepo();
    try {
      // Compute the fingerprint the same way getOrBuildSnapshot does, purely
      // to plant a lock file at the exact path it will check.
      const first = await getOrBuildSnapshot({ repoDir, ref: commit });
      assert.equal(first.status, 'built');
      const entryDir = onlyCacheEntryDir(repoDir);
      const snapshotId = path.basename(entryDir);

      // Force a rebuild path by discarding the entry, then plant a lock
      // "owned" by a PID that cannot possibly be alive, aged well past any
      // reasonable staleness window.
      fs.rmSync(entryDir, { recursive: true, force: true });
      const lockPath = getSnapshotLockPath(repoDir, snapshotId);
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999999, hostname: os.hostname(), startedAt: new Date(0).toISOString() }));
      const old = new Date(Date.now() - 60 * 60 * 1000);
      fs.utimesSync(lockPath, old, old);

      const second = await getOrBuildSnapshot({ repoDir, ref: commit });
      assert.equal(second.status, 'built', 'a stale lock from a dead process must not block a rebuild');
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
