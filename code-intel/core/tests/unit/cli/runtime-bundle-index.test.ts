import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUNTIME_INDEX_LIMITS,
  compareRuntimeVersions,
  parseRuntimeBundleIndex,
  selectRuntimeIndexTarget,
} from '../../../src/cli/runtime-bundle-index.js';
import { sampleIndex } from './runtime-fixtures.js';

const parse = (value: unknown) => parseRuntimeBundleIndex(Buffer.from(JSON.stringify(value)));

describe('runtime bundle index', () => {
  it('parses a valid index and selects a target', () => {
    const index = parse(sampleIndex());
    assert.equal(index.release.tag, 'v1.0.12');
    assert.equal(selectRuntimeIndexTarget(index, 'linux-x64').archive.size, 10);
    assert.throws(() => selectRuntimeIndexTarget(index, 'darwin-arm64'), /TARGET_NOT_FOUND/);
  });

  it('rejects oversized and malformed input', () => {
    assert.throws(() => parseRuntimeBundleIndex(Buffer.alloc(RUNTIME_INDEX_LIMITS.maxIndexBytes + 1, 0x20)), /INDEX_TOO_LARGE/);
    assert.throws(() => parseRuntimeBundleIndex(Buffer.from('{not json')), /INDEX_MALFORMED/);
    assert.throws(() => parse([]), /INDEX_MALFORMED/);
  });

  it('rejects unknown schema and verification scheme', () => {
    assert.throws(() => parse(sampleIndex({ schemaVersion: 2 })), /INDEX_UNSUPPORTED_SCHEMA/);
    assert.throws(() => parse(sampleIndex({ verificationScheme: 'pgp' })), /INDEX_UNSUPPORTED_SCHEME/);
  });

  it('rejects unsafe file names, bad digests and inconsistent identity fields', () => {
    const withFile = (archive: unknown) => sampleIndex({ targets: [{ ...sampleIndex().targets[0], archive }] });
    assert.throws(() => parse(withFile({ name: '../evil.tar.gz', size: 1, sha256: 'a'.repeat(64) })), /archive.name/);
    assert.throws(() => parse(withFile({ name: 'sub/evil.tar.gz', size: 1, sha256: 'a'.repeat(64) })), /archive.name/);
    assert.throws(() => parse(withFile({ name: 'ok.tar.gz', size: -1, sha256: 'a'.repeat(64) })), /archive.size/);
    assert.throws(() => parse(withFile({ name: 'ok.tar.gz', size: 1, sha256: 'XYZ' })), /archive.sha256/);
    assert.throws(() => parse(sampleIndex({ release: { version: '1.0.12', tag: 'v1.0.13', commit: 'b'.repeat(40) } })), /release.tag/);
    assert.throws(() => parse(sampleIndex({ identity: { repository: 'a/b', workflow: '../x.yml' } })), /identity.workflow/);
    assert.throws(() => parse(sampleIndex({ targets: [sampleIndex().targets[0], sampleIndex().targets[0]] })), /duplicate/);
    assert.throws(() => parse(sampleIndex({ targets: [] })), /targets/);
  });

  it('orders versions numerically with prereleases first', () => {
    assert.ok(compareRuntimeVersions('1.0.12', '1.0.11') > 0);
    assert.ok(compareRuntimeVersions('1.0.9', '1.0.10') < 0);
    assert.ok(compareRuntimeVersions('1.0.12-rc.1', '1.0.12') < 0);
    assert.equal(compareRuntimeVersions('1.0.12', '1.0.12'), 0);
  });
});
