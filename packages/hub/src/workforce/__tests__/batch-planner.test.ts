import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../db.js';
import {
  planBatch,
  cancelBatch,
  batchStatus,
  isBatchError,
} from '../batch-planner.js';

// E005 / story 016-004: batch job planner.

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(':memory:');
});

afterEach(() => {
  db.close();
});

function addRepo(id: string, name: string, tags?: string[]): void {
  db.prepare(
    `INSERT INTO repos (id, url, name, default_branch, auth_method, tags)
     VALUES (?, ?, ?, 'main', 'ssh_key', ?)`,
  ).run(id, `git@example:${id}.git`, name, tags ? JSON.stringify(tags) : null);
}

describe('planBatch — validation', () => {
  it('rejects when neither repoIds nor tags are provided', () => {
    const result = planBatch(db, { prompt: 'Do it' });
    expect(isBatchError(result)).toBe(true);
    if (isBatchError(result)) {
      expect(result.error).toBe('missing_selector');
    }
  });

  it('rejects out-of-range concurrency', () => {
    addRepo('r1', 'one');
    const result = planBatch(db, {
      repoIds: ['r1'],
      prompt: 'Do it',
      maxConcurrency: 0,
    });
    expect(isBatchError(result)).toBe(true);
    if (isBatchError(result)) {
      expect(result.error).toBe('invalid_concurrency');
    }
  });

  it('rejects concurrency above 10', () => {
    addRepo('r1', 'one');
    const result = planBatch(db, {
      repoIds: ['r1'],
      prompt: 'Do it',
      maxConcurrency: 11,
    });
    expect(isBatchError(result)).toBe(true);
  });

  it('returns no_repos_matched when selector matches nothing', () => {
    const result = planBatch(db, { repoIds: ['missing'], prompt: 'Do it' });
    expect(isBatchError(result)).toBe(true);
    if (isBatchError(result)) {
      expect(result.error).toBe('no_repos_matched');
    }
  });
});

describe('planBatch — repo selection', () => {
  it('creates one job per explicit repoId', () => {
    addRepo('r1', 'one');
    addRepo('r2', 'two');
    addRepo('r3', 'three');

    const result = planBatch(db, {
      repoIds: ['r1', 'r3'],
      prompt: 'Refactor',
    });
    expect(isBatchError(result)).toBe(false);
    if (!isBatchError(result)) {
      expect(result.jobs).toHaveLength(2);
      const repoIds = result.jobs.map((j) => j.repoId).sort();
      expect(repoIds).toEqual(['r1', 'r3']);
      expect(result.maxConcurrency).toBe(3); // default
    }
  });

  it('matches repos by tags (ANY semantics)', () => {
    addRepo('frontend-a', 'frontend-a', ['ui', 'ts']);
    addRepo('frontend-b', 'frontend-b', ['ui', 'vue']);
    addRepo('backend-a', 'backend-a', ['api', 'go']);

    const result = planBatch(db, { tags: ['ui'], prompt: 'Add dark mode' });
    if (isBatchError(result)) throw new Error(result.error);
    expect(result.jobs.map((j) => j.repoId).sort()).toEqual(['frontend-a', 'frontend-b']);
  });

  it('matches on the first tag that overlaps', () => {
    addRepo('r1', 'r1', ['alpha']);
    addRepo('r2', 'r2', ['beta']);
    addRepo('r3', 'r3', ['alpha', 'beta']);

    const result = planBatch(db, { tags: ['gamma', 'alpha'], prompt: 'x' });
    if (isBatchError(result)) throw new Error(result.error);
    expect(result.jobs.map((j) => j.repoId).sort()).toEqual(['r1', 'r3']);
  });

  it('ignores repos with malformed tags JSON', () => {
    addRepo('good', 'good', ['alpha']);
    db.prepare(
      `INSERT INTO repos (id, url, name, default_branch, auth_method, tags)
       VALUES ('bad', 'g', 'bad', 'main', 'ssh_key', 'not-json')`,
    ).run();

    const result = planBatch(db, { tags: ['alpha'], prompt: 'x' });
    if (isBatchError(result)) throw new Error(result.error);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.repoId).toBe('good');
  });
});

describe('planBatch — job creation', () => {
  it('writes pending jobs with the shared batch_id', () => {
    addRepo('r1', 'one');
    addRepo('r2', 'two');

    const result = planBatch(db, {
      repoIds: ['r1', 'r2'],
      prompt: 'Hello',
      autoPr: true,
      maxCostUsd: 5,
      timeoutSeconds: 3600,
    });
    if (isBatchError(result)) throw new Error(result.error);

    const jobRows = db
      .prepare('SELECT * FROM jobs WHERE batch_id = ?')
      .all(result.batchId) as Array<Record<string, unknown>>;
    expect(jobRows).toHaveLength(2);
    for (const row of jobRows) {
      expect(row.status).toBe('pending');
      expect(row.auto_pr).toBe(1);
      expect(row.max_cost_usd).toBe(5);
      expect(row.timeout_seconds).toBe(3600);
    }
  });

  it('applies branchPrefix when provided', () => {
    addRepo('r1', 'one');
    const result = planBatch(db, {
      repoIds: ['r1'],
      prompt: 'x',
      branchPrefix: 'batch',
    });
    if (isBatchError(result)) throw new Error(result.error);
    expect(result.jobs[0]?.branch).toMatch(/^batch\/[a-f0-9]{8}$/);
  });
});

describe('cancelBatch', () => {
  it('transitions non-terminal jobs to cancelled', () => {
    addRepo('r1', 'one');
    addRepo('r2', 'two');
    const plan = planBatch(db, { repoIds: ['r1', 'r2'], prompt: 'x' });
    if (isBatchError(plan)) throw new Error(plan.error);

    const result = cancelBatch(db, plan.batchId);
    expect(result.cancelled).toBe(2);

    const statuses = db
      .prepare('SELECT status FROM jobs WHERE batch_id = ?')
      .all(plan.batchId) as Array<{ status: string }>;
    for (const row of statuses) expect(row.status).toBe('cancelled');
  });

  it('does not touch jobs already in a terminal state', () => {
    addRepo('r1', 'one');
    addRepo('r2', 'two');
    const plan = planBatch(db, { repoIds: ['r1', 'r2'], prompt: 'x' });
    if (isBatchError(plan)) throw new Error(plan.error);

    // Mark one as completed.
    db.prepare("UPDATE jobs SET status = 'completed' WHERE id = ?").run(plan.jobs[0]!.jobId);

    const result = cancelBatch(db, plan.batchId);
    expect(result.cancelled).toBe(1);

    const row = db
      .prepare('SELECT status FROM jobs WHERE id = ?')
      .get(plan.jobs[0]!.jobId) as { status: string };
    expect(row.status).toBe('completed');
  });
});

describe('batchStatus', () => {
  it('rolls up status counts for a batch', () => {
    addRepo('r1', 'one');
    addRepo('r2', 'two');
    addRepo('r3', 'three');
    addRepo('r4', 'four');
    const plan = planBatch(db, { repoIds: ['r1', 'r2', 'r3', 'r4'], prompt: 'x' });
    if (isBatchError(plan)) throw new Error(plan.error);

    db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(plan.jobs[0]!.jobId);
    db.prepare("UPDATE jobs SET status = 'completed' WHERE id = ?").run(plan.jobs[1]!.jobId);
    db.prepare("UPDATE jobs SET status = 'failed' WHERE id = ?").run(plan.jobs[2]!.jobId);

    const status = batchStatus(db, plan.batchId);
    expect(status).toMatchObject({
      total: 4,
      pending: 1,
      running: 1,
      completed: 1,
      failed: 1,
      cancelled: 0,
    });
  });
});
