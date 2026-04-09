import type Database from 'better-sqlite3';

/**
 * CAP-071 / story 015-003: budget threshold enforcer.
 *
 * Pure-ish module — pulls current spend from `session_costs` and
 * budget caps from `budget_config`, then emits threshold-crossing
 * events at 50/75/90/100% of daily and monthly limits. Each
 * crossing is recorded in `budget_threshold_events` with a UNIQUE
 * constraint on (scope, period, threshold_pct) so we never notify
 * twice for the same period.
 *
 * The caller decides how to deliver the notification — this module
 * only returns the list of newly-crossed thresholds; delivery is
 * wired via the CAP-032 notification router externally.
 */

export type ThresholdPct = 50 | 75 | 90 | 100;
export const THRESHOLD_PCTS: readonly ThresholdPct[] = [50, 75, 90, 100];

export type BudgetPeriod = 'daily' | 'monthly';

export interface ThresholdCrossing {
  scope: string;
  period: string;
  thresholdPct: ThresholdPct;
  observedUsd: number;
  limitUsd: number;
}

export interface BudgetEnforcerOptions {
  db: Database.Database;
  /** Injectable clock — defaults to Date.now(). */
  now?: () => Date;
}

/**
 * Returns the canonical period key for the current UTC date.
 *   daily   → "daily:YYYY-MM-DD"
 *   monthly → "monthly:YYYY-MM"
 */
export function currentPeriodKey(period: BudgetPeriod, now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return period === 'daily'
    ? `daily:${year}-${month}-${day}`
    : `monthly:${year}-${month}`;
}

/**
 * Given spent and limit, return the threshold buckets that have
 * been crossed. E.g. spent=80, limit=100 → [50, 75]. Never returns
 * 100 unless spent >= limit.
 */
export function crossedThresholds(spentUsd: number, limitUsd: number): ThresholdPct[] {
  if (limitUsd <= 0) return [];
  const pct = (spentUsd / limitUsd) * 100;
  return THRESHOLD_PCTS.filter((t) => pct >= t);
}

export interface BudgetEnforcer {
  /** One evaluation pass — returns newly-crossed thresholds. */
  evaluate(): ThresholdCrossing[];
}

export function createBudgetEnforcer(opts: BudgetEnforcerOptions): BudgetEnforcer {
  const now = opts.now ?? (() => new Date());

  const getConfigStmt = opts.db.prepare(
    "SELECT * FROM budget_config WHERE id = 'default'",
  );
  const sumDailyGlobalStmt = opts.db.prepare(
    'SELECT COALESCE(SUM(cost_usd), 0) AS total FROM session_costs WHERE created_at >= ?',
  );
  const sumDailyMachineStmt = opts.db.prepare(
    `SELECT COALESCE(SUM(sc.cost_usd), 0) AS total
     FROM session_costs sc
     JOIN sessions s ON sc.session_id = s.id
     WHERE s.machine_id = ? AND sc.created_at >= ?`,
  );
  const listMachinesStmt = opts.db.prepare(
    "SELECT id FROM machines WHERE status = 'online'",
  );
  const selectEventStmt = opts.db.prepare(
    `SELECT id FROM budget_threshold_events
     WHERE scope = ? AND period = ? AND threshold_pct = ?`,
  );
  const insertEventStmt = opts.db.prepare(
    `INSERT INTO budget_threshold_events (scope, period, threshold_pct, observed_usd, limit_usd)
     VALUES (?, ?, ?, ?, ?)`,
  );

  function hasBeenRecorded(scope: string, period: string, pct: ThresholdPct): boolean {
    return selectEventStmt.get(scope, period, pct) !== undefined;
  }

  function recordCrossing(
    scope: string,
    period: string,
    pct: ThresholdPct,
    observedUsd: number,
    limitUsd: number,
  ): void {
    try {
      insertEventStmt.run(scope, period, pct, observedUsd, limitUsd);
    } catch {
      // UNIQUE constraint — another sweeper pass already recorded it.
      // Treat as idempotent success.
    }
  }

  function evaluateScope(
    scope: string,
    spentUsd: number,
    limitUsd: number,
    period: string,
  ): ThresholdCrossing[] {
    const results: ThresholdCrossing[] = [];
    for (const pct of crossedThresholds(spentUsd, limitUsd)) {
      if (hasBeenRecorded(scope, period, pct)) continue;
      recordCrossing(scope, period, pct, spentUsd, limitUsd);
      results.push({ scope, period, thresholdPct: pct, observedUsd: spentUsd, limitUsd });
    }
    return results;
  }

  return {
    evaluate(): ThresholdCrossing[] {
      const config = getConfigStmt.get() as Record<string, unknown> | undefined;
      if (!config || !(config.enabled as number)) return [];

      const currentDate = now();
      const dailyKey = currentPeriodKey('daily', currentDate);
      const monthlyKey = currentPeriodKey('monthly', currentDate);
      // Unix-seconds start-of-day in UTC
      const startOfDayUtc = Math.floor(
        Date.UTC(
          currentDate.getUTCFullYear(),
          currentDate.getUTCMonth(),
          currentDate.getUTCDate(),
        ) / 1000,
      );

      const crossings: ThresholdCrossing[] = [];

      // Global daily
      const globalDailyMax = config.global_daily_usd as number | null;
      if (globalDailyMax && globalDailyMax > 0) {
        const { total } = sumDailyGlobalStmt.get(startOfDayUtc) as { total: number };
        crossings.push(...evaluateScope('global', total, globalDailyMax, dailyKey));
      }

      // Per-machine daily
      const perMachineDailyMax = config.per_machine_daily_usd as number | null;
      if (perMachineDailyMax && perMachineDailyMax > 0) {
        const machines = listMachinesStmt.all() as Array<{ id: string }>;
        for (const m of machines) {
          const { total } = sumDailyMachineStmt.get(m.id, startOfDayUtc) as { total: number };
          crossings.push(
            ...evaluateScope(`machine:${m.id}`, total, perMachineDailyMax, dailyKey),
          );
        }
      }

      // Monthly global — treat global_daily_usd * 30 as a reasonable
      // ceiling until the budget_config schema grows a dedicated
      // monthly field. Documented as a follow-up.
      if (globalDailyMax && globalDailyMax > 0) {
        const monthStartUtc = Math.floor(
          Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), 1) / 1000,
        );
        const { total } = sumDailyGlobalStmt.get(monthStartUtc) as { total: number };
        const monthlyLimit = globalDailyMax * 30;
        crossings.push(
          ...evaluateScope('global', total, monthlyLimit, monthlyKey),
        );
      }

      return crossings;
    },
  };
}
