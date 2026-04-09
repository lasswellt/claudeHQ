import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../db.js';
import {
  planBatch,
  batchStatus,
  cancelBatch,
  isBatchError,
} from '../workforce/batch-planner.js';

// E005 / story 016-009: end-to-end batch test.
//
// Simulates the full batch lifecycle without Fastify:
//   1. Seed 3 repos
//   2. planBatch → 3 child jobs with shared batch_id
//   3. Agent transitions: pending → running → completed
//   4. batchStatus rollup reflects the progress
//   5. Cancel-all on a partial batch affects only non-terminal jobs

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(':memory:');
  db.prepare(
    `INSERT INTO machines (id, last_seen, status, max_sessions) VALUES ('m1', ?, 'online', 4)`,
  ).run(Math.floor(Date.now() / 1000));
  db.prepare(
    `INSERT INTO repos (id, url, name, default_branch, auth_method, tags)
     VALUES ('frontend', 'git@example:frontend.git', 'frontend', 'main', 'ssh_key', ?)`,
  ).run(JSON.stringify(['ui', 'ts']));
  db.prepare(
    `INSERT INTO repos (id, url, name, default_branch, auth_method, tags)
     VALUES ('backend', 'git@example:backend.git', 'backend', 'main', 'ssh_key', ?)`,
  ).run(JSON.stringify(['api', 'go']));
  db.prepare(
    `INSERT INTO repos (id, url, name, default_branch, auth_method, tags)
     VALUES ('shared', 'git@example:shared.git', 'shared', 'main', 'ssh_key', ?)`,
  ).run(JSON.stringify(['lib', 'ts']));
});

afterEach(() => {
  db.close();
});

describe('batch end-to-end', () => {
  it('plans a 3-repo batch and rolls up status as jobs progress', () => {
    // 1. Plan
    const result = planBatch(db, {
      repoIds: ['frontend', 'backend', 'shared'],
      prompt: 'Bump the version',
      branchPrefix: 'release',
      maxConcurrency: 2,
      autoPr: true,
    });
    if (isBatchError(result)) throw new Error(result.error);

    expect(result.jobs).toHaveLength(3);
    expect(result.maxConcurrency).toBe(2);
    const repoIds = result.jobs.map((j) => j.repoId).sort();
    expect(repoIds).toEqual(['backend', 'frontend', 'shared']);

    // Every child job has the release/<batch-prefix> branch.
    for (const job of result.jobs) {
      expect(job.branch).toMatch(/^release\/[a-f0-9]{8}$/);
    }

    // 2. Initial status: all 3 pending.
    let status = batchStatus(db, result.batchId);
    expect(status).toMatchObject({
      total: 3,
      pending: 3,
      running: 0,
      completed: 0,
      failed: 0,
    });

    // 3. Agent starts two of them.
    db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(result.jobs[0]!.jobId);
    db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(result.jobs[1]!.jobId);

    status = batchStatus(db, result.batchId);
    expect(status).toMatchObject({ pending: 1, running: 2 });

    // 4. First one finishes successfully, second fails, third is picked up.
    db.prepare("UPDATE jobs SET status = 'completed', cost_usd = 0.15 WHERE id = ?").run(
      result.jobs[0]!.jobId,
    );
    db.prepare("UPDATE jobs SET status = 'failed', error_message = 'lint failed' WHERE id = ?").run(
      result.jobs[1]!.jobId,
    );
    db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(result.jobs[2]!.jobId);

    status = batchStatus(db, result.batchId);
    expect(status).toMatchObject({
      pending: 0,
      running: 1,
      completed: 1,
      failed: 1,
    });

    // 5. Third finishes — batch done.
    db.prepare("UPDATE jobs SET status = 'completed' WHERE id = ?").run(result.jobs[2]!.jobId);
    status = batchStatus(db, result.batchId);
    expect(status.completed).toBe(2);
    expect(status.failed).toBe(1);
    expect(status.running).toBe(0);
  });

  it('cancel-all only affects non-terminal jobs', () => {
    const result = planBatch(db, {
      repoIds: ['frontend', 'backend', 'shared'],
      prompt: 'x',
    });
    if (isBatchError(result)) throw new Error(result.error);

    // Complete one, leave two pending.
    db.prepare("UPDATE jobs SET status = 'completed' WHERE id = ?").run(result.jobs[0]!.jobId);
    // Start another.
    db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(result.jobs[1]!.jobId);

    const { cancelled } = cancelBatch(db, result.batchId);
    expect(cancelled).toBe(2); // running + pending

    const final = batchStatus(db, result.batchId);
    expect(final.completed).toBe(1);
    expect(final.cancelled).toBe(2);
    expect(final.pending).toBe(0);
    expect(final.running).toBe(0);
  });

  it('tag-filtered batch respects ANY match semantics', () => {
    const result = planBatch(db, {
      tags: ['ts'],
      prompt: 'Upgrade TypeScript',
    });
    if (isBatchError(result)) throw new Error(result.error);

    // ts tag is on frontend + shared.
    const repoIds = result.jobs.map((j) => j.repoId).sort();
    expect(repoIds).toEqual(['frontend', 'shared']);
  });

  it('returns 404-like no_repos_matched when the selector is empty', () => {
    const result = planBatch(db, {
      tags: ['nonexistent'],
      prompt: 'x',
    });
    expect(isBatchError(result)).toBe(true);
    if (isBatchError(result)) {
      expect(result.error).toBe('no_repos_matched');
    }
  });
});
