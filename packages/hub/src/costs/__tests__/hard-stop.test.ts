import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../db.js';
import { checkHardStop } from '../hard-stop.js';

// CAP-071 / story 015-004: monthly hard-stop check.

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(':memory:');
  db.prepare(
    `INSERT INTO machines (id, last_seen, status, max_sessions) VALUES ('m1', ?, 'online', 2)`,
  ).run(Math.floor(Date.now() / 1000));
});

afterEach(() => {
  db.close();
});

function setConfig(opts: {
  enabled: number;
  hardStop: number;
  globalDailyUsd: number | null;
}): void {
  db.prepare(
    `INSERT OR REPLACE INTO budget_config (id, global_daily_usd, enabled, hard_stop)
     VALUES ('default', ?, ?, ?)`,
  ).run(opts.globalDailyUsd, opts.enabled, opts.hardStop);
}

function recordCost(costUsd: number, atUnix?: number): void {
  const id = `s-${Math.random().toString(36).slice(2, 10)}`;
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

describe('checkHardStop', () => {
  it('returns not blocked when budget is disabled', () => {
    setConfig({ enabled: 0, hardStop: 1, globalDailyUsd: 10 });
    recordCost(9999);
    expect(checkHardStop(db).blocked).toBe(false);
  });

  it('returns not blocked when hard_stop is off', () => {
    setConfig({ enabled: 1, hardStop: 0, globalDailyUsd: 10 });
    recordCost(9999);
    expect(checkHardStop(db).blocked).toBe(false);
  });

  it('returns not blocked when no budget row exists', () => {
    // No INSERT into budget_config
    expect(checkHardStop(db).blocked).toBe(false);
  });

  it('returns not blocked when global_daily_usd is null', () => {
    setConfig({ enabled: 1, hardStop: 1, globalDailyUsd: null });
    recordCost(9999);
    expect(checkHardStop(db).blocked).toBe(false);
  });

  it('returns not blocked when spend is below the monthly cap', () => {
    // $10 daily * 30 = $300 monthly cap
    setConfig({ enabled: 1, hardStop: 1, globalDailyUsd: 10 });
    recordCost(150);
    const result = checkHardStop(db);
    expect(result.blocked).toBe(false);
    expect(result.spentUsd).toBeCloseTo(150, 2);
    expect(result.limitUsd).toBeCloseTo(300, 2);
  });

  it('blocks when monthly spend reaches 100%', () => {
    setConfig({ enabled: 1, hardStop: 1, globalDailyUsd: 10 });
    recordCost(300);
    const result = checkHardStop(db);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('Monthly budget reached');
    expect(result.spentUsd).toBeCloseTo(300, 2);
  });

  it('blocks when monthly spend exceeds 100%', () => {
    setConfig({ enabled: 1, hardStop: 1, globalDailyUsd: 10 });
    recordCost(400);
    expect(checkHardStop(db).blocked).toBe(true);
  });

  it('only counts current-month spend', () => {
    setConfig({ enabled: 1, hardStop: 1, globalDailyUsd: 10 });
    // Old spend (2 months ago) shouldn't count against this month.
    const oldTs = Math.floor(Date.UTC(2025, 1, 1) / 1000);
    recordCost(1000, oldTs);
    const result = checkHardStop(db, { now: () => new Date('2026-04-09T12:00:00Z') });
    expect(result.blocked).toBe(false);
    expect(result.spentUsd).toBeCloseTo(0, 2);
  });
});
