import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ContextDeliverySession, contentFingerprint } from '../../../src/context/session.js';

describe('contentFingerprint', () => {
  it('same content produces the same fingerprint', () => {
    assert.equal(contentFingerprint('function a() {}'), contentFingerprint('function a() {}'));
  });

  it('different content produces a different fingerprint', () => {
    assert.notEqual(contentFingerprint('function a() {}'), contentFingerprint('function b() {}'));
  });
});

describe('ContextDeliverySession', () => {
  it('lookup returns undefined for an artifact never recorded', () => {
    const session = new ContextDeliverySession('workspace-a');
    assert.equal(session.lookup('sym-1'), undefined);
  });

  it('record then lookup returns the stored fingerprint/bytes', () => {
    const session = new ContextDeliverySession('workspace-a');
    session.record('sym-1', contentFingerprint('function a() {}'), 16);
    const record = session.lookup('sym-1');
    assert.ok(record);
    assert.equal(record?.contentFingerprint, contentFingerprint('function a() {}'));
    assert.equal(record?.deliveredBytes, 16);
    assert.equal(record?.workspaceIdentity, 'workspace-a');
  });

  it('two independent sessions do not share delivered-source memory', () => {
    const sessionA = new ContextDeliverySession('workspace-a');
    const sessionB = new ContextDeliverySession('workspace-b');
    sessionA.record('sym-1', contentFingerprint('x'), 1);
    assert.equal(sessionB.lookup('sym-1'), undefined);
  });

  it('beginCall increments a monotonically increasing call index', () => {
    const session = new ContextDeliverySession('workspace-a');
    assert.equal(session.beginCall(), 1);
    assert.equal(session.beginCall(), 2);
    assert.equal(session.beginCall(), 3);
  });
});
