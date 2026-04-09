import type Database from 'better-sqlite3';

/**
 * CAP-058 / story 017-003: PAT fallback polling mode.
 *
 * When the operator configured the hub with a Personal Access
 * Token instead of a GitHub App, webhooks aren't available and
 * we need to poll for PR status + check run state ourselves.
 *
 * This module is the pure polling planner:
 *   - `selectReposToPoll()` — returns repos whose `last_synced_at`
 *     is older than the poll interval, capped at `batchSize` so a
 *     fleet of 500 repos doesn't hammer the API every tick.
 *   - `markSynced()` — updates `last_synced_at` after a successful
 *     poll tick.
 *   - `computeBackoffSeconds()` — exponential backoff for
 *     consecutive failures, ceiling 1h. Mirrors the scheduler
 *     retry helper so operators don't need a second mental model.
 *
 * The actual HTTP calls to GitHub live in the caller (routes/
 * cron) so this module stays pure and DB-only. 20-line fetchers
 * are easy to write at the callsite; the tricky coordination
 * (which repos, how often, failure backoff) is what gets tested.
 */

export interface PatPollOptions {
  /** Poll interval in seconds. Default 300 (5 min). */
  pollIntervalSeconds?: number;
  /** Max repos returned per tick. Default 20. */
  batchSize?: number;
  /** Injectable clock. Default Date.now()/1000. */
  now?: () => number;
}

export interface RepoToPoll {
  id: string;
  name: string;
  owner: string | null;
  default_branch: string;
  last_synced_at: number | null;
  poll_failures: number;
}

const DEFAULT_POLL_INTERVAL = 300;
const DEFAULT_BATCH_SIZE = 20;

/**
 * Picks the next batch of repos the poller should hit. Repos
 * that have never been synced come first (null `last_synced_at`);
 * repos with failures are delayed by exponential backoff.
 *
 * Returns rows sorted ascending by effective "due-at" so the most
 * overdue are handled first.
 */
export function selectReposToPoll(
  db: Database.Database,
  opts: PatPollOptions = {},
): RepoToPoll[] {
  const interval = opts.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL;
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const now = (opts.now ?? (() => Math.floor(Date.now() / 1000)))();

  // Simple strategy: pick repos where last_synced_at IS NULL OR
  // (now - last_synced_at) >= interval * 2^failures, sorted by
  // the oldest (or never-synced) first.
  const rows = db
    .prepare(
      `SELECT id, name, owner, default_branch, last_synced_at, poll_failures
       FROM repos
       WHERE last_synced_at IS NULL
          OR (? - last_synced_at) >= (? * (1 << MIN(COALESCE(poll_failures, 0), 10)))
       ORDER BY COALESCE(last_synced_at, 0) ASC
       LIMIT ?`,
    )
    .all(now, interval, batchSize) as RepoToPoll[];

  return rows;
}

/**
 * Records a successful poll tick — updates `last_synced_at` and
 * resets `poll_failures` to 0.
 */
export function markSynced(db: Database.Database, repoId: string, atUnix?: number): void {
  const ts = atUnix ?? Math.floor(Date.now() / 1000);
  db
    .prepare(
      'UPDATE repos SET last_synced_at = ?, poll_failures = 0 WHERE id = ?',
    )
    .run(ts, repoId);
}

/**
 * Records a failed poll tick — increments `poll_failures` so the
 * exponential backoff picks a longer delay next time.
 */
export function markFailed(db: Database.Database, repoId: string): void {
  db
    .prepare(
      'UPDATE repos SET poll_failures = COALESCE(poll_failures, 0) + 1 WHERE id = ?',
    )
    .run(repoId);
}

/**
 * Pure function — expected delay (in seconds) until this repo's
 * next poll, given its current failure count.
 *
 *   delay = interval * 2^min(failures, 10)
 *
 * Capped at 1 hour so a permanently-broken repo doesn't block
 * the poller forever.
 */
export function computeBackoffSeconds(
  failures: number,
  pollIntervalSeconds = DEFAULT_POLL_INTERVAL,
): number {
  const exponent = Math.min(Math.max(0, Math.floor(failures)), 10);
  const raw = pollIntervalSeconds * 2 ** exponent;
  return Math.min(raw, 3600);
}
