import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Logger from '../../../src/shared/logger.js';

describe('Logger — sensitive data masking', () => {
  it('maskSensitiveData — masks middle chars, keeps first and last', () => {
    const masked = Logger.maskSensitiveData('mysecret');
    assert.ok(masked.startsWith('m'));
    assert.ok(masked.endsWith('t'));
    assert.ok(masked.includes('*'));
  });

  it('maskSensitiveData — short values unchanged', () => {
    const masked = Logger.maskSensitiveData('abc');
    assert.equal(masked, 'abc');
  });

  it('maskSensitive — masks password in string', () => {
    const { maskedMessage } = Logger.maskSensitive('password=supersecret');
    assert.ok(!maskedMessage.includes('supersecret'));
  });

  it('maskSensitive — masks token in args object', () => {
    const { maskedArgs } = Logger.maskSensitive('info', [{ token: 'abcdef1234' }]);
    const arg = maskedArgs[0] as { token: string };
    assert.ok(!arg.token.includes('abcdef1234'));
    assert.ok(arg.token.includes('*'));
  });

  it('maskSensitive — masks password key in nested object', () => {
    const { maskedArgs } = Logger.maskSensitive('login', [{ user: { password: 'hunter2' } }]);
    const arg = maskedArgs[0] as { user: { password: string } };
    assert.ok(!arg.user.password.includes('hunter2'));
  });

  it('maskSensitive — leaves non-sensitive keys untouched', () => {
    const { maskedArgs } = Logger.maskSensitive('info', [{ name: 'alice', age: 30 }]);
    const arg = maskedArgs[0] as { name: string; age: number };
    assert.equal(arg.name, 'alice');
    assert.equal(arg.age, 30);
  });

  it('maskSensitive — masks bearer token in string', () => {
    const { maskedMessage } = Logger.maskSensitive('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature');
    assert.ok(!maskedMessage.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
  });

  it('Logger.info/warn/error/debug — do not throw', () => {
    assert.doesNotThrow(() => Logger.info('test info message'));
    assert.doesNotThrow(() => Logger.warn('test warn message'));
    assert.doesNotThrow(() => Logger.error('test error message'));
    assert.doesNotThrow(() => Logger.debug('test debug message'));
  });
});
