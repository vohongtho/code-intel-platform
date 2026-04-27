import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorCodes, AppError } from '../../../src/errors/codes.js';

describe('ErrorCodes', () => {
  it('UNAUTHORIZED is CI-1000', () => {
    assert.equal(ErrorCodes.UNAUTHORIZED, 'CI-1000');
  });

  it('FORBIDDEN is CI-1001', () => {
    assert.equal(ErrorCodes.FORBIDDEN, 'CI-1001');
  });

  it('NOT_FOUND is CI-1002', () => {
    assert.equal(ErrorCodes.NOT_FOUND, 'CI-1002');
  });

  it('INVALID_REQUEST is CI-1200', () => {
    assert.equal(ErrorCodes.INVALID_REQUEST, 'CI-1200');
  });

  it('INTERNAL_ERROR is CI-5000', () => {
    assert.equal(ErrorCodes.INTERNAL_ERROR, 'CI-5000');
  });

  it('all codes start with CI-', () => {
    for (const code of Object.values(ErrorCodes)) {
      assert.ok(code.startsWith('CI-'), `Expected ${code} to start with CI-`);
    }
  });
});

describe('AppError', () => {
  it('constructs with required fields', () => {
    const err = new AppError('CI-1000', 'Unauthorized', 'Login first');
    assert.equal(err.code, 'CI-1000');
    assert.equal(err.message, 'Unauthorized');
    assert.equal(err.hint, 'Login first');
    assert.equal(err.statusCode, 500); // default
    assert.equal(err.name, 'AppError');
  });

  it('constructs with custom statusCode', () => {
    const err = new AppError('CI-1001', 'Forbidden', 'No access', 403);
    assert.equal(err.statusCode, 403);
  });

  it('constructs with optional docs', () => {
    const err = new AppError('CI-1002', 'Not Found', 'Check ID', 404, 'https://docs.example.com');
    assert.equal(err.docs, 'https://docs.example.com');
  });

  it('is instanceof Error', () => {
    const err = new AppError('CI-5000', 'Internal Error', 'Try again');
    assert.ok(err instanceof Error);
  });

  it('docs is undefined when not provided', () => {
    const err = new AppError('CI-1000', 'msg', 'hint');
    assert.equal(err.docs, undefined);
  });
});
