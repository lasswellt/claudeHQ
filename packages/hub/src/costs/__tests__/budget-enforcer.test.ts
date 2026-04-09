import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../db.js';
import {
  createBudgetEnforcer,
  crossedThresholds,
  currentPeriodKey,
  THRESHOLD_PCTS,
} from '../budget-enforcer.js';

// CAP-071 / story 015-003: budget enforcer tests.

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(':memory:');
  // Enable budgeting with a $100 daily global cap.
  db.prepare(
    `INSERT INTO budget_config (id, per_session_max_usd, per_machine_daily_usd, global_daily_usd, enabled)
     VALUES ('default', NULL, 50, 100, 1)`,
  ).run();
  db.prepare(
    `INSERT INTO machines (id, last_seen, status, max_sessions) VALUES ('m1', ?, 'online', 2)`,
  ).run(Math.floor(Date.now() / 1000));
  db.prepare(
    `INSERT INTO sessions (id, machine_id, prompt, cwd, status, created_at)
     VALUES ('s1', 'm1', 'p', '/tmp', 'running', ?)`,
  ).run(Math.floor(Date.now() / 1000));
});

afterEach(() => {
  db.close();
});

function recordCost(sessionId: string, costUsd: number, atUnix?: number): void {
  // Add a new row per call by varying the PK — session_costs has
  // session_id as PK, so we need unique session rows per cost.
  const id = `${sessionId}-${Math.random().toString(36).slice(2, 8)}`;
  const ts = atUnix ?? Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO sessions (id, machine_id, prompt, cwd, status, created_at)
     VALUES (?, 'm1', 'p', '/tmp', 'completed', ?)`,
  ).run(id, ts);
  db.prepare(
    `INSERT INTO session_costs (session_id, cost_usd, input_tokens, output_tokens, thinking_tokens, created_at)
     VALUES (?, ?, 0, 0, 0, ?)`,
  ).run(id, costUsd, ts);
}

const numAsc = (a: number, b: number): number => a - b;

describe('crossedThresholds', () => {
  it('returns empty when spent is well below threshold', () => {
    expect(crossedThresholds(10, 100)).toEqual([]);
  });

  it('returns 50 at 50%', () => {
    expect(crossedThresholds(50, 100)).toEqual([50]);
  });

  it('returns 50, 75 at 80%', () => {
    expect(crossedThresholds(80, 100)).toEqual([50, 75]);
  });

  it('returns all four at 100%', () => {
    expect(crossedThresholds(100, 100)).toEqual([50, 75, 90, 100]);
  });

  it('returns all four when over 100%', () => {
    expect(crossedThresholds(150, 100)).toEqual([50, 75, 90, 100]);
  });

  it('returns empty for zero or negative limit', () => {
    expect(crossedThresholds(10, 0)).toEqual([]);
    expect(crossedThresholds(10, -5)).toEqual([]);
  });

  it('THRESHOLD_PCTS is sorted ascending', () => {
    for (let i = 1; i < THRESHOLD_PCTS.length; i++) {
      expect(THRESHOLD_PCTS[i]).toBeGreaterThan(THRESHOLD_PCTS[i - 1]!);
    }
  });
});

describe('currentPeriodKey', () => {
  it('formats daily keys as YYYY-MM-DD', () => {
    const key = currentPeriodKey('daily', new Date('2026-04-09T12:00:00Z'));
    expect(key).toBe('daily:2026-04-09');
  });

  it('formats monthly keys as YYYY-MM', () => {
    const key = currentPeriodKey('monthly', new Date('2026-04-09T12:00:00Z'));
    expect(key).toBe('monthly:2026-04');
  });
});

describe('createBudgetEnforcer', () => {
  it('emits no crossings when spend is zero', () => {
    const enforcer = createBudgetEnforcer({ db });
    expect(enforcer.evaluate()).toEqual([]);
  });

  it('returns nothing when budget_config is disabled', () => {
    db.prepare("UPDATE budget_config SET enabled = 0 WHERE id = 'default'").run();
    recordCost('s1', 60);
    const enforcer = createBudgetEnforcer({ db });
    expect(enforcer.evaluate()).toEqual([]);
  });

  it('fires 50% crossing when spend crosses halfway', () => {
    recordCost('s1', 55); // 55 of $100 → crosses 50
    const enforcer = createBudgetEnforcer({ db });
    const crossings = enforcer.evaluate();
    // Global + per-machine both cross 50% (each at $55 of $100 / $50)
    // Per-machine $55 of $50 limit → crosses 50, 75, 90, 100
    const globalHits = crossings.filter((c) => c.scope === 'global');
    const machineHits = crossings.filter((c) => c.scope === 'machine:m1');
    expect(globalHits.map((c) => c.thresholdPct).sort(numAsc)).toEqual([50]);
    expect(machineHits.map((c) => c.thresholdPct).sort(numAsc)).toEqual([50, 75, 90, 100]);
  });

  it('is idempotent across multiple evaluate() calls', () => {
    recordCost('s1', 55);
    const enforcer = createBudgetEnforcer({ db });
    const first = enforcer.evaluate();
    expect(first.length).toBeGreaterThan(0);

    const second = enforcer.evaluate();
    // No new crossings — all already recorded.
    expect(second).toEqual([]);
  });

  it('re-fires for a new period key', () => {
    // Day A: insert a cost dated 2026-04-09.
    const dayAStart = Math.floor(Date.UTC(2026, 3, 9, 12) / 1000);
    recordCost('s1', 55, dayAStart);

    let fake = new Date('2026-04-09T12:00:00Z');
    const enforcer = createBudgetEnforcer({ db, now: () => fake });
    const dayA = enforcer.evaluate();
    expect(dayA.length).toBeGreaterThan(0);

    // Day B: insert a fresh cost dated 2026-04-10 so the enforcer's
    // daily-window query finds it.
    const dayBStart = Math.floor(Date.UTC(2026, 3, 10, 12) / 1000);
    recordCost('s1', 55, dayBStart);
    fake = new Date('2026-04-10T12:00:00Z');
    const dayB = enforcer.evaluate();
    expect(dayB.length).toBeGreaterThan(0);
    expect(dayB[0]?.period).toContain('2026-04-10');
  });

  it('records observedUsd and limitUsd on crossings', () => {
    recordCost('s1', 77);
    const enforcer = createBudgetEnforcer({ db });
    const crossings = enforcer.evaluate();
    const global75 = crossings.find(
      (c) => c.scope === 'global' && c.thresholdPct === 75,
    );
    expect(global75).toBeDefined();
    expect(global75?.observedUsd).toBeCloseTo(77, 2);
    expect(global75?.limitUsd).toBe(100);
  });
});
