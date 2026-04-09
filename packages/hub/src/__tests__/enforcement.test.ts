import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../db.js';
import {
  detectViolations,
  markTerminated,
  createEnforcementSweeper,
  type EnforcementViolation,
} from '../scheduler/enforcement.js';
import pino from 'pino';

// E003 / story 014-004: timeout + cost enforcement sweeper.

let db: Database.Database;
const silentLogger = pino({ level: 'silent' });

beforeEach(() => {
  db = initDatabase(':memory:');
  // Register a machine so FK constraints on sessions.machine_id pass.
  db.prepare(
    `INSERT INTO machines (id, display_name, last_seen, status, max_sessions)
     VALUES ('m1', 'm1', ?, 'online', 4)`,
  ).run(Math.floor(Date.now() / 1000));
});

afterEach(() => {
  db.close();
});

function insertRunningSession(opts: {
  id: string;
  startedAt: number;
  timeoutSeconds?: number | null;
  maxCostUsd?: number | null;
}): void {
  db.prepare(
    `INSERT INTO sessions (id, machine_id, prompt, cwd, status, created_at, started_at, timeout_seconds, max_cost_usd)
     VALUES (?, 'm1', 'test', '/tmp', 'running', ?, ?, ?, ?)`,
  ).run(
    opts.id,
    opts.startedAt,
    opts.startedAt,
    opts.timeoutSeconds ?? null,
    opts.maxCostUsd ?? null,
  );
}

function recordCost(sessionId: string, costUsd: number): void {
  db.prepare(
    `INSERT INTO session_costs (session_id, cost_usd, input_tokens, output_tokens, thinking_tokens, created_at)
     VALUES (?, ?, 0, 0, 0, ?)`,
  ).run(sessionId, costUsd, Math.floor(Date.now() / 1000));
}

describe('detectViolations', () => {
  it('returns empty when no running sessions are over limit', () => {
    const now = Math.floor(Date.now() / 1000);
    insertRunningSession({ id: 'ok', startedAt: now - 10, timeoutSeconds: 300 });
    expect(detectViolations(db)).toEqual([]);
  });

  it('detects a timeout violation', () => {
    const now = Math.floor(Date.now() / 1000);
    // Started 400s ago with a 300s timeout → 100s over.
    insertRunningSession({ id: 'expired', startedAt: now - 400, timeoutSeconds: 300 });
    const violations = detectViolations(db);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ sessionId: 'expired', reason: 'timeout' });
  });

  it('ignores sessions without a timeout_seconds', () => {
    const now = Math.floor(Date.now() / 1000);
    insertRunningSession({ id: 'no-timeout', startedAt: now - 99999, timeoutSeconds: null });
    expect(detectViolations(db)).toEqual([]);
  });

  it('ignores non-running sessions', () => {
    const now = Math.floor(Date.now() / 1000);
    insertRunningSession({ id: 'done', startedAt: now - 99999, timeoutSeconds: 10 });
    db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('completed', 'done');
    expect(detectViolations(db)).toEqual([]);
  });

  it('detects a cost-limit violation', () => {
    const now = Math.floor(Date.now() / 1000);
    insertRunningSession({ id: 'pricey', startedAt: now - 10, maxCostUsd: 5 });
    recordCost('pricey', 6);
    const violations = detectViolations(db);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      sessionId: 'pricey',
      reason: 'cost_limit_exceeded',
    });
  });

  it('does not flag cost exactly at the limit', () => {
    const now = Math.floor(Date.now() / 1000);
    insertRunningSession({ id: 'exact', startedAt: now - 10, maxCostUsd: 5 });
    recordCost('exact', 5);
    expect(detectViolations(db)).toEqual([]);
  });

  it('prefers timeout reason when both fire at once', () => {
    const now = Math.floor(Date.now() / 1000);
    insertRunningSession({
      id: 'both',
      startedAt: now - 400,
      timeoutSeconds: 300,
      maxCostUsd: 5,
    });
    recordCost('both', 10);
    const violations = detectViolations(db);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toBe('timeout');
  });
});

describe('markTerminated', () => {
  it('marks the session as failed with the reason', () => {
    const now = Math.floor(Date.now() / 1000);
    insertRunningSession({ id: 's1', startedAt: now - 10, timeoutSeconds: 5 });
    markTerminated(db, {
      sessionId: 's1',
      machineId: 'm1',
      reason: 'timeout',
      detail: {},
    });
    const row = db.prepare('SELECT status, termination_reason FROM sessions WHERE id = ?').get('s1') as
      | { status: string; termination_reason: string }
      | undefined;
    expect(row?.status).toBe('failed');
    expect(row?.termination_reason).toBe('timeout');
  });

  it('does not touch already-resolved sessions', () => {
    const now = Math.floor(Date.now() / 1000);
    insertRunningSession({ id: 's1', startedAt: now - 10 });
    db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('completed', 's1');
    markTerminated(db, {
      sessionId: 's1',
      machineId: 'm1',
      reason: 'timeout',
      detail: {},
    });
    const row = db.prepare('SELECT status, termination_reason FROM sessions WHERE id = ?').get('s1') as
      | { status: string; termination_reason: string | null }
      | undefined;
    expect(row?.status).toBe('completed');
    expect(row?.termination_reason).toBeNull();
  });
});

describe('createEnforcementSweeper', () => {
  it('sweep() calls killSession for every violation', () => {
    const now = Math.floor(Date.now() / 1000);
    insertRunningSession({ id: 's1', startedAt: now - 400, timeoutSeconds: 300 });
    insertRunningSession({ id: 's2', startedAt: now - 10, maxCostUsd: 1 });
    recordCost('s2', 2);

    const killed: EnforcementViolation[] = [];
    const sweeper = createEnforcementSweeper({
      db,
      logger: silentLogger,
      killSession: (v) => killed.push(v),
    });
    const violations = sweeper.sweep();
    expect(violations).toHaveLength(2);
    expect(killed).toHaveLength(2);
    const ids = killed.map((v) => v.sessionId).sort();
    expect(ids).toEqual(['s1', 's2']);
  });

  it('start() / stop() attach and detach a timer', () => {
    const sweeper = createEnforcementSweeper({
      db,
      logger: silentLogger,
      killSession: () => {},
      intervalMs: 1_000_000, // long interval so it doesn't fire during the test
    });
    expect(() => sweeper.start()).not.toThrow();
    expect(() => sweeper.stop()).not.toThrow();
  });
});
