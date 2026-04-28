import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// group-manager.ts reads GROUPS_DIR = path.join(process.env.HOME ?? '~', '.code-intel', 'groups')
// We override HOME to redirect to a temp dir.

let restoreHome: () => void;
let groupsDir: string;
let listGroups: typeof import('../../../src/multi-repo/group-manager.js')['listGroups'];
let getGroup: typeof import('../../../src/multi-repo/group-manager.js')['getGroup'];
let createGroup: typeof import('../../../src/multi-repo/group-manager.js')['createGroup'];
let deleteGroup: typeof import('../../../src/multi-repo/group-manager.js')['deleteGroup'];

before(async () => {
  const tmpHome = path.join(os.tmpdir(), `gm-test-${Date.now()}`);
  fs.mkdirSync(tmpHome, { recursive: true });
  groupsDir = path.join(tmpHome, '.code-intel', 'groups');

  const origHome = process.env['HOME'];
  process.env['HOME'] = tmpHome;
  restoreHome = () => { process.env['HOME'] = origHome; };

  // Dynamic import after setting HOME
  const mod = await import('../../../src/multi-repo/group-manager.js');
  listGroups = mod.listGroups;
  getGroup = mod.getGroup;
  createGroup = mod.createGroup;
  deleteGroup = mod.deleteGroup;
});

after(() => {
  restoreHome?.();
  if (groupsDir) {
    try { fs.rmSync(path.dirname(groupsDir), { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('group-manager', () => {
  it('listGroups — returns empty array when groups dir does not exist', () => {
    // Dir hasn't been created yet at this point
    const result = listGroups();
    assert.ok(Array.isArray(result));
  });

  it('createGroup — creates .yml file in groups dir', () => {
    createGroup({ name: 'test-group', repos: [{ name: 'app', path: '/repos/app' }] });
    const f = path.join(groupsDir, 'test-group.yml');
    assert.ok(fs.existsSync(f));
  });

  it('listGroups — includes newly created group', () => {
    const groups = listGroups();
    assert.ok(groups.some((g) => g.name === 'test-group'));
  });

  it('getGroup — retrieves group by name', () => {
    const group = getGroup('test-group');
    assert.ok(group !== null);
    assert.equal(group!.name, 'test-group');
    assert.equal(group!.repos.length, 1);
    assert.equal(group!.repos[0]!.name, 'app');
  });

  it('getGroup — returns null for nonexistent group', () => {
    const group = getGroup('no-such-group');
    assert.equal(group, null);
  });

  it('deleteGroup — removes the group file', () => {
    createGroup({ name: 'to-delete', repos: [{ name: 'x', path: '/x' }] });
    assert.ok(getGroup('to-delete') !== null);
    deleteGroup('to-delete');
    assert.equal(getGroup('to-delete'), null);
  });

  it('deleteGroup — does not throw for nonexistent group', () => {
    assert.doesNotThrow(() => deleteGroup('never-existed'));
  });

  it('listGroups — only includes .yml and .yaml files', () => {
    // Create a non-yml file
    fs.mkdirSync(groupsDir, { recursive: true });
    fs.writeFileSync(path.join(groupsDir, 'notagroup.txt'), 'hello');
    const groups = listGroups();
    assert.ok(!groups.some((g) => g.name === 'notagroup'));
  });

  it('createGroup — multiple repos', () => {
    createGroup({
      name: 'multi-repo-group',
      repos: [
        { name: 'frontend', path: '/repos/fe' },
        { name: 'backend', path: '/repos/be' },
        { name: 'shared', path: '/repos/shared' },
      ],
    });
    const group = getGroup('multi-repo-group');
    assert.ok(group !== null);
    assert.equal(group!.repos.length, 3);
  });
});
