import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Redirect all repo-registry reads/writes to a temporary directory via
// CODE_INTEL_HOME so the real ~/.code-intel/repos.json is never touched.

let tmpHome: string;
let loadRegistry: typeof import('../../../src/storage/repo-registry.js')['loadRegistry'];
let saveRegistry: typeof import('../../../src/storage/repo-registry.js')['saveRegistry'];
let upsertRepo: typeof import('../../../src/storage/repo-registry.js')['upsertRepo'];
let removeRepo: typeof import('../../../src/storage/repo-registry.js')['removeRepo'];

describe('repo-registry', () => {
  before(async () => {
    tmpHome = path.join(os.tmpdir(), `repo-reg-test-${Date.now()}`);
    fs.mkdirSync(path.join(tmpHome, '.code-intel'), { recursive: true });

    // Point the registry at our temp home so no real data is touched.
    process.env['CODE_INTEL_HOME'] = tmpHome;

    const mod = await import('../../../src/storage/repo-registry.js');
    loadRegistry = mod.loadRegistry;
    saveRegistry = mod.saveRegistry;
    upsertRepo = mod.upsertRepo;
    removeRepo = mod.removeRepo;
  });

  after(() => {
    delete process.env['CODE_INTEL_HOME'];
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('loadRegistry — returns empty array when no registry exists', () => {
    // The temp dir has no repos.json yet — should return []
    const reposFile = path.join(tmpHome, '.code-intel', 'repos.json');
    try { fs.unlinkSync(reposFile); } catch { /* already absent */ }

    const result = loadRegistry();
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('saveRegistry + loadRegistry — round-trip', () => {
    const entries = [
      { name: 'my-project', path: '/home/user/my-project', indexedAt: '2025-01-01T00:00:00.000Z', stats: { nodes: 10, edges: 5, files: 2 } },
    ];
    saveRegistry(entries);
    const loaded = loadRegistry();
    assert.ok(Array.isArray(loaded));
    const found = loaded.find((e) => e.path === '/home/user/my-project');
    assert.ok(found !== undefined);
    assert.equal(found!.name, 'my-project');
    assert.equal(found!.stats.nodes, 10);
  });

  it('upsertRepo — adds new entry', () => {
    // Clear first
    saveRegistry([]);
    upsertRepo({ name: 'new-repo', path: '/repos/new', indexedAt: '2025-06-01T00:00:00.000Z', stats: { nodes: 5, edges: 2, files: 1 } });
    const loaded = loadRegistry();
    const found = loaded.find((e) => e.path === '/repos/new');
    assert.ok(found !== undefined);
    assert.equal(found!.name, 'new-repo');
  });

  it('upsertRepo — updates existing entry', () => {
    saveRegistry([{ name: 'existing', path: '/repos/existing', indexedAt: '2025-01-01T00:00:00.000Z', stats: { nodes: 1, edges: 0, files: 1 } }]);
    upsertRepo({ name: 'existing-updated', path: '/repos/existing', indexedAt: '2025-06-01T00:00:00.000Z', stats: { nodes: 99, edges: 50, files: 10 } });
    const loaded = loadRegistry();
    const found = loaded.find((e) => e.path === '/repos/existing');
    assert.ok(found !== undefined);
    assert.equal(found!.name, 'existing-updated');
    assert.equal(found!.stats.nodes, 99);
    // Should not duplicate
    const all = loaded.filter((e) => e.path === '/repos/existing');
    assert.equal(all.length, 1);
  });

  it('removeRepo — removes entry by path', () => {
    saveRegistry([
      { name: 'keep', path: '/repos/keep', indexedAt: '2025-01-01T00:00:00.000Z', stats: { nodes: 1, edges: 0, files: 1 } },
      { name: 'remove', path: '/repos/remove', indexedAt: '2025-01-01T00:00:00.000Z', stats: { nodes: 2, edges: 0, files: 1 } },
    ]);
    removeRepo('/repos/remove');
    const loaded = loadRegistry();
    const removed = loaded.find((e) => e.path === '/repos/remove');
    const kept = loaded.find((e) => e.path === '/repos/keep');
    assert.equal(removed, undefined);
    assert.ok(kept !== undefined);
  });

  it('removeRepo — no-op for unknown path', () => {
    saveRegistry([{ name: 'only', path: '/repos/only', indexedAt: '2025-01-01T00:00:00.000Z', stats: { nodes: 1, edges: 0, files: 1 } }]);
    assert.doesNotThrow(() => removeRepo('/repos/nonexistent'));
    const loaded = loadRegistry();
    assert.equal(loaded.length, 1);
  });
});
