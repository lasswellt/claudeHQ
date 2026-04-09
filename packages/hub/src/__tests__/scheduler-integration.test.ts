import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import pino from 'pino';
import { initDatabase } from '../db.js';
import { placeSession } from '../scheduler/placement.js';
import {
  createEnforcementSweeper,
  detectViolations,
  type EnforcementViolation,
} from '../scheduler/enforcement.js';
import { evaluateRetry } from '../scheduler/retry.js';

// E003 / story 014-009: scheduler end-to-end integration test.
// Exercises placement + enforcement + retry evaluation against a
// real in-memory database, asserting the happy path and the
// interaction between modules.

let db: Database.Database;
const silentLogger = pino({ level: 'silent' });

beforeEach(() => {
  db = initDatabase(':memory:');
});

afterEach(() => {
  db.close();
});

function addMachine(id: string, opts: { meta?: Record<string, unknown>; maxSessions?: number } = {}): void {
  db.prepare(
    `INSERT INTO machines (id, last_seen, status, max_sessions, meta)
     VALUES (?, ?, 'online', ?, ?)`,
  ).run(
    id,
    Math.floor(Date.now() / 1000),
    opts.maxSessions ?? 2,
    JSON.stringify(opts.meta ?? { cpuPercent: 20, memPercent: 20 }),
  );
}

function createQueuedSession(
  id: string,
  opts: { timeoutSeconds?: number; maxCostUsd?: number } = {},
): void {
  const placeholder = (
    db.prepare('SELECT id FROM machines LIMIT 1').get() as { id: string } | undefined
  )?.id;
  if (!placeholder) throw new Error('add a machine first');
  db.prepare(
    `INSERT INTO sessions (id, machine_id, prompt, cwd, status, created_at, timeout_seconds, max_cost_usd)
     VALUES (?, ?, 'prompt', '/tmp', 'queued', ?, ?, ?)`,
  ).run(
    id,
    placeholder,
    Math.floor(Date.now() / 1000),
    opts.timeoutSeconds ?? null,
    opts.maxCostUsd ?? null,
  );
}

describe('scheduler integration: placement + enforcement', () => {
  it('end-to-end: queue → place → run → timeout → terminate', () => {
    addMachine('fast', { meta: { cpuPercent: 10, memPercent: 10 } });
    addMachine('slow', { meta: { cpuPercent: 90, memPercent: 80 } });

    // Short timeout so we can trip the enforcement sweeper below.
    createQueuedSession('sess-1', { timeoutSeconds: 1 });

    // Placement should put the session on `fast`.
    const placement = placeSession(db, { sessionId: 'sess-1' });
    expect(placement.ok).toBe(true);
    if (placement.ok) expect(placement.machineId).toBe('fast');

    // Rewind started_at so the enforcement sweeper sees the
    // timeout window as breached (otherwise we'd need to sleep).
    db.prepare(
      `UPDATE sessions SET started_at = ? WHERE id = ?`,
    ).run(Math.floor(Date.now() / 1000) - 60, 'sess-1');

    const killed: EnforcementViolation[] = [];
    const sweeper = createEnforcementSweeper({
      db,
      logger: silentLogger,
      killSession: (v) => killed.push(v),
    });
    const violations = sweeper.sweep();

    expect(violations).toHaveLength(1);
    expect(killed[0]).toMatchObject({ sessionId: 'sess-1', reason: 'timeout' });

    const row = db.prepare('SELECT status, termination_reason FROM sessions WHERE id = ?').get('sess-1') as
      | { status: string; termination_reason: string }
      | undefined;
    expect(row?.status).toBe('failed');
    expect(row?.termination_reason).toBe('timeout');
  });

  it('concurrent placements on the same session do not both succeed', () => {
    addMachine('a');
    addMachine('b');
    createQueuedSession('sess-race');

    const first = placeSession(db, { sessionId: 'sess-race' });
    const second = placeSession(db, { sessionId: 'sess-race' });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe('session_already_placed');
    }

    // Only one running row for this session.
    const row = db.prepare(
      "SELECT COUNT(*) as c FROM sessions WHERE id = ? AND status = 'running'",
    ).get('sess-race') as { c: number };
    expect(row.c).toBe(1);
  });

  it('cost limit triggers enforcement and retry policy can then re-queue', () => {
    addMachine('host');
    createQueuedSession('sess-cost', { maxCostUsd: 5 });
    placeSession(db, { sessionId: 'sess-cost' });

    // Record enough cost to breach the limit.
    db.prepare(
      `INSERT INTO session_costs (session_id, cost_usd, input_tokens, output_tokens, thinking_tokens, created_at)
       VALUES (?, 10, 0, 0, 0, ?)`,
    ).run('sess-cost', Math.floor(Date.now() / 1000));

    const violations = detectViolations(db);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toBe('cost_limit_exceeded');

    // A retry policy that allows retrying on any non-zero exit code
    // would still re-queue the task after enforcement, simulating a
    // "cost-terminated task, please try again with a smaller slice".
    const decision = evaluateRetry({
      exitCode: 137, // killed by enforcement
      retryCount: 0,
      policy: { maxRetries: 2, backoffSeconds: 30 },
      now: Math.floor(Date.now() / 1000),
    });
    expect(decision.retry).toBe(true);
    if (decision.retry) {
      expect(decision.nextRetryCount).toBe(1);
      expect(decision.backoffSeconds).toBe(30);
    }
  });
});
