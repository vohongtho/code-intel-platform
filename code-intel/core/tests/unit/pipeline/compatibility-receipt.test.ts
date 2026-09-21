import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrameworkFingerprint, buildAnalyzerCompatibilityReceipt } from '../../../src/pipeline/compatibility-receipt.js';

describe('buildFrameworkFingerprint', () => {
  it('is undefined when no frameworks were detected', () => {
    assert.equal(buildFrameworkFingerprint([], '1'), undefined);
  });

  it('is stable for the same detections regardless of input order', () => {
    const a = buildFrameworkFingerprint(
      [{ frameworkId: 'express', adapterVersion: '1' }, { frameworkId: 'nest', adapterVersion: '1' }],
      'fs-1',
    );
    const b = buildFrameworkFingerprint(
      [{ frameworkId: 'nest', adapterVersion: '1' }, { frameworkId: 'express', adapterVersion: '1' }],
      'fs-1',
    );
    assert.equal(a, b);
  });

  it('changes when a detected framework adapter is upgraded, even though the same frameworks are still detected (task 9.6)', () => {
    const before = buildFrameworkFingerprint([{ frameworkId: 'express', adapterVersion: '1' }], 'fs-1');
    const after = buildFrameworkFingerprint([{ frameworkId: 'express', adapterVersion: '2' }], 'fs-1');
    assert.notEqual(before, after, 'an adapterVersion bump on a still-detected framework must invalidate the persisted fingerprint');
  });

  it('does not change when an unrelated detected framework is added with the same set otherwise unchanged in isolation', () => {
    const one = buildFrameworkFingerprint([{ frameworkId: 'express', adapterVersion: '1' }], 'fs-1');
    const two = buildFrameworkFingerprint(
      [{ frameworkId: 'express', adapterVersion: '1' }, { frameworkId: 'nest', adapterVersion: '1' }],
      'fs-1',
    );
    assert.notEqual(one, two, 'adding a newly-detected framework must also change the fingerprint');
  });
});

describe('buildAnalyzerCompatibilityReceipt', () => {
  it('is deterministic for identical inputs', () => {
    const args = { parser: 'tree-sitter' as const, identityFingerprint: 'symbol-identity-v2' };
    const a = buildAnalyzerCompatibilityReceipt(args);
    const b = buildAnalyzerCompatibilityReceipt(args);
    assert.deepEqual(a, b);
  });

  it('changes the resolver fingerprint when the identity fingerprint changes, with source bytes/other inputs held constant', () => {
    const a = buildAnalyzerCompatibilityReceipt({ parser: 'tree-sitter', identityFingerprint: 'symbol-identity-v2' });
    const b = buildAnalyzerCompatibilityReceipt({ parser: 'tree-sitter', identityFingerprint: 'symbol-identity-v3-hypothetical' });
    assert.notEqual(a.resolverFingerprint, b.resolverFingerprint);
    assert.notEqual(a.identityFingerprint, b.identityFingerprint);
  });
});
