import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../db.js';
import {
  detectStale,
  transitionStale,
  markDeleted,
  countActiveWorkspaces,
  canProvisionOnMachine,
} from '../workspace-ttl.js';

// E005 / story 016-001: workspace TTL sweeper.

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(':memory:');
  db.prepare(
    `INSERT INTO machines (id, last_seen, status, max_sessions) VALUES ('m1', ?, 'online', 2)`,
  ).run(Math.floor(Date.now() / 1000));
  db.prepare(
    `INSERT INTO repos (id, url, name, default_branch, auth_method)
     VALUES ('r1', 'git@example:r1.git', 'r1', 'main', 'ssh_key')`,
  ).run();
});

afterEach(() => {
  db.close();
});

function addWorkspace(opts: {
  id: string;
  status: string;
  idleSince: number | null;
  machineId?: string;
}): void {
  db.prepare(
    `INSERT INTO workspaces (id, repo_id, machine_id, path, branch, status, idle_since)
     VALUES (?, 'r1', ?, ?, 'main', ?, ?)`,
  ).run(opts.id, opts.machineId ?? 'm1', `/tmp/${opts.id}`, opts.status, opts.idleSince);
}

describe('detectStale', () => {
  it('returns empty when no workspaces match', () => {
    const now = Math.floor(Date.now() / 1000);
    addWorkspace({ id: 'fresh', status: 'ready', idleSince: now });
    const result = detectStale(db, { readyToStaleSeconds: 3600, staleToCleanupSeconds: 3600 });
    expect(result.readyToStale).toEqual([]);
    expect(result.staleToCleanup).toEqual([]);
  });

  it('flags ready workspaces older than readyToStale TTL', () => {
    const now = Math.floor(Date.now() / 1000);
    addWorkspace({ id: 'old-ready', status: 'ready', idleSince: now - 7200 });
    addWorkspace({ id: 'young-ready', status: 'ready', idleSince: now - 300 });
    const result = detectStale(db, { readyToStaleSeconds: 3600, staleToCleanupSeconds: 3600 });
    expect(result.readyToStale.map((w) => w.id)).toEqual(['old-ready']);
  });

  it('flags stale workspaces older than combined TTL for cleanup', () => {
    const now = Math.floor(Date.now() / 1000);
    // idle_since = 7200s ago; ready→stale (3600) + stale→cleanup (3600) = 7200 total
    addWorkspace({ id: 'eligible', status: 'stale', idleSince: now - 7201 });
    addWorkspace({ id: 'not-yet', status: 'stale', idleSince: now - 3601 });
    const result = detectStale(db, { readyToStaleSeconds: 3600, staleToCleanupSeconds: 3600 });
    expect(result.staleToCleanup.map((w) => w.id)).toEqual(['eligible']);
  });

  it('skips workspaces without idle_since', () => {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO workspaces (id, repo_id, machine_id, path, branch, status, idle_since)
       VALUES ('no-idle', 'r1', 'm1', '/tmp/w', 'main', 'ready', NULL)`,
    ).run();
    const result = detectStale(db, {
      readyToStaleSeconds: 60,
      staleToCleanupSeconds: 60,
      now: () => now,
    });
    expect(result.readyToStale).toEqual([]);
  });

  it('honors injectable clock', () => {
    // Set idle_since to a specific value; fake now returns something
    // way in the future so every workspace looks stale.
    addWorkspace({ id: 'w1', status: 'ready', idleSince: 1000 });
    const result = detectStale(db, {
      readyToStaleSeconds: 60,
      staleToCleanupSeconds: 60,
      now: () => 99999,
    });
    expect(result.readyToStale).toHaveLength(1);
  });
});

describe('transitionStale', () => {
  it('transitions ready → stale and stale → cleanup', () => {
    const now = Math.floor(Date.now() / 1000);
    addWorkspace({ id: 'a', status: 'ready', idleSince: now - 7200 });
    addWorkspace({ id: 'b', status: 'stale', idleSince: now - 14400 });

    const detect = detectStale(db, { readyToStaleSeconds: 3600, staleToCleanupSeconds: 3600 });
    const summary = transitionStale(db, detect);

    expect(summary.becameStale).toBe(1);
    expect(summary.becameCleanup).toBe(1);
    expect((db.prepare('SELECT status FROM workspaces WHERE id = ?').get('a') as { status: string }).status).toBe('stale');
    expect((db.prepare('SELECT status FROM workspaces WHERE id = ?').get('b') as { status: string }).status).toBe('cleanup');
  });

  it('is safe to run twice (idempotent)', () => {
    const now = Math.floor(Date.now() / 1000);
    addWorkspace({ id: 'a', status: 'ready', idleSince: now - 7200 });
    const detect1 = detectStale(db, { readyToStaleSeconds: 3600, staleToCleanupSeconds: 3600 });
    transitionStale(db, detect1);

    // Second call: the ready-row is gone (it became stale), so detect
    // should find nothing to transition from ready.
    const detect2 = detectStale(db, { readyToStaleSeconds: 3600, staleToCleanupSeconds: 3600 });
    expect(detect2.readyToStale).toEqual([]);
  });
});

describe('markDeleted', () => {
  it('only marks workspaces currently in cleanup status', () => {
    addWorkspace({ id: 'a', status: 'cleanup', idleSince: 0 });
    addWorkspace({ id: 'b', status: 'ready', idleSince: 0 });

    expect(markDeleted(db, 'a')).toBe(true);
    expect(markDeleted(db, 'b')).toBe(false);

    expect((db.prepare('SELECT status FROM workspaces WHERE id = ?').get('a') as { status: string }).status).toBe('deleted');
    expect((db.prepare('SELECT status FROM workspaces WHERE id = ?').get('b') as { status: string }).status).toBe('ready');
  });
});

describe('countActiveWorkspaces', () => {
  it('excludes deleted and cleanup workspaces', () => {
    addWorkspace({ id: 'r', status: 'ready', idleSince: 0 });
    addWorkspace({ id: 'a', status: 'active', idleSince: 0 });
    addWorkspace({ id: 'c', status: 'cleanup', idleSince: 0 });
    addWorkspace({ id: 'd', status: 'deleted', idleSince: 0 });
    expect(countActiveWorkspaces(db, 'm1')).toBe(2);
  });

  it('scopes by machine', () => {
    db.prepare(
      `INSERT INTO machines (id, last_seen, status, max_sessions) VALUES ('m2', ?, 'online', 2)`,
    ).run(Math.floor(Date.now() / 1000));
    addWorkspace({ id: 'a', status: 'ready', idleSince: 0, machineId: 'm1' });
    addWorkspace({ id: 'b', status: 'ready', idleSince: 0, machineId: 'm2' });
    expect(countActiveWorkspaces(db, 'm1')).toBe(1);
    expect(countActiveWorkspaces(db, 'm2')).toBe(1);
  });
});

describe('canProvisionOnMachine', () => {
  it('allows when under the cap', () => {
    addWorkspace({ id: 'a', status: 'ready', idleSince: 0 });
    const result = canProvisionOnMachine(db, 'm1', 3);
    expect(result.allowed).toBe(true);
    expect(result.current).toBe(1);
    expect(result.max).toBe(3);
  });

  it('rejects when at the cap', () => {
    addWorkspace({ id: 'a', status: 'ready', idleSince: 0 });
    addWorkspace({ id: 'b', status: 'ready', idleSince: 0 });
    expect(canProvisionOnMachine(db, 'm1', 2).allowed).toBe(false);
  });
});
