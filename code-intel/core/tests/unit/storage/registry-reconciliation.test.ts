import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmpHome: string;
let saveRegistry: typeof import('../../../src/storage/repo-registry.js')['saveRegistry'];
let loadRegistry: typeof import('../../../src/storage/repo-registry.js')['loadRegistry'];
let reconcileRegistryEntry: typeof import('../../../src/storage/registry-reconciliation.js')['reconcileRegistryEntry'];

const backupHome = process.env['HOME'];

describe('registry-reconciliation', () => {
  before(async () => {
    tmpHome = path.join(os.tmpdir(), `registry-reconcile-${Date.now()}`);
    process.env['HOME'] = tmpHome;
    fs.mkdirSync(path.join(tmpHome, '.code-intel'), { recursive: true });

    const registryMod = await import('../../../src/storage/repo-registry.js');
    saveRegistry = registryMod.saveRegistry;
    loadRegistry = registryMod.loadRegistry;

    const reconcileMod = await import('../../../src/storage/registry-reconciliation.js');
    reconcileRegistryEntry = reconcileMod.reconcileRegistryEntry;
  });

  after(() => {
    if (backupHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = backupHome;
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const metadata = {
    repoId: 'published-repo-id',
    indexedAt: '2025-01-01T00:00:00.000Z',
    stats: { nodes: 10, edges: 5, files: 2, duration: 0 },
  };

  it('restores a missing registry entry from published metadata', () => {
    saveRegistry([]);
    const repoPath = '/repos/missing';

    const result = reconcileRegistryEntry({
      workspaceRoot: repoPath,
      requestedName: 'restored',
      metadata,
    });

    assert.equal(result.outcome, 'registered');
    assert.equal(result.entry?.id, metadata.repoId);
    assert.equal(result.entry?.name, 'restored');
    assert.equal(result.entry?.path, path.resolve(repoPath));
    assert.equal(result.entry?.indexedAt, metadata.indexedAt);
    assert.equal(result.entry?.stats.nodes, metadata.stats.nodes);
    assert.ok(loadRegistry().some((entry) => entry.path === path.resolve(repoPath) && entry.id === metadata.repoId));
  });

  it('returns unchanged when matching path entry already exists', () => {
    saveRegistry([{ id: 'repo-1', name: 'existing', path: path.resolve('/repos/existing'), indexedAt: metadata.indexedAt, stats: { nodes: 1, edges: 0, files: 1 } }]);

    const result = reconcileRegistryEntry({
      workspaceRoot: '/repos/existing',
      requestedName: 'existing',
      metadata,
    });

    assert.equal(result.outcome, 'unchanged');
    assert.equal(result.entry?.id, 'repo-1');
  });

  it('reports rename guidance when path exists under a different name', () => {
    saveRegistry([{ id: 'repo-1', name: 'alpha', path: path.resolve('/repos/same-path'), indexedAt: metadata.indexedAt, stats: { nodes: 1, edges: 0, files: 1 } }]);

    const result = reconcileRegistryEntry({
      workspaceRoot: '/repos/same-path',
      requestedName: 'beta',
      metadata,
    });

    assert.equal(result.outcome, 'conflict');
    assert.match(result.message, /already registered as "alpha"/);
    assert.match(result.guidance ?? '', /rename flow/);
  });

  it('reports relink guidance when name exists on a different path', () => {
    saveRegistry([{ id: 'repo-1', name: 'alpha', path: path.resolve('/repos/original'), indexedAt: metadata.indexedAt, stats: { nodes: 1, edges: 0, files: 1 } }]);

    const result = reconcileRegistryEntry({
      workspaceRoot: '/repos/new-path',
      requestedName: 'alpha',
      metadata,
    });

    assert.equal(result.outcome, 'conflict');
    assert.match(result.message, /already linked to path/);
    assert.match(result.guidance ?? '', /relink flow/);
  });

  it('reports relink guidance when published repoId is already owned by another path', () => {
    saveRegistry([{ id: metadata.repoId, name: 'alpha', path: path.resolve('/repos/original'), indexedAt: metadata.indexedAt, stats: { nodes: 1, edges: 0, files: 1 } }]);

    const result = reconcileRegistryEntry({
      workspaceRoot: '/repos/new-path',
      requestedName: 'restored',
      metadata,
    });

    assert.equal(result.outcome, 'conflict');
    assert.match(result.message, /Repository ID/);
    assert.match(result.guidance ?? '', /relink flow/);
    const registry = loadRegistry();
    assert.equal(registry.length, 1);
    assert.equal(registry[0]?.path, path.resolve('/repos/original'));
    assert.equal(registry[0]?.id, metadata.repoId);
  });

  it('restores deterministically when metadata has no repoId', () => {
    saveRegistry([]);

    const result = reconcileRegistryEntry({
      workspaceRoot: '/repos/legacy',
      requestedName: 'legacy',
      metadata: {
        indexedAt: metadata.indexedAt,
        stats: metadata.stats,
      },
    });

    assert.equal(result.outcome, 'registered');
    assert.equal(result.entry?.name, 'legacy');
    assert.equal(result.entry?.path, path.resolve('/repos/legacy'));
    assert.ok(result.entry?.id);
    assert.notEqual(result.entry?.id, '');
  });
});
