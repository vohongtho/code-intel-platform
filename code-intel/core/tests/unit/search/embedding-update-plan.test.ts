import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEmbeddingUpdatePlan } from '../../../src/search/embedding-update-plan.js';

const healthy = {
  enabled: true,
  force: false,
  changeSetKnown: true,
  changedPaths: [] as string[],
  deletedPaths: [] as string[],
  hasVectorDb: true,
  embeddingsNeedRebuild: false,
};

describe('resolveEmbeddingUpdatePlan', () => {
  it('builds full vectors on first use', () => {
    assert.deepEqual(resolveEmbeddingUpdatePlan({ ...healthy, hasVectorDb: false }), {
      mode: 'full', reason: 'vector-missing',
    });
  });

  it('updates only changed and deleted paths', () => {
    assert.deepEqual(resolveEmbeddingUpdatePlan({
      ...healthy,
      changedPaths: ['src/changed.ts'],
      deletedPaths: ['src/deleted.ts'],
    }), {
      mode: 'incremental', paths: ['src/changed.ts', 'src/deleted.ts'],
    });
  });

  it('deduplicates paths', () => {
    assert.deepEqual(resolveEmbeddingUpdatePlan({
      ...healthy,
      changedPaths: ['src/a.ts'],
      deletedPaths: ['src/a.ts'],
    }), {
      mode: 'incremental', paths: ['src/a.ts'],
    });
  });

  it('skips known zero-change runs', () => {
    assert.deepEqual(resolveEmbeddingUpdatePlan(healthy), {
      mode: 'skip', reason: 'no-changes',
    });
  });

  it('fails safe to a full rebuild when change scope is unknown', () => {
    assert.deepEqual(resolveEmbeddingUpdatePlan({ ...healthy, changeSetKnown: false }), {
      mode: 'full', reason: 'change-set-unknown',
    });
  });

  it('full rebuilds stale or incompatible vectors', () => {
    assert.deepEqual(resolveEmbeddingUpdatePlan({ ...healthy, embeddingsNeedRebuild: true }), {
      mode: 'full', reason: 'fingerprint-or-state-stale',
    });
  });

  it('honors force', () => {
    assert.deepEqual(resolveEmbeddingUpdatePlan({ ...healthy, force: true }), {
      mode: 'full', reason: 'forced',
    });
  });

  it('skips when embeddings are disabled', () => {
    assert.deepEqual(resolveEmbeddingUpdatePlan({ ...healthy, enabled: false }), {
      mode: 'skip', reason: 'disabled',
    });
  });
});
