import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RepoGroup, GroupSyncResult } from '../../../src/multi-repo/types.js';
import {
  loadGroup,
  saveGroup,
  listGroups,
  deleteGroup,
  groupExists,
  addMember,
  removeMember,
  saveSyncResult,
  loadSyncResult,
} from '../../../src/multi-repo/group-registry.js';

// ── helpers ──────────────────────────────────────────────────────────────────

// The module uses GROUPS_DIR = path.join(os.homedir(), '.code-intel', 'groups')
// We can't override that constant, so we work with the actual GROUPS_DIR but
// use uniquely-prefixed group names to avoid collisions.

const PREFIX = `test-${Date.now()}-`;

function grpName(suffix: string): string {
  return `${PREFIX}${suffix}`;
}

function makeGroup(name: string): RepoGroup {
  return {
    name,
    createdAt: new Date().toISOString(),
    members: [],
  };
}

// Cleanup all test groups after each suite
const groupsDir = path.join(os.homedir(), '.code-intel', 'groups');

function cleanup(): void {
  if (!fs.existsSync(groupsDir)) return;
  for (const file of fs.readdirSync(groupsDir)) {
    if (file.startsWith(PREFIX)) {
      try { fs.unlinkSync(path.join(groupsDir, file)); } catch { /* ignore */ }
    }
  }
}

// ── saveGroup / loadGroup ─────────────────────────────────────────────────────

describe('saveGroup + loadGroup', () => {
  after(cleanup);

  it('round-trips a group', () => {
    const name = grpName('roundtrip');
    saveGroup(makeGroup(name));
    const loaded = loadGroup(name);
    assert.ok(loaded !== null);
    assert.equal(loaded!.name, name);
  });

  it('loadGroup — returns null for nonexistent group', () => {
    const result = loadGroup(grpName('does-not-exist'));
    assert.equal(result, null);
  });

  it('saves and loads a group with members', () => {
    const name = grpName('with-members');
    const group: RepoGroup = {
      name,
      createdAt: '2025-01-01T00:00:00.000Z',
      members: [
        { groupPath: 'frontend', registryName: 'my-frontend' },
        { groupPath: 'backend', registryName: 'my-backend' },
      ],
    };
    saveGroup(group);
    const loaded = loadGroup(name);
    assert.equal(loaded!.members.length, 2);
    assert.equal(loaded!.members[0]!.registryName, 'my-frontend');
  });

  it('overwrites existing group on re-save', () => {
    const name = grpName('overwrite');
    saveGroup({ name, createdAt: '2025-01-01T00:00:00.000Z', members: [] });
    saveGroup({ name, createdAt: '2025-06-01T00:00:00.000Z', members: [{ groupPath: 'x', registryName: 'y' }] });
    const loaded = loadGroup(name);
    assert.equal(loaded!.members.length, 1);
  });
});

// ── listGroups ────────────────────────────────────────────────────────────────

describe('listGroups', () => {
  after(cleanup);

  it('returns array (may be empty if no groups exist)', () => {
    const result = listGroups();
    assert.ok(Array.isArray(result));
  });

  it('includes newly saved group', () => {
    const name = grpName('list-test');
    saveGroup(makeGroup(name));
    const all = listGroups();
    assert.ok(all.some((g) => g.name === name));
  });

  it('does not include .sync.json files as groups', () => {
    const name = grpName('sync-excluded');
    saveGroup(makeGroup(name));
    const syncResult: GroupSyncResult = {
      groupName: name,
      syncedAt: new Date().toISOString(),
      memberCount: 0,
      contracts: [],
      links: [],
    };
    saveSyncResult(syncResult);
    const all = listGroups();
    // Should not have duplicate entries from sync file
    const matches = all.filter((g) => g.name === name);
    assert.equal(matches.length, 1);
  });
});

// ── deleteGroup ───────────────────────────────────────────────────────────────

describe('deleteGroup', () => {
  after(cleanup);

  it('removes an existing group', () => {
    const name = grpName('delete-me');
    saveGroup(makeGroup(name));
    assert.ok(loadGroup(name) !== null);
    deleteGroup(name);
    assert.equal(loadGroup(name), null);
  });

  it('does not throw for nonexistent group', () => {
    assert.doesNotThrow(() => deleteGroup(grpName('never-existed')));
  });
});

// ── groupExists ───────────────────────────────────────────────────────────────

describe('groupExists', () => {
  after(cleanup);

  it('returns true for saved group', () => {
    const name = grpName('exists-yes');
    saveGroup(makeGroup(name));
    assert.equal(groupExists(name), true);
  });

  it('returns false for nonexistent group', () => {
    assert.equal(groupExists(grpName('not-there')), false);
  });

  it('returns false after deletion', () => {
    const name = grpName('exists-then-delete');
    saveGroup(makeGroup(name));
    deleteGroup(name);
    assert.equal(groupExists(name), false);
  });
});

// ── addMember ─────────────────────────────────────────────────────────────────

describe('addMember', () => {
  after(cleanup);

  it('adds a new member to group', () => {
    const name = grpName('add-member');
    saveGroup(makeGroup(name));
    const updated = addMember(name, { groupPath: 'auth', registryName: 'auth-service' });
    assert.equal(updated.members.length, 1);
    assert.equal(updated.members[0]!.groupPath, 'auth');
  });

  it('replaces member with same groupPath', () => {
    const name = grpName('replace-member');
    saveGroup({ name, createdAt: new Date().toISOString(), members: [{ groupPath: 'api', registryName: 'old-api' }] });
    const updated = addMember(name, { groupPath: 'api', registryName: 'new-api' });
    assert.equal(updated.members.length, 1);
    assert.equal(updated.members[0]!.registryName, 'new-api');
  });

  it('throws when group does not exist', () => {
    assert.throws(
      () => addMember(grpName('no-group'), { groupPath: 'x', registryName: 'y' }),
      /not found/,
    );
  });
});

// ── removeMember ──────────────────────────────────────────────────────────────

describe('removeMember', () => {
  after(cleanup);

  it('removes a member by groupPath', () => {
    const name = grpName('remove-member');
    saveGroup({
      name,
      createdAt: new Date().toISOString(),
      members: [
        { groupPath: 'keep', registryName: 'keep-svc' },
        { groupPath: 'remove', registryName: 'remove-svc' },
      ],
    });
    const updated = removeMember(name, 'remove');
    assert.equal(updated.members.length, 1);
    assert.equal(updated.members[0]!.groupPath, 'keep');
  });

  it('throws when group does not exist', () => {
    assert.throws(
      () => removeMember(grpName('no-group'), 'some-path'),
      /not found/,
    );
  });

  it('throws when member path does not exist in group', () => {
    const name = grpName('no-member');
    saveGroup({ name, createdAt: new Date().toISOString(), members: [{ groupPath: 'a', registryName: 'a-svc' }] });
    assert.throws(
      () => removeMember(name, 'nonexistent-path'),
      /No member at path/,
    );
  });
});

// ── saveSyncResult / loadSyncResult ──────────────────────────────────────────

describe('saveSyncResult + loadSyncResult', () => {
  after(cleanup);

  it('round-trips a sync result', () => {
    const groupName = grpName('sync-roundtrip');
    const result: GroupSyncResult = {
      groupName,
      syncedAt: '2025-01-01T00:00:00.000Z',
      memberCount: 3,
      contracts: [],
      links: [],
    };
    saveSyncResult(result);
    const loaded = loadSyncResult(groupName);
    assert.ok(loaded !== null);
    assert.equal(loaded!.groupName, groupName);
    assert.equal(loaded!.memberCount, 3);
  });

  it('loadSyncResult — returns null for nonexistent group', () => {
    const result = loadSyncResult(grpName('no-sync'));
    assert.equal(result, null);
  });
});
