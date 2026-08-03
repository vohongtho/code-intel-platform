import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  acquireAnalyzeLock,
  AnalysisAlreadyRunningError,
  getAnalyzeLockPath,
} from '../../../src/storage/analyze-lock.js';

function repo(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-lock-')); }

describe('repository analyze lock', () => {
  it('rejects a second concurrent analysis', () => {
    const root = repo();
    const first = acquireAnalyzeLock(root);
    try {
      assert.throws(() => acquireAnalyzeLock(root), AnalysisAlreadyRunningError);
    } finally {
      first.release();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not recover a live same-host lock even when the TTL is zero', () => {
    const root = repo();
    const first = acquireAnalyzeLock(root);
    try {
      assert.throws(
        () => acquireAnalyzeLock(root, { staleAfterMs: 0 }),
        AnalysisAlreadyRunningError,
      );
    } finally {
      first.release();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('can be acquired again after release', () => {
    const root = repo();
    try {
      const first = acquireAnalyzeLock(root);
      first.release();
      const second = acquireAnalyzeLock(root);
      second.release();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('recovers a dead same-host owner', () => {
    const root = repo();
    try {
      const lockPath = getAnalyzeLockPath(root);
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.writeFileSync(lockPath, JSON.stringify({
        version: 1,
        token: 'dead',
        pid: 2147483647,
        hostname: os.hostname(),
        startedAt: '2000-01-01T00:00:00.000Z',
      }));
      const lock = acquireAnalyzeLock(root);
      assert.notEqual(lock.owner.token, 'dead');
      lock.release();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
