import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../db.js';
import {
  selectReposToPoll,
  markSynced,
  markFailed,
  computeBackoffSeconds,
} from '../pat-poller.js';

// CAP-058 / story 017-003: PAT polling planner.

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(':memory:');
});

afterEach(() => {
  db.close();
});

function addRepo(opts: {
  id: string;
  lastSyncedAt?: number | null;
  pollFailures?: number;
}): void {
  db.prepare(
    `INSERT INTO repos (id, url, name, default_branch, auth_method, last_synced_at, poll_failures)
     VALUES (?, ?, ?, 'main', 'token', ?, ?)`,
  ).run(opts.id, `git@example:${opts.id}.git`, opts.id, opts.lastSyncedAt ?? null, opts.pollFailures ?? 0);
}

describe('selectReposToPoll', () => {
  it('returns repos that have never been synced first', () => {
    const now = 10_000;
    addRepo({ id: 'never', lastSyncedAt: null });
    addRepo({ id: 'recent', lastSyncedAt: now - 60 }); // under interval
    addRepo({ id: 'old', lastSyncedAt: now - 1000 });

    const rows = selectReposToPoll(db, {
      pollIntervalSeconds: 300,
      now: () => now,
    });
    expect(rows.map((r) => r.id)).toEqual(['never', 'old']);
  });

  it('excludes repos polled within the interval', () => {
    const now = 10_000;
    addRepo({ id: 'fresh', lastSyncedAt: now - 30 });
    const rows = selectReposToPoll(db, {
      pollIntervalSeconds: 300,
      now: () => now,
    });
    expect(rows).toEqual([]);
  });

  it('applies exponential backoff for failed repos', () => {
    const now = 10_000;
    // poll_failures = 3 → effective interval = 300 * 2^3 = 2400s
    // Last synced 1000s ago, so NOT yet due.
    addRepo({ id: 'flaky', lastSyncedAt: now - 1000, pollFailures: 3 });
    // poll_failures = 1 → effective interval = 300 * 2 = 600s
    // Last synced 1000s ago, so IS due.
    addRepo({ id: 'recovered', lastSyncedAt: now - 1000, pollFailures: 1 });

    const rows = selectReposToPoll(db, {
      pollIntervalSeconds: 300,
      now: () => now,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('recovered');
    expect(ids).not.toContain('flaky');
  });

  it('caps the batch size', () => {
    const now = 10_000;
    for (let i = 0; i < 50; i++) {
      addRepo({ id: `r${i}`, lastSyncedAt: null });
    }
    const rows = selectReposToPoll(db, {
      pollIntervalSeconds: 300,
      batchSize: 10,
      now: () => now,
    });
    expect(rows).toHaveLength(10);
  });

  it('orders by oldest last_synced_at first (FIFO for never-synced)', () => {
    const now = 10_000;
    addRepo({ id: 'older', lastSyncedAt: 100 });
    addRepo({ id: 'newer', lastSyncedAt: 500 });
    addRepo({ id: 'never', lastSyncedAt: null });

    const rows = selectReposToPoll(db, {
      pollIntervalSeconds: 60,
      now: () => now,
    });
    // Never-synced (COALESCE null=0) sorts before 100 which sorts before 500.
    expect(rows.map((r) => r.id)).toEqual(['never', 'older', 'newer']);
  });
});

describe('markSynced', () => {
  it('updates last_synced_at and clears failures', () => {
    addRepo({ id: 'r1', lastSyncedAt: 0, pollFailures: 5 });
    markSynced(db, 'r1', 12345);
    const row = db
      .prepare('SELECT last_synced_at, poll_failures FROM repos WHERE id = ?')
      .get('r1') as { last_synced_at: number; poll_failures: number };
    expect(row.last_synced_at).toBe(12345);
    expect(row.poll_failures).toBe(0);
  });
});

describe('markFailed', () => {
  it('increments poll_failures monotonically', () => {
    addRepo({ id: 'r1' });
    markFailed(db, 'r1');
    markFailed(db, 'r1');
    markFailed(db, 'r1');
    const row = db
      .prepare('SELECT poll_failures FROM repos WHERE id = ?')
      .get('r1') as { poll_failures: number };
    expect(row.poll_failures).toBe(3);
  });
});

describe('computeBackoffSeconds', () => {
  it('returns the base interval at 0 failures', () => {
    expect(computeBackoffSeconds(0, 300)).toBe(300);
  });

  it('doubles with each failure', () => {
    expect(computeBackoffSeconds(1, 300)).toBe(600);
    expect(computeBackoffSeconds(2, 300)).toBe(1200);
    expect(computeBackoffSeconds(3, 300)).toBe(2400);
  });

  it('caps at 1 hour', () => {
    expect(computeBackoffSeconds(20, 300)).toBe(3600);
  });

  it('treats negative failure count as 0', () => {
    expect(computeBackoffSeconds(-5, 300)).toBe(300);
  });
});
