/**
 * The repo registry and group registry must follow the home directory at call time.
 * They used to bind it at import, so a test that redirected HOME after a static import
 * read and wrote the developer's real ~/.code-intel (and emptied repos.json in cleanup).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadRegistry, saveRegistry } from '../../../src/storage/repo-registry.js';
import { listGroups, saveGroup } from '../../../src/multi-repo/group-registry.js';

describe('global registries follow HOME after import', () => {
  const originalHome = process.env['HOME'];
  let home = '';

  before(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-registry-home-'));
    process.env['HOME'] = home;
  });

  after(() => {
    if (originalHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = originalHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('reads and writes repos.json under the current HOME', () => {
    assert.deepEqual(loadRegistry(), [], 'a fresh HOME has an empty registry');
    saveRegistry([{ id: 'iso-1', name: 'iso', path: '/iso', indexedAt: new Date(0).toISOString(), stats: { nodes: 0, edges: 0, files: 0 } }]);
    assert.ok(fs.existsSync(path.join(home, '.code-intel', 'repos.json')));
    assert.deepEqual(loadRegistry().map((entry) => entry.id), ['iso-1']);
  });

  it('reads and writes groups under the current HOME', () => {
    saveGroup({ name: 'iso-group', createdAt: new Date(0).toISOString(), members: [] });
    assert.ok(fs.existsSync(path.join(home, '.code-intel', 'groups', 'iso-group.json')));
    assert.deepEqual(listGroups().map((group) => group.name), ['iso-group']);
  });
});
