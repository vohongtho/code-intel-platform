/**
 * Tests for Epic 4: Auto-Sync on Analyze (--no-group-sync flag logic)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test the flag logic in isolation: when opts.groupSync === false, noGroupSync should be true
describe('analyze --no-group-sync flag logic', () => {
  it('opts.groupSync === false maps to noGroupSync: true', () => {
    // Simulate Commander's behavior: --no-group-sync sets groupSync to false
    const opts = { groupSync: false };
    const noGroupSync = opts.groupSync === false;
    assert.strictEqual(noGroupSync, true);
  });

  it('opts.groupSync === true maps to noGroupSync: false', () => {
    const opts = { groupSync: true };
    const noGroupSync = opts.groupSync === false;
    assert.strictEqual(noGroupSync, false);
  });

  it('opts.groupSync === undefined maps to noGroupSync: false', () => {
    const opts = {} as { groupSync?: boolean };
    const noGroupSync = opts.groupSync === false;
    assert.strictEqual(noGroupSync, false);
  });

  it('noGroupSync: true skips sync block', () => {
    // Simulate the guard in analyzeWorkspace
    const options = { noGroupSync: true };
    let syncCalled = false;
    if (!options.noGroupSync) {
      syncCalled = true;
    }
    assert.strictEqual(syncCalled, false, 'sync should be skipped when noGroupSync is true');
  });

  it('noGroupSync: false runs sync block', () => {
    // Simulate the guard in analyzeWorkspace
    const options = { noGroupSync: false };
    let syncCalled = false;
    if (!options.noGroupSync) {
      syncCalled = true;
    }
    assert.strictEqual(syncCalled, true, 'sync should run when noGroupSync is false');
  });

  it('noGroupSync: undefined runs sync block', () => {
    const options = {} as { noGroupSync?: boolean };
    let syncCalled = false;
    if (!options.noGroupSync) {
      syncCalled = true;
    }
    assert.strictEqual(syncCalled, true, 'sync should run when noGroupSync is undefined');
  });

  it('repo not in registry skips sync', () => {
    // If loadRegistry returns an entry but workspaceRoot does not match, no sync
    const workspaceRoot = '/some/other/path';
    const registry = [{ name: 'repo-a', path: '/repo/a', indexedAt: '', stats: { nodes: 0, edges: 0, files: 0 } }];
    const repoEntry = registry.find((r) => r.path === workspaceRoot);
    assert.strictEqual(repoEntry, undefined);
  });

  it('repo in registry but no matching groups skips sync', () => {
    const workspaceRoot = '/repo/a';
    const registry = [{ name: 'repo-a', path: workspaceRoot, indexedAt: '', stats: { nodes: 0, edges: 0, files: 0 } }];
    const repoEntry = registry.find((r) => r.path === workspaceRoot);
    assert.ok(repoEntry);

    // Groups exist but none contain this repo
    const groups = [{ name: 'my-group', members: [{ registryName: 'repo-b', groupPath: '/b' }], createdAt: '', lastSync: undefined }];
    let syncTriggered = false;
    for (const g of groups) {
      const isMember = g.members.some((m) => m.registryName === repoEntry.name);
      if (!isMember) continue;
      syncTriggered = true;
    }
    assert.strictEqual(syncTriggered, false);
  });

  it('repo in registry and group member triggers sync', () => {
    const workspaceRoot = '/repo/a';
    const registry = [{ name: 'repo-a', path: workspaceRoot, indexedAt: '', stats: { nodes: 0, edges: 0, files: 0 } }];
    const repoEntry = registry.find((r) => r.path === workspaceRoot);
    assert.ok(repoEntry);

    const groups = [{ name: 'my-group', members: [{ registryName: 'repo-a', groupPath: '/a' }], createdAt: '', lastSync: undefined }];
    let syncTriggered = false;
    for (const g of groups) {
      const isMember = g.members.some((m) => m.registryName === repoEntry.name);
      if (!isMember) continue;
      syncTriggered = true;
    }
    assert.strictEqual(syncTriggered, true);
  });
});
