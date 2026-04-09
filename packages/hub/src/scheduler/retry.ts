import { computeBackoffSeconds } from './score.js';

/**
 * CAP-012 / story 014-005: retry policy re-queue + exponential backoff.
 *
 * Pure module. Given a failed session and its originating queue
 * task's retry_policy, decides whether to re-queue and at what time.
 *
 * The actual INSERT into queue happens in the caller — keeping this
 * pure means it's trivially unit-testable against a fixture matrix
 * of (exitCode, retryCount, policy).
 */

export interface RetryPolicy {
  /** Absolute max number of retries. 0 disables retry entirely. */
  maxRetries: number;
  /** Base backoff seconds; doubled each retry (capped at 1 hour). */
  backoffSeconds: number;
  /** If set, only retry when the exit code is in this list. */
  retryOnExitCodes?: number[];
}

export interface RetryDecisionInput {
  exitCode: number;
  retryCount: number;
  policy: RetryPolicy;
  /** Current time in unix seconds — injectable for tests. */
  now: number;
}

export type RetryDecision =
  | { retry: true; nextRetryCount: number; availableAt: number; backoffSeconds: number }
  | { retry: false; reason: 'success' | 'policy_disabled' | 'max_retries' | 'exit_code_not_retryable' };

export function evaluateRetry(input: RetryDecisionInput): RetryDecision {
  // Exit code 0 is success — never retry.
  if (input.exitCode === 0) return { retry: false, reason: 'success' };

  // Policy explicitly disabled.
  if (input.policy.maxRetries <= 0) return { retry: false, reason: 'policy_disabled' };

  // Already retried the max number of times.
  if (input.retryCount >= input.policy.maxRetries) {
    return { retry: false, reason: 'max_retries' };
  }

  // Exit code filter.
  if (
    input.policy.retryOnExitCodes !== undefined &&
    input.policy.retryOnExitCodes.length > 0 &&
    !input.policy.retryOnExitCodes.includes(input.exitCode)
  ) {
    return { retry: false, reason: 'exit_code_not_retryable' };
  }

  const backoffSeconds = computeBackoffSeconds(input.retryCount, input.policy.backoffSeconds);
  const nextRetryCount = input.retryCount + 1;
  const availableAt = input.now + backoffSeconds;

  return { retry: true, nextRetryCount, availableAt, backoffSeconds };
}

/**
 * Parses a retry_policy JSON blob from a queue row. Returns null if
 * the value is missing or malformed.
 */
export function parseRetryPolicy(raw: string | null | undefined): RetryPolicy | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<RetryPolicy>;
    if (typeof obj.maxRetries !== 'number' || typeof obj.backoffSeconds !== 'number') {
      return null;
    }
    return {
      maxRetries: obj.maxRetries,
      backoffSeconds: obj.backoffSeconds,
      retryOnExitCodes: Array.isArray(obj.retryOnExitCodes) ? obj.retryOnExitCodes : undefined,
    };
  } catch {
    return null;
  }
}
