/**
 * LLM call retry + circuit-breaker utilities.
 *
 * Retry policy  : exponential backoff on HTTP 429 / rate-limit errors.
 * Circuit breaker: after 5 consecutive failures, open for 60 s then half-open.
 */

const CIRCUIT_THRESHOLD = 20;
const CIRCUIT_OPEN_MS   = 30_000;

/**
 * Pure network connectivity failures (server unreachable, DNS, etc.).
 * These should NOT trip the circuit breaker — they indicate the LLM server
 * is simply down, not overloaded.
 */
function isNetworkConnectivityError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('etimedout') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    msg.includes('connect econnrefused') ||
    msg.includes('network request failed') ||
    msg.includes('failed to fetch')
  );
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

export class CircuitBreaker {
  private failures  = 0;
  private openedAt: number | null = null;

  get isOpen(): boolean {
    if (this.openedAt === null) return false;
    // Auto-reset after the pause window
    if (Date.now() - this.openedAt >= CIRCUIT_OPEN_MS) {
      this.openedAt = null;
      this.failures = 0;
      return false;
    }
    return true;
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen) {
      throw new Error(
        'LLM circuit breaker OPEN — too many consecutive failures; auto-retrying in 60 s',
      );
    }
    try {
      const result = await fn();
      this.failures = 0; // reset streak on success
      return result;
    } catch (err) {
      // Network/connectivity errors (server unreachable) do NOT count toward the
      // circuit threshold — the breaker is only for overloaded or rate-limited
      // services, not for "server is simply down" scenarios.
      if (!isNetworkConnectivityError(err)) {
        this.failures++;
        if (this.failures >= CIRCUIT_THRESHOLD) {
          this.openedAt = Date.now();
        }
      }
      throw err;
    }
  }

  /** For testing: inspect current failure streak. */
  get failureCount(): number {
    return this.failures;
  }
}

// ─── Rate-limit detection ─────────────────────────────────────────────────────

export function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('ratelimit') ||
    msg.includes('too many requests')
  );
}

/**
 * Returns true for transient errors that are worth retrying:
 * - Rate limit (429)
 * - Network/fetch errors (connection refused, DNS, timeout, etc.)
 * - 5xx server errors
 */
export function isRetryableError(err: unknown): boolean {
  if (isRateLimitError(err)) return true;
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('etimedout') ||
    msg.includes('econnreset') ||
    msg.includes('network error') ||
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('socket hang up') ||
    msg.includes('connect econnrefused') ||
    // 5xx server-side errors
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504')
  );
}

// ─── Retry with exponential backoff ──────────────────────────────────────────

export interface RetryOptions {
  /** Max total attempts (including the first). Default: 5. */
  maxAttempts?: number;
  /** Base delay in ms before the first retry. Default: 500. */
  baseDelayMs?: number;
  /** Upper cap on the delay. Default: 30 000. */
  maxDelayMs?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 5, baseDelayMs = 500, maxDelayMs = 30_000 } = opts;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === maxAttempts;
      if (!isRetryableError(err) || isLast) throw err;

      // Exponential backoff + small jitter
      const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const jitter  = Math.random() * 200;
      await sleep(backoff + jitter);
    }
  }
  /* istanbul ignore next */
  throw new Error('withRetry: unreachable');
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
