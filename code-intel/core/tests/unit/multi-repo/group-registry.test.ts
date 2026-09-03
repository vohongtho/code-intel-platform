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
  verifySyncResultReadBack,
} from '../../../src/multi-repo/group-registry.js';
import { saveRegistry } from '../../../src/storage/repo-registry.js';

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

  it('quarantines unreadable group state instead of overwriting it', () => {
    const name = grpName('corrupt-group');
    const filePath = path.join(groupsDir, `${name}.json`);
    fs.mkdirSync(groupsDir, { recursive: true });
    fs.writeFileSync(filePath, '{not-json');
    assert.equal(loadGroup(name), null);
    assert.equal(fs.existsSync(`${filePath}.unreadable`), true);
  });

  it('saves and loads a group with members', () => {
    const name = grpName('with-members');
    const group: RepoGroup = {
      name,
      createdAt: '2025-01-01T00:00:00.000Z',
      members: [
        { groupPath: 'frontend', repoId: 'repo-frontend', registryName: 'my-frontend' },
        { groupPath: 'backend', repoId: 'repo-backend', registryName: 'my-backend' },
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
    saveGroup({ name, createdAt: '2025-06-01T00:00:00.000Z', members: [{ groupPath: 'x', repoId: 'repo-y', registryName: 'y' }] });
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
    saveRegistry([{ id: 'repo-auth', name: 'auth-service', path: '/repos/auth', indexedAt: '2025-01-01T00:00:00.000Z', stats: { nodes: 1, edges: 0, files: 1 } }]);
    const name = grpName('add-member');
    saveGroup(makeGroup(name));
    const updated = addMember(name, { groupPath: 'auth', repoId: 'repo-auth', registryName: 'auth-service' });
    assert.equal(updated.members.length, 1);
    assert.equal(updated.members[0]!.groupPath, 'auth');
  });

  it('replaces member with same groupPath', () => {
    saveRegistry([
      { id: 'repo-old', name: 'old-api', path: '/repos/old', indexedAt: '2025-01-01T00:00:00.000Z', stats: { nodes: 1, edges: 0, files: 1 } },
      { id: 'repo-new', name: 'new-api', path: '/repos/new', indexedAt: '2025-01-01T00:00:00.000Z', stats: { nodes: 1, edges: 0, files: 1 } },
    ]);
    const name = grpName('replace-member');
    saveGroup({ name, createdAt: new Date().toISOString(), members: [{ groupPath: 'api', repoId: 'repo-old', registryName: 'old-api' }] });
    const updated = addMember(name, { groupPath: 'api', repoId: 'repo-new', registryName: 'new-api' });
    assert.equal(updated.members.length, 1);
    assert.equal(updated.members[0]!.registryName, 'new-api');
  });

  it('throws when group does not exist', () => {
    saveRegistry([{ id: 'repo-y', name: 'y', path: '/repos/y', indexedAt: '2025-01-01T00:00:00.000Z', stats: { nodes: 1, edges: 0, files: 1 } }]);
    assert.throws(
      () => addMember(grpName('no-group'), { groupPath: 'x', repoId: 'repo-y', registryName: 'y' }),
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
        { groupPath: 'keep', repoId: 'repo-keep', registryName: 'keep-svc' },
        { groupPath: 'remove', repoId: 'repo-remove', registryName: 'remove-svc' },
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
    saveGroup({ name, createdAt: new Date().toISOString(), members: [{ groupPath: 'a', repoId: 'repo-a', registryName: 'a-svc' }] });
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
    assert.equal(loaded!.schemaVersion, '1.0.11');
  });

  it('loads legacy sync state conservatively', () => {
    const groupName = grpName('legacy-sync');
    const filePath = path.join(groupsDir, `${groupName}.sync.json`);
    fs.mkdirSync(groupsDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({
      groupName,
      syncedAt: '2025-01-01T00:00:00.000Z',
      memberCount: 1,
      contracts: [{
        repoName: 'repo',
        repoPath: '/repo',
        kind: 'schema',
        name: 'User',
        nodeId: 'sym:1',
        nodeKind: 'interface',
        filePath: 'src/user.ts',
      }],
      links: [{
        providerRepo: 'repo',
        providerContract: 'User',
        consumerRepo: 'web',
        consumerContract: 'User',
        matchKind: 'name-match',
        confidence: 0.5,
      }],
    }, null, 2));

    const loaded = loadSyncResult(groupName);
    assert.ok(loaded !== null);
    assert.equal(loaded!.contracts[0]!.certainty, 'legacy');
    assert.equal(loaded!.contracts[0]!.role, 'unknown');
    assert.equal(loaded!.contracts[0]!.coverage?.complete, false);
    assert.equal(loaded!.links[0]!.certainty, 'legacy');
    assert.equal(loaded!.links[0]!.coverage?.complete, false);
  });

  it('quarantines unreadable sync state instead of overwriting it', () => {
    const groupName = grpName('corrupt-sync');
    const filePath = path.join(groupsDir, `${groupName}.sync.json`);
    fs.mkdirSync(groupsDir, { recursive: true });
    fs.writeFileSync(filePath, '{not-json');
    assert.equal(loadSyncResult(groupName), null);
    assert.equal(fs.existsSync(`${filePath}.unreadable`), true);
  });

  it('loadSyncResult — returns null for nonexistent group', () => {
    const result = loadSyncResult(grpName('no-sync'));
    assert.equal(result, null);
  });

  it('verifies read-back invariants for stored sync state', () => {
    const groupName = grpName('verify-sync');
    const result: GroupSyncResult = {
      groupName,
      syncedAt: '2025-01-01T00:00:00.000Z',
      memberCount: 1,
      contracts: [{
        repoName: 'repo',
        repoPath: '/repo',
        kind: 'schema',
        name: 'User',
        nodeId: 'sym:1',
        nodeKind: 'interface',
        filePath: 'src/user.ts',
        contractId: 'c1',
        semanticFingerprint: 'f1',
        sourceCanonicalId: 'sym:1',
      }],
      links: [{
        providerRepo: 'repo',
        providerContract: 'User',
        consumerRepo: 'web',
        consumerContract: 'User',
        matchKind: 'name-match',
        confidence: 1,
        providerContractId: 'c1',
        consumerContractId: 'c2',
        consumerSourceCanonicalId: 'sym:2',
      }],
    };
    saveSyncResult(result);
    assert.deepEqual(verifySyncResultReadBack(result), { ok: true });
  });
});
