import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshotDescriptor, computeSnapshotId, descriptorsMatch } from '../../../src/snapshots/fingerprint.js';

describe('fingerprint: snapshot descriptor identity', () => {
  it('is deterministic for identical inputs, independent of createdAt', async () => {
    const a = buildSnapshotDescriptor({ repositoryIdentity: 'repo-1', gitTree: 'tree-abc', commit: 'commit-abc' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = buildSnapshotDescriptor({ repositoryIdentity: 'repo-1', gitTree: 'tree-abc', commit: 'commit-abc' });

    assert.notEqual(a.createdAt, b.createdAt, 'sanity: createdAt should actually differ between calls');
    assert.equal(a.snapshotId, b.snapshotId, 'snapshotId must not depend on createdAt');
    assert.ok(descriptorsMatch(a, b));
  });

  it('changes when the Git tree changes', () => {
    const a = buildSnapshotDescriptor({ repositoryIdentity: 'repo-1', gitTree: 'tree-abc' });
    const b = buildSnapshotDescriptor({ repositoryIdentity: 'repo-1', gitTree: 'tree-def' });
    assert.notEqual(a.snapshotId, b.snapshotId);
  });

  it('changes when the repository identity changes, even for the same tree', () => {
    const a = buildSnapshotDescriptor({ repositoryIdentity: 'repo-1', gitTree: 'tree-abc' });
    const b = buildSnapshotDescriptor({ repositoryIdentity: 'repo-2', gitTree: 'tree-abc' });
    assert.notEqual(a.snapshotId, b.snapshotId);
  });

  it('changes when dirtyStateFingerprint is present vs absent', () => {
    const a = buildSnapshotDescriptor({ repositoryIdentity: 'repo-1', gitTree: 'tree-abc' });
    const b = buildSnapshotDescriptor({ repositoryIdentity: 'repo-1', gitTree: 'tree-abc', dirtyStateFingerprint: 'dirty-1' });
    assert.notEqual(a.snapshotId, b.snapshotId);
  });

  it('computeSnapshotId is a pure function of its fields, excluding snapshotId/createdAt themselves', () => {
    const base = {
      repositoryIdentity: 'repo-1',
      gitTree: 'tree-abc',
      commit: 'commit-abc',
      dirtyStateFingerprint: undefined,
      parserFingerprint: 'p1',
      factSchemaFingerprint: 'f1',
      identityFingerprint: 'i1',
      resolverFingerprint: 'r1',
      graphSchemaFingerprint: 'g1',
      contractFingerprint: 'c1',
    };
    assert.equal(computeSnapshotId(base), computeSnapshotId({ ...base }));
    assert.notEqual(computeSnapshotId(base), computeSnapshotId({ ...base, resolverFingerprint: 'r2' }));
  });
});
