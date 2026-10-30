import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { resolveReadIndexView, resetIndexViewMemoForTests, withReadIndexView } from '../../../src/storage/index-view-resolver.js';
import { acquireSnapshotReadPin, cacheTestHooks, getOrBuildSnapshot, hasLiveReadPin, removeSnapshotEntry } from '../../../src/snapshots/cache.js';
import { getSnapshotEntryDir, getSnapshotReadPinsDir, SNAPSHOT_CAPABILITIES_FILE } from '../../../src/snapshots/paths.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function mkRepo(): { repoDir: string; base: string; head: string } {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'index-view-'));
  git(['init', '--quiet'], repoDir);
  git(['config', 'user.email', 'test@example.com'], repoDir);
  git(['config', 'user.name', 'Test'], repoDir);
  fs.writeFileSync(path.join(repoDir, 'index.ts'), 'export function alpha() { return 1; }\n');
  git(['add', '.'], repoDir);
  git(['commit', '--quiet', '-m', 'base'], repoDir);
  const base = git(['rev-parse', 'HEAD'], repoDir);
  fs.writeFileSync(path.join(repoDir, 'index.ts'), 'export function alpha() { return 1; }\nexport function beta() { return alpha(); }\n');
  git(['add', '.'], repoDir);
  git(['commit', '--quiet', '-m', 'head'], repoDir);
  return { repoDir, base, head: git(['rev-parse', 'HEAD'], repoDir) };
}

const cleanup: string[] = [];
afterEach(() => {
  resetIndexViewMemoForTests();
  for (const dir of cleanup.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('resolveReadIndexView', { timeout: 240_000 }, () => {
  it('no ref: resolves the active index as a generation view without a pin', async () => {
    const { repoDir } = mkRepo();
    cleanup.push(repoDir);
    fs.mkdirSync(path.join(repoDir, '.code-intel'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, '.code-intel', 'graph.db'), '');

    const result = await resolveReadIndexView({ repoDir });
    assert.ok(result.ok);
    assert.equal(result.view.kind, 'generation');
    assert.equal(result.view.resolution, 'active');
    assert.equal(result.view.descriptor, null);
    result.view.release();
  });

  it('no ref and no index: missing-index boundary', async () => {
    const { repoDir } = mkRepo();
    cleanup.push(repoDir);
    const result = await resolveReadIndexView({ repoDir });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.boundary.kind, 'missing-index');
  });

  it('unknown ref: unknown-ref boundary, never the current index', async () => {
    const { repoDir } = mkRepo();
    cleanup.push(repoDir);
    fs.mkdirSync(path.join(repoDir, '.code-intel'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, '.code-intel', 'graph.db'), '');

    for (const ref of ['does-not-exist', '--upload-pack=evil', '']) {
      const result = await resolveReadIndexView({ repoDir, ref });
      assert.equal(result.ok, false, `ref ${JSON.stringify(ref)} must not resolve`);
      if (!result.ok) assert.equal(result.boundary.kind, 'unknown-ref');
    }
  });

  it('cache miss with allowBuild:false: snapshot-not-built, nothing built', async () => {
    const { repoDir, base } = mkRepo();
    cleanup.push(repoDir);
    const result = await resolveReadIndexView({ repoDir, ref: base, allowBuild: false });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.boundary.kind, 'snapshot-not-built');
  });

  it('builds on miss, then serves a cache hit; artifacts stay inside the snapshot entry', async () => {
    const { repoDir, base } = mkRepo();
    cleanup.push(repoDir);
    const built = await resolveReadIndexView({ repoDir, ref: base });
    assert.ok(built.ok, !built.ok ? built.boundary.message : '');
    assert.equal(built.view.kind, 'semantic-snapshot');
    assert.equal(built.view.resolution, 'built');
    assert.equal(built.view.commit, base);
    assert.equal(built.view.vectorDbPath, undefined, 'on-demand snapshots are built without embeddings');
    for (const p of [built.view.graphDbPath, built.view.bm25DbPath, built.view.metadataPath]) {
      assert.ok(p && p.startsWith(built.view.artifactsDir + path.sep), `${p} must live in the snapshot entry`);
    }
    assert.equal(hasLiveReadPin(repoDir, built.view.identity), true);
    built.view.release();
    built.view.release();
    assert.equal(hasLiveReadPin(repoDir, built.view.identity), false);

    resetIndexViewMemoForTests();
    const cached = await resolveReadIndexView({ repoDir, ref: base });
    assert.ok(cached.ok);
    assert.equal(cached.view.resolution, 'cached');
    assert.equal(cached.view.identity, built.view.identity);
    cached.view.release();
  });

  it('a live read pin blocks removal and policy eviction until released', async () => {
    const { repoDir, base, head } = mkRepo();
    cleanup.push(repoDir);
    const held = await resolveReadIndexView({ repoDir, ref: base });
    assert.ok(held.ok);
    const entryDir = held.view.artifactsDir;

    assert.equal(removeSnapshotEntry(repoDir, held.view.identity), 'in-use');
    // Building another ref under a one-entry policy would normally evict `base`.
    const other = await getOrBuildSnapshot({ repoDir, ref: head }, { maxAgeMs: 24 * 3600_000, maxCount: 1, maxBytes: Number.MAX_SAFE_INTEGER });
    assert.equal(other.status, 'built');
    assert.equal(fs.existsSync(path.join(entryDir, 'graph.db')), true, 'pinned entry must survive eviction');

    held.view.release();
    assert.equal(fs.existsSync(getSnapshotReadPinsDir(repoDir, held.view.identity)), false);
    assert.equal(removeSnapshotEntry(repoDir, held.view.identity), 'removed');
    assert.equal(fs.existsSync(entryDir), false);
  });

  it('fails closed on an unreadable capability declaration instead of serving the entry', async () => {
    const { repoDir, base } = mkRepo();
    cleanup.push(repoDir);
    const first = await resolveReadIndexView({ repoDir, ref: base });
    assert.ok(first.ok);
    first.view.release();
    fs.writeFileSync(path.join(getSnapshotEntryDir(repoDir, first.view.identity), SNAPSHOT_CAPABILITIES_FILE), '{"privacyProfile":"bogus"}');
    resetIndexViewMemoForTests();

    const second = await resolveReadIndexView({ repoDir, ref: base, allowBuild: false });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.boundary.kind, 'snapshot-not-built');
  });

  it('honors another host\'s fresh pin, reclaims it once stale, and reclaims dead same-host pins', async () => {
    const { repoDir, base } = mkRepo();
    cleanup.push(repoDir);
    const first = await resolveReadIndexView({ repoDir, ref: base });
    assert.ok(first.ok);
    first.view.release();
    const id = first.view.identity;
    const pinsDir = getSnapshotReadPinsDir(repoDir, id);
    fs.mkdirSync(pinsDir, { recursive: true });

    const remote = path.join(pinsDir, 'remote.json');
    fs.writeFileSync(remote, JSON.stringify({ pid: 1, hostname: 'some-other-host.example', startedAt: new Date().toISOString(), pinId: 'remote' }));
    assert.equal(hasLiveReadPin(repoDir, id), true, 'a fresh pin from another host is honored');
    assert.equal(removeSnapshotEntry(repoDir, id), 'in-use');
    const old = new Date(Date.now() - 31 * 60 * 1000);
    fs.utimesSync(remote, old, old);
    assert.equal(hasLiveReadPin(repoDir, id), false, 'a stale remote pin is reclaimed');
    assert.equal(fs.existsSync(remote), false);

    fs.mkdirSync(pinsDir, { recursive: true });
    const dead = path.join(pinsDir, 'dead.json');
    fs.writeFileSync(dead, JSON.stringify({ pid: 2 ** 22 + 12345, hostname: os.hostname(), startedAt: new Date().toISOString(), pinId: 'dead' }));
    assert.equal(hasLiveReadPin(repoDir, id), false, 'a pin from a dead local process is reclaimed');
    assert.equal(removeSnapshotEntry(repoDir, id), 'removed');
  });

  it('restores an entry when a reader pins it between eviction\'s move-aside and re-check', async () => {
    const { repoDir, base } = mkRepo();
    cleanup.push(repoDir);
    const first = await resolveReadIndexView({ repoDir, ref: base });
    assert.ok(first.ok);
    first.view.release();
    const id = first.view.identity;
    const entryDir = getSnapshotEntryDir(repoDir, id);

    let racer: (() => void) | undefined;
    cacheTestHooks.afterMoveAside = (dir, snapshotId) => {
      assert.equal(fs.existsSync(entryDir), false, 'entry is moved aside at this point');
      racer = acquireSnapshotReadPin(dir, snapshotId);
    };
    try {
      assert.equal(removeSnapshotEntry(repoDir, id), 'in-use', 'eviction must back off');
    } finally {
      cacheTestHooks.afterMoveAside = undefined;
    }
    assert.equal(fs.existsSync(path.join(entryDir, 'graph.db')), true, 'entry restored for the reader');
    resetIndexViewMemoForTests();
    const reread = await resolveReadIndexView({ repoDir, ref: base, allowBuild: false });
    assert.ok(reread.ok, 'restored entry still validates');
    reread.view.release();
    racer?.();

    cacheTestHooks.afterMoveAside = () => {};
    try {
      assert.equal(removeSnapshotEntry(repoDir, id), 'removed', 'without a racing reader the entry is deleted');
    } finally {
      cacheTestHooks.afterMoveAside = undefined;
    }
    const leftovers = fs.readdirSync(path.dirname(entryDir)).filter((n) => n.startsWith('.staging-evict-'));
    assert.deepEqual(leftovers, [], 'no moved-aside directory is left behind');
  });

  it('withReadIndexView releases the pin even when the callback throws', async () => {
    const { repoDir, base } = mkRepo();
    cleanup.push(repoDir);
    let identity = '';
    await assert.rejects(withReadIndexView({ repoDir, ref: base }, async (view) => {
      identity = view.identity;
      throw new Error('boom');
    }), /boom/);
    assert.ok(identity);
    assert.equal(hasLiveReadPin(repoDir, identity), false);
  });
});
