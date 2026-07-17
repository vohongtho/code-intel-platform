/**
 * Tests for default encrypted-file secret storage.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  keychainBackend,
  setKeychainSecret,
  getKeychainSecret,
  deleteKeychainSecret,
  _resetKeychainCacheForTests,
} from '../../../src/auth/keychain.js';

function setupSecretStore(tmpDir: string): { cleanup: () => void } {
  const secretsPath = path.join(tmpDir, '.secrets');
  const origKey = process.env['CODE_INTEL_SECRET_KEY'];
  const origPath = process.env['CODE_INTEL_SECRETS_PATH'];
  const origN = process.env['CODE_INTEL_SCRYPT_N'];

  process.env['CODE_INTEL_SECRET_KEY'] = crypto.randomBytes(32).toString('hex');
  process.env['CODE_INTEL_SECRETS_PATH'] = secretsPath;
  process.env['CODE_INTEL_SCRYPT_N'] = '1024';

  return {
    cleanup() {
      if (origKey === undefined) delete process.env['CODE_INTEL_SECRET_KEY'];
      else process.env['CODE_INTEL_SECRET_KEY'] = origKey;
      if (origPath === undefined) delete process.env['CODE_INTEL_SECRETS_PATH'];
      else process.env['CODE_INTEL_SECRETS_PATH'] = origPath;
      if (origN === undefined) delete process.env['CODE_INTEL_SCRYPT_N'];
      else process.env['CODE_INTEL_SCRYPT_N'] = origN;
    },
  };
}

describe('Keychain defaults to encrypted-file backend', () => {
  let tmpDir: string;
  let storeCleanup: () => void;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keychain-default-'));
    const setup = setupSecretStore(tmpDir);
    storeCleanup = setup.cleanup;
    _resetKeychainCacheForTests();
  });

  after(() => {
    storeCleanup();
    _resetKeychainCacheForTests();
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('keychainBackend() returns encrypted-file', async () => {
    const info = await keychainBackend();
    assert.equal(info.backend, 'encrypted-file');
  });

  it('setKeychainSecret + getKeychainSecret round-trip', async () => {
    await setKeychainSecret('retrieve-account', 'retrieve-value');
    const val = await getKeychainSecret('retrieve-account');
    assert.equal(val, 'retrieve-value');
  });

  it('getKeychainSecret returns null for unknown key', async () => {
    const val = await getKeychainSecret('non-existent-key-xyz-987');
    assert.equal(val, null);
  });

  it('deleteKeychainSecret removes value', async () => {
    const infoSet = await setKeychainSecret('delete-account', 'to-be-deleted');
    assert.equal(infoSet.backend, 'encrypted-file');
    const infoDel = await deleteKeychainSecret('delete-account');
    assert.equal(infoDel.backend, 'encrypted-file');
    const val = await getKeychainSecret('delete-account');
    assert.equal(val, null);
  });

  it('deleteKeychainSecret on non-existent key does not throw', async () => {
    await assert.doesNotReject(deleteKeychainSecret('totally-missing-key'));
  });

  it('multiple keys coexist in encrypted-file store', async () => {
    await setKeychainSecret('multi-a', 'value-a');
    await setKeychainSecret('multi-b', 'value-b');
    const a = await getKeychainSecret('multi-a');
    const b = await getKeychainSecret('multi-b');
    assert.equal(a, 'value-a');
    assert.equal(b, 'value-b');
    await deleteKeychainSecret('multi-a');
    await deleteKeychainSecret('multi-b');
  });
});
