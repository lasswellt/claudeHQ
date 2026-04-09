import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

/**
 * CAP-055 / story 016-004: batch job planner + cascade cancel.
 *
 * Pure-ish module. `planBatch` resolves the set of repos the
 * batch targets, creates one job row per repo (sharing a batch_id
 * FK), and returns the list so the caller can fan out provisioning.
 *
 * The concurrency cap is enforced at provisioning time by the
 * caller (it reads pending-batch jobs from the DB and only starts
 * up to maxConcurrency at a time). The planner's job is pure
 * expansion: repos in → child jobs out.
 */

export interface BatchPlanInput {
  /** Explicit repo list. Mutually exclusive with `tags`. */
  repoIds?: string[];
  /** Select repos by tag match (ANY). */
  tags?: string[];
  prompt: string;
  branchPrefix?: string;
  maxConcurrency?: number;
  autoPr?: boolean;
  maxCostUsd?: number;
  timeoutSeconds?: number;
}

export interface BatchPlanResult {
  batchId: string;
  jobs: Array<{
    jobId: string;
    repoId: string;
    repoName: string;
    branch: string | undefined;
  }>;
  /** Effective concurrency clamp (1..10). */
  maxConcurrency: number;
}

export interface BatchPlanError {
  error: 'no_repos_matched' | 'missing_selector' | 'invalid_concurrency';
  detail?: string;
}

export type BatchPlanOutcome = BatchPlanResult | BatchPlanError;

export function isBatchError(x: BatchPlanOutcome): x is BatchPlanError {
  return (x as BatchPlanError).error !== undefined;
}

const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 10;
const DEFAULT_CONCURRENCY = 3;

export function planBatch(db: Database.Database, input: BatchPlanInput): BatchPlanOutcome {
  // Validate selector — must have at least one of repoIds or tags.
  if (
    (!input.repoIds || input.repoIds.length === 0) &&
    (!input.tags || input.tags.length === 0)
  ) {
    return { error: 'missing_selector', detail: 'provide repoIds[] or tags[]' };
  }

  // Validate concurrency.
  const requested = input.maxConcurrency ?? DEFAULT_CONCURRENCY;
  if (!Number.isFinite(requested) || requested < MIN_CONCURRENCY || requested > MAX_CONCURRENCY) {
    return {
      error: 'invalid_concurrency',
      detail: `concurrency must be an integer in [${MIN_CONCURRENCY}, ${MAX_CONCURRENCY}]`,
    };
  }
  const maxConcurrency = Math.floor(requested);

  // Resolve repos. If repoIds provided, use those directly.
  // Otherwise match repos whose `tags` JSON array intersects the
  // requested tags (ANY-match via LIKE substring — the tag array
  // is small so cost is negligible; see CAP-010 in hub/dal for the
  // same technique).
  let repos: Array<{ id: string; name: string; default_branch: string }>;
  if (input.repoIds && input.repoIds.length > 0) {
    const placeholders = input.repoIds.map(() => '?').join(',');
    repos = db
      .prepare(
        `SELECT id, name, default_branch FROM repos WHERE id IN (${placeholders})`,
      )
      .all(...input.repoIds) as Array<{ id: string; name: string; default_branch: string }>;
  } else {
    const allRepos = db
      .prepare('SELECT id, name, default_branch, tags FROM repos')
      .all() as Array<{ id: string; name: string; default_branch: string; tags: string | null }>;
    const wantTags = new Set(input.tags ?? []);
    repos = allRepos
      .filter((r) => {
        if (!r.tags) return false;
        try {
          const arr = JSON.parse(r.tags) as string[];
          return arr.some((t) => wantTags.has(t));
        } catch {
          return false;
        }
      })
      .map(({ id, name, default_branch }) => ({ id, name, default_branch }));
  }

  if (repos.length === 0) {
    return { error: 'no_repos_matched' };
  }

  // Create the batch + child jobs in one transaction so a partial
  // failure doesn't leave orphan rows.
  const batchId = randomUUID();
  const insertJobStmt = db.prepare(
    `INSERT INTO jobs (id, repo_id, title, prompt, branch, status, auto_pr, auto_cleanup, batch_id, max_cost_usd, timeout_seconds)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?, ?)`,
  );

  const jobs: BatchPlanResult['jobs'] = [];

  const tx = db.transaction(() => {
    for (const repo of repos) {
      const jobId = randomUUID();
      const branch = input.branchPrefix
        ? `${input.branchPrefix}/${batchId.slice(0, 8)}`
        : undefined;
      const title = `Batch ${batchId.slice(0, 8)} → ${repo.name}`;
      insertJobStmt.run(
        jobId,
        repo.id,
        title,
        input.prompt,
        branch ?? null,
        input.autoPr ? 1 : 0,
        batchId,
        input.maxCostUsd ?? null,
        input.timeoutSeconds ?? null,
      );
      jobs.push({ jobId, repoId: repo.id, repoName: repo.name, branch });
    }
  });
  tx();

  return { batchId, jobs, maxConcurrency };
}

/**
 * Cascade-cancel every job in a batch that isn't already in a
 * terminal state. Returns the number of jobs that transitioned.
 */
export function cancelBatch(db: Database.Database, batchId: string): { cancelled: number } {
  const result = db
    .prepare(
      `UPDATE jobs
       SET status = 'cancelled', ended_at = ?
       WHERE batch_id = ?
         AND status NOT IN ('completed', 'failed', 'cancelled')`,
    )
    .run(Math.floor(Date.now() / 1000), batchId);
  return { cancelled: result.changes };
}

/**
 * Returns a batch status rollup for the detail page.
 */
export interface BatchStatusRow {
  batchId: string;
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export function batchStatus(db: Database.Database, batchId: string): BatchStatusRow {
  const rows = db
    .prepare('SELECT status, COUNT(*) AS c FROM jobs WHERE batch_id = ? GROUP BY status')
    .all(batchId) as Array<{ status: string; c: number }>;

  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = r.c;
  const total = rows.reduce((s, r) => s + r.c, 0);

  return {
    batchId,
    total,
    pending: byStatus.pending ?? 0,
    running: byStatus.running ?? 0,
    completed: byStatus.completed ?? 0,
    failed: byStatus.failed ?? 0,
    cancelled: byStatus.cancelled ?? 0,
  };
}
