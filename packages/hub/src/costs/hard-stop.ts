import type Database from 'better-sqlite3';

/**
 * CAP-071 / story 015-004: monthly hard-stop check.
 *
 * Pure read-only query. Returns true when:
 *   - budget_config.enabled = 1
 *   - budget_config.hard_stop = 1
 *   - Monthly global spend has reached 100% of the monthly cap
 *     (derived as `global_daily_usd * 30` until the config schema
 *     adds a dedicated monthly cap column).
 *
 * The session-create route calls this before inserting a new row;
 * a `true` return should translate to HTTP 402 Payment Required.
 */

export interface HardStopCheckOptions {
  /** Injectable clock — defaults to new Date(). */
  now?: () => Date;
}

export interface HardStopCheck {
  blocked: boolean;
  reason?: string;
  spentUsd?: number;
  limitUsd?: number;
}

export function checkHardStop(
  db: Database.Database,
  opts: HardStopCheckOptions = {},
): HardStopCheck {
  const config = db
    .prepare("SELECT * FROM budget_config WHERE id = 'default'")
    .get() as Record<string, unknown> | undefined;

  if (!config || !(config.enabled as number)) return { blocked: false };
  if (!(config.hard_stop as number)) return { blocked: false };

  const dailyMax = config.global_daily_usd as number | null;
  if (!dailyMax || dailyMax <= 0) return { blocked: false };

  const now = (opts.now ?? (() => new Date()))();
  const monthStartUtc = Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000,
  );

  const row = db
    .prepare(
      'SELECT COALESCE(SUM(cost_usd), 0) AS total FROM session_costs WHERE created_at >= ?',
    )
    .get(monthStartUtc) as { total: number };

  const monthlyLimit = dailyMax * 30;
  if (row.total >= monthlyLimit) {
    return {
      blocked: true,
      reason: `Monthly budget reached ($${row.total.toFixed(2)} / $${monthlyLimit.toFixed(2)})`,
      spentUsd: row.total,
      limitUsd: monthlyLimit,
    };
  }

  return { blocked: false, spentUsd: row.total, limitUsd: monthlyLimit };
}
