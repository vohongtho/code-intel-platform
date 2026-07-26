import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmpHome: string;
let reposFile: string;
let loadRegistry: typeof import('../../../src/storage/repo-registry.js')['loadRegistry'];
let saveRegistry: typeof import('../../../src/storage/repo-registry.js')['saveRegistry'];
let upsertRepo: typeof import('../../../src/storage/repo-registry.js')['upsertRepo'];
let removeRepo: typeof import('../../../src/storage/repo-registry.js')['removeRepo'];
let renameRepo: typeof import('../../../src/storage/repo-registry.js')['renameRepo'];
let relinkRepo: typeof import('../../../src/storage/repo-registry.js')['relinkRepo'];

const backupHome = process.env['HOME'];

describe('repo-registry', () => {
  before(async () => {
    tmpHome = path.join(os.tmpdir(), `repo-reg-test-${Date.now()}`);
    process.env['HOME'] = tmpHome;
    fs.mkdirSync(path.join(tmpHome, '.code-intel'), { recursive: true });
    reposFile = path.join(tmpHome, '.code-intel', 'repos.json');

    const mod = await import('../../../src/storage/repo-registry.js');
    loadRegistry = mod.loadRegistry;
    saveRegistry = mod.saveRegistry;
    upsertRepo = mod.upsertRepo;
    removeRepo = mod.removeRepo;
    renameRepo = mod.renameRepo;
    relinkRepo = mod.relinkRepo;
  });

  after(() => {
    if (backupHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = backupHome;
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('loadRegistry — returns empty array when no registry exists', () => {
    try { fs.unlinkSync(reposFile); } catch { /* ignore */ }
    const result = loadRegistry();
    assert.deepEqual(result, []);
  });

  it('saveRegistry + loadRegistry — round-trip', () => {
    const entries = [
      { id: 'repo-1', name: 'my-project', path: '/home/user/my-project', indexedAt: '2025-01-01T00:00:00.000Z', stats: { nodes: 10, edges: 5, files: 2 } },
    ];
    saveRegistry(entries);
    const loaded = loadRegistry();
    const found = loaded.find((e) => e.id === 'repo-1');
    assert.ok(found !== undefined);
    assert.equal(found!.name, 'my-project');
    assert.equal(found!.stats.nodes, 10);
  });

  it('upsertRepo — adds new entry and generates id', () => {
    saveRegistry([]);
    const saved = upsertRepo({ name: 'new-repo', path: '/repos/new', indexedAt: '2025-06-01T00:00:00.000Z', stats: { nodes: 5, edges: 2, files: 1 } });
    const loaded = loadRegistry();
    const found = loaded.find((e) => e.path === path.resolve('/repos/new'));
    assert.ok(found !== undefined);
    assert.equal(found!.name, 'new-repo');
    assert.equal(found!.id, saved.id);
  });

  it('upsertRepo — updates existing entry by path and preserves id', () => {
    saveRegistry([{ id: 'repo-existing', name: 'existing', path: path.resolve('/repos/existing'), indexedAt: '2025-01-01T00:00:00.000Z', stats: { nodes: 1, edges: 0, files: 1 } }]);
    upsertRepo({ name: 'existing-updated', path: '/repos/existing', indexedAt: '2025-06-01T00:00:00.000Z', stats: { nodes: 99, edges: 50, files: 10 } });
    const loaded = loadRegistry();
    const found = loaded.find((e) => e.id === 'repo-existing');
    assert.ok(found !== undefined);
    assert.equal(found!.name, 'existing-updated');
    assert.equal(found!.stats.nodes, 99);
    assert.equal(loaded.filter((e) => e.path === path.resolve('/repos/existing')).length, 1);
  });

  it('renameRepo — renames uniquely and preserves id', () => {
    saveRegistry([{ id: 'repo-1', name: 'alpha', path: path.resolve('/repos/a'), indexedAt: '2025-01-01T00:00:00.000Z', stats: { nodes: 1, edges: 0, files: 1 } }]);
    const renamed = renameRepo('alpha', 'beta');
    assert.equal(renamed.id, 'repo-1');
    assert.equal(renamed.name, 'beta');
    assert.equal(loadRegistry()[0]?.name, 'beta');
  });

  it('relinkRepo — updates path and preserves id', () => {
    saveRegistry([{ id: 'repo-1', name: 'alpha', path: path.resolve('/repos/a'), indexedAt: '2025-01-01T00:00:00.000Z', stats: { nodes: 1, edges: 0, files: 1 } }]);
    const relinked = relinkRepo('alpha', '/repos/b');
    assert.equal(relinked.id, 'repo-1');
    assert.equal(relinked.path, path.resolve('/repos/b'));
  });

  it('removeRepo — removes entry by path', () => {
    saveRegistry([
      { id: 'keep', name: 'keep', path: path.resolve('/repos/keep'), indexedAt: '2025-01-01T00:00:00.000Z', stats: { nodes: 1, edges: 0, files: 1 } },
      { id: 'remove', name: 'remove', path: path.resolve('/repos/remove'), indexedAt: '2025-01-01T00:00:00.000Z', stats: { nodes: 2, edges: 0, files: 1 } },
    ]);
    removeRepo('/repos/remove');
    const loaded = loadRegistry();
    assert.equal(loaded.find((e) => e.id === 'remove'), undefined);
    assert.ok(loaded.find((e) => e.id === 'keep') !== undefined);
  });

  it('loadRegistry — migrates legacy entries and repairs duplicate names', () => {
    fs.mkdirSync(path.dirname(reposFile), { recursive: true });
    fs.writeFileSync(reposFile, JSON.stringify([
      { name: 'api', path: '/repos/a', indexedAt: '2025-01-01T00:00:00.000Z', stats: { nodes: 1, edges: 0, files: 1 } },
      { name: 'api', path: '/repos/b', indexedAt: '2025-01-01T00:00:00.000Z', stats: { nodes: 1, edges: 0, files: 1 } },
    ], null, 2));
    const loaded = loadRegistry();
    assert.equal(loaded.length, 2);
    assert.ok(loaded.every((e) => typeof e.id === 'string' && e.id.length > 0));
    assert.equal(new Set(loaded.map((e) => e.name)).size, 2);
  });
});
