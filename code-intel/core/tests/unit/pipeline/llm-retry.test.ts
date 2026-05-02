import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CircuitBreaker,
  withRetry,
  isRateLimitError,
} from '../../../src/llm/retry.js';

// ─── isRateLimitError ─────────────────────────────────────────────────────────

describe('isRateLimitError', () => {
  it('returns true for 429 in message', () => {
    assert.ok(isRateLimitError(new Error('HTTP 429 Too Many Requests')));
  });

  it('returns true for "rate limit" in message', () => {
    assert.ok(isRateLimitError(new Error('You have exceeded the rate limit')));
  });

  it('returns true for "too many requests"', () => {
    assert.ok(isRateLimitError(new Error('Too many requests')));
  });

  it('returns false for unrelated errors', () => {
    assert.ok(!isRateLimitError(new Error('Network timeout')));
    assert.ok(!isRateLimitError(new Error('Invalid API key')));
  });

  it('returns false for non-Error values', () => {
    assert.ok(!isRateLimitError('rate limit'));
    assert.ok(!isRateLimitError(429));
    assert.ok(!isRateLimitError(null));
  });
});

// ─── CircuitBreaker ───────────────────────────────────────────────────────────

describe('CircuitBreaker', () => {
  it('is closed initially', () => {
    const cb = new CircuitBreaker();
    assert.equal(cb.isOpen, false);
  });

  it('passes through successful calls', async () => {
    const cb = new CircuitBreaker();
    const result = await cb.call(async () => 42);
    assert.equal(result, 42);
    assert.equal(cb.failureCount, 0);
  });

  it('counts consecutive failures', async () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 4; i++) {
      try { await cb.call(async () => { throw new Error('fail'); }); } catch { /* expected */ }
    }
    assert.equal(cb.failureCount, 4);
    assert.equal(cb.isOpen, false); // 4 < 5 threshold
  });

  it('opens after 5 consecutive failures', async () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 5; i++) {
      try { await cb.call(async () => { throw new Error('fail'); }); } catch { /* expected */ }
    }
    assert.equal(cb.isOpen, true);
  });

  it('rejects calls when open', async () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 5; i++) {
      try { await cb.call(async () => { throw new Error('fail'); }); } catch { /* expected */ }
    }
    await assert.rejects(
      () => cb.call(async () => 'should not run'),
      /circuit breaker OPEN/i,
    );
  });

  it('resets failure count after a success', async () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 3; i++) {
      try { await cb.call(async () => { throw new Error('fail'); }); } catch { /* expected */ }
    }
    await cb.call(async () => 'ok'); // success resets streak
    assert.equal(cb.failureCount, 0);
    assert.equal(cb.isOpen, false);
  });
});

// ─── withRetry ────────────────────────────────────────────────────────────────

describe('withRetry', () => {
  it('returns result immediately when call succeeds', async () => {
    let calls = 0;
    const result = await withRetry(async () => { calls++; return 'ok'; }, { maxAttempts: 3 });
    assert.equal(result, 'ok');
    assert.equal(calls, 1);
  });

  it('retries on rate limit errors and eventually succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('429 rate limit');
        return 'done';
      },
      { maxAttempts: 5, baseDelayMs: 1 }, // 1 ms base to keep tests fast
    );
    assert.equal(result, 'done');
    assert.equal(calls, 3);
  });

  it('does NOT retry non-rate-limit errors', async () => {
    let calls = 0;
    await assert.rejects(
      () => withRetry(
        async () => { calls++; throw new Error('Internal server error'); },
        { maxAttempts: 5, baseDelayMs: 1 },
      ),
      /Internal server error/,
    );
    assert.equal(calls, 1, 'Should not retry on non-rate-limit errors');
  });

  it('throws after maxAttempts rate-limit retries are exhausted', async () => {
    let calls = 0;
    await assert.rejects(
      () => withRetry(
        async () => { calls++; throw new Error('429 rate limit'); },
        { maxAttempts: 3, baseDelayMs: 1 },
      ),
      /429 rate limit/,
    );
    assert.equal(calls, 3);
  });

  it('respects maxAttempts: 1 (no retries)', async () => {
    let calls = 0;
    await assert.rejects(
      () => withRetry(
        async () => { calls++; throw new Error('429 rate limit'); },
        { maxAttempts: 1, baseDelayMs: 1 },
      ),
    );
    assert.equal(calls, 1);
  });
});
