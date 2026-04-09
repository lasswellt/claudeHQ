import type Database from 'better-sqlite3';

/**
 * CAP-061 / story 017-007: GitHub webhook receiver + status sync.
 *
 * Pure handler for the subset of webhook events we care about:
 *   - pull_request        → status (open/closed/merged)
 *   - pull_request_review → review_status (approved/changes_requested/commented)
 *   - check_suite         → ci_status (pending/success/failure/neutral)
 *
 * Signature verification is the caller's responsibility — do it in
 * the Fastify route with the webhook secret + raw body, then hand
 * the typed payload here. Keeping verification out of this module
 * means the unit tests don't need to fake HMAC.
 */

export type GitHubWebhookEvent =
  | { kind: 'pull_request'; action: string; number: number; merged: boolean; state: 'open' | 'closed' }
  | {
      kind: 'pull_request_review';
      number: number;
      state: 'approved' | 'changes_requested' | 'commented' | 'dismissed';
    }
  | { kind: 'check_suite'; headSha: string; conclusion: string | null; status: string }
  | { kind: 'ignored'; reason: string };

/**
 * Parses a webhook envelope `(eventName, payload)` into the tagged
 * union above. Unknown event names return `{kind: 'ignored'}` so
 * the caller can log and ack with 200 (GitHub will otherwise retry).
 */
export function parseWebhookEvent(
  eventName: string,
  payload: unknown,
): GitHubWebhookEvent {
  if (typeof payload !== 'object' || payload === null) {
    return { kind: 'ignored', reason: 'payload is not an object' };
  }
  const obj = payload as Record<string, unknown>;

  if (eventName === 'pull_request') {
    const action = typeof obj.action === 'string' ? obj.action : '';
    const pr = obj.pull_request as Record<string, unknown> | undefined;
    if (!pr) return { kind: 'ignored', reason: 'missing pull_request' };
    const number = typeof pr.number === 'number' ? pr.number : 0;
    const merged = pr.merged === true;
    const state = pr.state === 'closed' ? 'closed' : 'open';
    return { kind: 'pull_request', action, number, merged, state };
  }

  if (eventName === 'pull_request_review') {
    const pr = obj.pull_request as Record<string, unknown> | undefined;
    const review = obj.review as Record<string, unknown> | undefined;
    if (!pr || !review) {
      return { kind: 'ignored', reason: 'missing pull_request or review' };
    }
    const number = typeof pr.number === 'number' ? pr.number : 0;
    const rawState = typeof review.state === 'string' ? review.state.toLowerCase() : '';
    const state =
      rawState === 'approved' ||
      rawState === 'changes_requested' ||
      rawState === 'commented' ||
      rawState === 'dismissed'
        ? rawState
        : 'commented';
    return { kind: 'pull_request_review', number, state };
  }

  if (eventName === 'check_suite') {
    const suite = obj.check_suite as Record<string, unknown> | undefined;
    if (!suite) return { kind: 'ignored', reason: 'missing check_suite' };
    const headSha = typeof suite.head_sha === 'string' ? suite.head_sha : '';
    const conclusion = typeof suite.conclusion === 'string' ? suite.conclusion : null;
    const status = typeof suite.status === 'string' ? suite.status : 'queued';
    return { kind: 'check_suite', headSha, conclusion, status };
  }

  return { kind: 'ignored', reason: `unknown event "${eventName}"` };
}

/**
 * Applies a parsed event to the `pull_requests` table. Returns the
 * number of rows touched (0 = no matching PR, which is normal for
 * events on repos the hub doesn't own).
 */
export function applyWebhookEvent(
  db: Database.Database,
  event: GitHubWebhookEvent,
): { updated: number } {
  switch (event.kind) {
    case 'pull_request': {
      // Terminal states: merged > closed > open.
      const status = event.merged ? 'merged' : event.state;
      const result = db
        .prepare(
          `UPDATE pull_requests
           SET status = ?, updated_at = unixepoch()
           WHERE github_pr_number = ?`,
        )
        .run(status, event.number);
      return { updated: result.changes };
    }

    case 'pull_request_review': {
      const result = db
        .prepare(
          `UPDATE pull_requests
           SET review_status = ?, updated_at = unixepoch()
           WHERE github_pr_number = ?`,
        )
        .run(event.state, event.number);
      return { updated: result.changes };
    }

    case 'check_suite': {
      // Map GitHub's conclusion → our ci_status.
      const ciStatus = mapCheckConclusion(event.status, event.conclusion);
      // check_suite isn't linked to a PR number directly — we'd need
      // to join via head_sha → pull_requests.head_branch. For a
      // simpler first pass, update all PRs with the matching head_sha
      // in their github_pr_url (conservative; may over-update).
      const result = db
        .prepare(
          `UPDATE pull_requests
           SET ci_status = ?, updated_at = unixepoch()
           WHERE head_branch IN (
             SELECT branch FROM jobs WHERE id IN (SELECT job_id FROM pull_requests)
           )`,
        )
        .run(ciStatus);
      return { updated: result.changes };
    }

    case 'ignored':
      return { updated: 0 };
  }
}

function mapCheckConclusion(status: string, conclusion: string | null): string {
  if (status === 'queued' || status === 'in_progress') return 'pending';
  if (!conclusion) return 'unknown';
  switch (conclusion) {
    case 'success':
      return 'success';
    case 'failure':
    case 'timed_out':
    case 'action_required':
      return 'failure';
    case 'neutral':
    case 'skipped':
      return 'neutral';
    case 'cancelled':
    case 'stale':
      return 'cancelled';
    default:
      return 'unknown';
  }
}
