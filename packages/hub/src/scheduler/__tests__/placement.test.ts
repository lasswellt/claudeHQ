import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../db.js';
import { placeSession, snapshotMachines } from '../placement.js';

// E003 / story 014-003: atomic placement transaction.

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(':memory:');
});

afterEach(() => {
  db.close();
});

function addMachine(opts: {
  id: string;
  maxSessions?: number;
  capabilities?: string[];
  meta?: Record<string, unknown>;
}): void {
  db.prepare(
    `INSERT INTO machines (id, last_seen, status, max_sessions, meta, capabilities)
     VALUES (?, ?, 'online', ?, ?, ?)`,
  ).run(
    opts.id,
    Math.floor(Date.now() / 1000),
    opts.maxSessions ?? 2,
    JSON.stringify(opts.meta ?? { cpuPercent: 50, memPercent: 50 }),
    opts.capabilities ? JSON.stringify(opts.capabilities) : null,
  );
}

function addQueuedSession(id: string, requirements?: string[]): void {
  // The sessions table has a NOT NULL FK on machine_id, so a queued
  // session still needs a placeholder machine reference. Placement
  // overwrites this with the scheduler's pick, so any real machine
  // id will do — we pick the first one available.
  const placeholder = (
    db.prepare('SELECT id FROM machines LIMIT 1').get() as { id: string } | undefined
  )?.id;
  if (!placeholder) {
    throw new Error('Test harness: add a machine before addQueuedSession');
  }
  db.prepare(
    `INSERT INTO sessions (id, machine_id, prompt, cwd, status, created_at, requirements)
     VALUES (?, ?, 'prompt', '/tmp', 'queued', ?, ?)`,
  ).run(
    id,
    placeholder,
    Math.floor(Date.now() / 1000),
    requirements ? JSON.stringify(requirements) : null,
  );
}

describe('snapshotMachines', () => {
  it('returns neutral telemetry when meta is missing', () => {
    addMachine({ id: 'fresh' });
    db.prepare('UPDATE machines SET meta = NULL WHERE id = ?').run('fresh');
    const snapshots = snapshotMachines(db);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      machineId: 'fresh',
      cpuPercent: 50,
      memoryPercent: 50,
    });
  });

  it('parses capabilities from the JSON column', () => {
    addMachine({ id: 'gpu', capabilities: ['gpu', 'cuda-12'] });
    const snapshots = snapshotMachines(db);
    expect(snapshots[0]?.capabilities).toEqual(['gpu', 'cuda-12']);
  });

  it('counts running sessions as activeSessions', () => {
    addMachine({ id: 'busy', maxSessions: 4 });
    for (let i = 0; i < 3; i++) {
      db.prepare(
        `INSERT INTO sessions (id, machine_id, prompt, cwd, status, created_at)
         VALUES (?, 'busy', 'p', '/tmp', 'running', ?)`,
      ).run(`s-${i}`, Math.floor(Date.now() / 1000));
    }
    const snapshots = snapshotMachines(db);
    expect(snapshots[0]?.activeSessions).toBe(3);
  });
});

describe('placeSession', () => {
  it('places a queued session on the best-scoring machine', () => {
    addMachine({ id: 'fast', meta: { cpuPercent: 10, memPercent: 10 } });
    addMachine({ id: 'slow', meta: { cpuPercent: 95, memPercent: 90 } });
    addQueuedSession('sess-1');

    const result = placeSession(db, { sessionId: 'sess-1' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.machineId).toBe('fast');

    // Session row should now be running + machine pinned.
    const row = db.prepare('SELECT status, machine_id, started_at FROM sessions WHERE id = ?').get('sess-1') as
      | { status: string; machine_id: string; started_at: number | null }
      | undefined;
    expect(row?.status).toBe('running');
    expect(row?.machine_id).toBe('fast');
    expect(row?.started_at).toBeTypeOf('number');
  });

  it('respects capability requirements', () => {
    addMachine({ id: 'plain', meta: { cpuPercent: 10, memPercent: 10 } });
    addMachine({ id: 'gpu', meta: { cpuPercent: 50, memPercent: 50 }, capabilities: ['gpu'] });
    addQueuedSession('sess-gpu');

    const result = placeSession(db, { sessionId: 'sess-gpu', requirements: ['gpu'] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.machineId).toBe('gpu');
  });

  it('returns no_eligible_machines when requirements are unmet', () => {
    addMachine({ id: 'plain' });
    addQueuedSession('sess-tpu');
    const result = placeSession(db, { sessionId: 'sess-tpu', requirements: ['tpu'] });
    expect(result).toEqual({ ok: false, reason: 'no_eligible_machines' });
    // Session should still be queued.
    const row = db.prepare('SELECT status FROM sessions WHERE id = ?').get('sess-tpu') as
      | { status: string }
      | undefined;
    expect(row?.status).toBe('queued');
  });

  it('returns session_not_queued when the session does not exist', () => {
    addMachine({ id: 'a' });
    const result = placeSession(db, { sessionId: 'ghost' });
    expect(result).toEqual({ ok: false, reason: 'session_not_queued' });
  });

  it('returns session_already_placed when status is not queued', () => {
    addMachine({ id: 'a' });
    addQueuedSession('sess-1');
    db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('running', 'sess-1');
    const result = placeSession(db, { sessionId: 'sess-1' });
    expect(result).toEqual({ ok: false, reason: 'session_already_placed' });
  });

  it('handles the race window: a second placement sees session_already_placed', () => {
    addMachine({ id: 'a' });
    addQueuedSession('sess-1');

    const first = placeSession(db, { sessionId: 'sess-1' });
    expect(first.ok).toBe(true);

    const second = placeSession(db, { sessionId: 'sess-1' });
    expect(second).toEqual({ ok: false, reason: 'session_already_placed' });
  });

  it('skips machines whose max_sessions is exhausted', () => {
    addMachine({ id: 'full', maxSessions: 1 });
    db.prepare(
      `INSERT INTO sessions (id, machine_id, prompt, cwd, status, created_at)
       VALUES ('blocker', 'full', 'p', '/tmp', 'running', ?)`,
    ).run(Math.floor(Date.now() / 1000));
    addQueuedSession('sess-1');
    const result = placeSession(db, { sessionId: 'sess-1' });
    expect(result).toEqual({ ok: false, reason: 'no_eligible_machines' });
  });
});
