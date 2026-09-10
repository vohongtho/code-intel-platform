import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEvidenceStore, getEvidenceDbPath, EVIDENCE_DB_FILE } from '../../../src/evidence/store.js';

function makeRepoDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-evidence-'));
}

describe('evidence store', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeRepoDir();
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('stores and loads evidence by id', () => {
    const store = createEvidenceStore(repoDir);
    store.put({
      id: 'ev:1',
      version: 1,
      referenceId: 'ref:1',
      resolverVersion: 'resolver-v1',
      strategy: 'same-file',
      confidence: 0.95,
      certainty: 'exact',
      coverage: {
        complete: true,
        examinedCount: 1,
        incompleteReasons: [],
      },
      boundaries: [{ kind: 'dynamic-dispatch', evidenceRefs: ['ev:1'] }],
      candidateIds: ['target:1'],
      rejectedCandidateReasons: ['shadowed'],
      source: { filePath: '/src/a.ts', startLine: 3, endLine: 3 },
      details: { name: 'foo' },
      recordedAt: '2025-01-01T00:00:00.000Z',
    });

    const record = store.get('ev:1');
    store.close();

    assert.ok(record);
    assert.equal(record!.referenceId, 'ref:1');
    assert.equal(record!.certainty, 'exact');
    assert.deepEqual(record!.boundaries, [{ kind: 'dynamic-dispatch', evidenceRefs: ['ev:1'] }]);
  });

  it('loads evidence by reference in time order', () => {
    const store = createEvidenceStore(repoDir);
    store.put({
      id: 'ev:1',
      version: 1,
      referenceId: 'ref:1',
      resolverVersion: 'resolver-v1',
      strategy: 'same-file',
      recordedAt: '2025-01-01T00:00:00.000Z',
    });
    store.put({
      id: 'ev:2',
      version: 1,
      referenceId: 'ref:1',
      resolverVersion: 'resolver-v1',
      strategy: 'global',
      recordedAt: '2025-01-01T00:00:01.000Z',
    });

    const records = store.getByReference('ref:1');
    store.close();

    assert.deepEqual(records.map((r) => r.id), ['ev:1', 'ev:2']);
  });

  it('creates evidence db under .code-intel', () => {
    assert.equal(getEvidenceDbPath(repoDir), path.join(repoDir, '.code-intel', EVIDENCE_DB_FILE));
  });

  it('reopens persisted evidence after close', () => {
    const store = createEvidenceStore(repoDir);
    store.put({
      id: 'ev:reopen',
      version: 1,
      referenceId: 'ref:reopen',
      resolverVersion: 'resolver-v1',
      strategy: 'same-file',
      recordedAt: '2025-01-01T00:00:00.000Z',
    });
    store.close();

    const reopened = createEvidenceStore(repoDir);
    const record = reopened.get('ev:reopen');
    reopened.close();

    assert.ok(record);
    assert.equal(record?.referenceId, 'ref:reopen');
  });

  it('returns compact read-back receipt for persisted evidence', () => {
    const store = createEvidenceStore(repoDir);
    store.put({
      id: 'ev:receipt',
      version: 1,
      referenceId: 'ref:receipt',
      resolverVersion: 'resolver-v1',
      strategy: 'semantic-call',
      recordedAt: '2025-01-01T00:00:00.000Z',
    });

    const receipt = store.getReceipt('ev:receipt');
    store.close();

    assert.deepEqual(receipt, {
      id: 'ev:receipt',
      version: 1,
      referenceId: 'ref:receipt',
      resolverVersion: 'resolver-v1',
      strategy: 'semantic-call',
      recordedAt: '2025-01-01T00:00:00.000Z',
    });
  });

  it('counts persisted records independently of any specific record id, for genuine read-back verification', () => {
    const store = createEvidenceStore(repoDir);
    assert.equal(store.count(), 0);
    store.put({
      id: 'ev:a', version: 1, referenceId: 'ref:a', resolverVersion: 'resolver-v1',
      strategy: 'semantic-call', recordedAt: '2025-01-01T00:00:00.000Z',
    });
    store.put({
      id: 'ev:b', version: 1, referenceId: 'ref:b', resolverVersion: 'resolver-v1',
      strategy: 'semantic-call', recordedAt: '2025-01-01T00:00:00.000Z',
    });
    assert.equal(store.count(), 2);

    // A fresh store instance reopening the same on-disk db must see the same
    // count — this is what a real staging read-back check relies on.
    store.close();
    const reopened = createEvidenceStore(repoDir);
    assert.equal(reopened.count(), 2);
    reopened.close();
  });
});
