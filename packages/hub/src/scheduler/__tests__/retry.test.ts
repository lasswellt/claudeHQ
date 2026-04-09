import { describe, it, expect } from 'vitest';
import { evaluateRetry, parseRetryPolicy, type RetryPolicy } from '../retry.js';

// E003 / story 014-005: retry policy pure module.

const basePolicy: RetryPolicy = {
  maxRetries: 3,
  backoffSeconds: 30,
};

describe('evaluateRetry', () => {
  it('never retries on success', () => {
    expect(
      evaluateRetry({ exitCode: 0, retryCount: 0, policy: basePolicy, now: 1000 }),
    ).toEqual({ retry: false, reason: 'success' });
  });

  it('skips retry when policy is disabled', () => {
    expect(
      evaluateRetry({
        exitCode: 1,
        retryCount: 0,
        policy: { maxRetries: 0, backoffSeconds: 30 },
        now: 1000,
      }),
    ).toEqual({ retry: false, reason: 'policy_disabled' });
  });

  it('stops after maxRetries', () => {
    expect(
      evaluateRetry({ exitCode: 1, retryCount: 3, policy: basePolicy, now: 1000 }),
    ).toEqual({ retry: false, reason: 'max_retries' });
  });

  it('honors retryOnExitCodes allow-list', () => {
    const policy: RetryPolicy = { ...basePolicy, retryOnExitCodes: [2, 137] };

    // 137 is in the list → retry
    const retry137 = evaluateRetry({ exitCode: 137, retryCount: 0, policy, now: 1000 });
    expect(retry137.retry).toBe(true);

    // 1 is not in the list → no retry
    const reject1 = evaluateRetry({ exitCode: 1, retryCount: 0, policy, now: 1000 });
    expect(reject1).toEqual({ retry: false, reason: 'exit_code_not_retryable' });
  });

  it('computes exponential backoff', () => {
    // retryCount 0 → backoff 30 * 2^0 = 30
    const first = evaluateRetry({ exitCode: 1, retryCount: 0, policy: basePolicy, now: 1000 });
    expect(first).toEqual({
      retry: true,
      nextRetryCount: 1,
      backoffSeconds: 30,
      availableAt: 1030,
    });

    // retryCount 1 → backoff 30 * 2^1 = 60
    const second = evaluateRetry({ exitCode: 1, retryCount: 1, policy: basePolicy, now: 1000 });
    expect(second.retry).toBe(true);
    if (second.retry) {
      expect(second.backoffSeconds).toBe(60);
      expect(second.availableAt).toBe(1060);
      expect(second.nextRetryCount).toBe(2);
    }

    // retryCount 2 → backoff 30 * 2^2 = 120
    const third = evaluateRetry({ exitCode: 1, retryCount: 2, policy: basePolicy, now: 1000 });
    expect(third.retry).toBe(true);
    if (third.retry) {
      expect(third.backoffSeconds).toBe(120);
      expect(third.nextRetryCount).toBe(3);
    }
  });

  it('empty retryOnExitCodes array means "retry any code"', () => {
    // Explicit empty array is treated as "no filter" per parseRetryPolicy.
    const policy: RetryPolicy = { ...basePolicy, retryOnExitCodes: [] };
    const decision = evaluateRetry({ exitCode: 1, retryCount: 0, policy, now: 1000 });
    expect(decision.retry).toBe(true);
  });
});

describe('parseRetryPolicy', () => {
  it('returns null for null/undefined/empty', () => {
    expect(parseRetryPolicy(null)).toBeNull();
    expect(parseRetryPolicy(undefined)).toBeNull();
    expect(parseRetryPolicy('')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseRetryPolicy('not json')).toBeNull();
  });

  it('returns null for missing required fields', () => {
    expect(parseRetryPolicy('{"foo": "bar"}')).toBeNull();
    expect(parseRetryPolicy('{"maxRetries": 3}')).toBeNull(); // missing backoff
  });

  it('parses a valid policy', () => {
    const p = parseRetryPolicy(
      JSON.stringify({ maxRetries: 3, backoffSeconds: 30, retryOnExitCodes: [1, 137] }),
    );
    expect(p).toEqual({ maxRetries: 3, backoffSeconds: 30, retryOnExitCodes: [1, 137] });
  });

  it('drops retryOnExitCodes when not an array', () => {
    const p = parseRetryPolicy(
      JSON.stringify({ maxRetries: 3, backoffSeconds: 30, retryOnExitCodes: 'bad' }),
    );
    expect(p).toEqual({ maxRetries: 3, backoffSeconds: 30, retryOnExitCodes: undefined });
  });
});
