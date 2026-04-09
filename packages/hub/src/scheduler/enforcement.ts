import type Database from 'better-sqlite3';
import type { FastifyBaseLogger } from 'fastify';

/**
 * CAP-011 / story 014-004: timeout + cost enforcement sweeper.
 *
 * Runs on a 10s interval, finds running sessions that have breached
 * either their `timeout_seconds` window or their `max_cost_usd`
 * budget, and invokes a caller-provided `killSession` callback so
 * the hub can send `hub:session:kill` over the agent WS. The
 * offending session is marked with a `termination_reason` so the
 * UI can surface why it was terminated.
 *
 * Pure orchestration module — the caller injects the DB and the
 * kill function, making the module trivially testable with a real
 * in-memory DB + a stub kill function.
 */

export type TerminationReason = 'timeout' | 'cost_limit_exceeded';

export interface EnforcementViolation {
  sessionId: string;
  machineId: string;
  reason: TerminationReason;
  detail: Record<string, unknown>;
}

export interface EnforcementSweeperOptions {
  db: Database.Database;
  logger: FastifyBaseLogger;
  /** Invoked once per detected violation; implementation decides how to kill. */
  killSession: (violation: EnforcementViolation) => void;
  /** Defaults to 10_000. */
  intervalMs?: number;
}

export interface EnforcementSweeper {
  /** Run one sweep synchronously — returns the list of violations it acted on. */
  sweep(): EnforcementViolation[];
  /** Start the interval loop. Safe to call multiple times. */
  start(): void;
  /** Stop the interval loop. */
  stop(): void;
}

/**
 * Finds running sessions that have breached timeout or cost limits.
 * Exported separately from `start()` so tests can run the detection
 * step without spawning a timer.
 */
export function detectViolations(db: Database.Database): EnforcementViolation[] {
  const nowSeconds = Math.floor(Date.now() / 1000);

  // Timeout violations: started_at + timeout_seconds < now.
  // We skip sessions without a timeout_seconds or started_at.
  const timedOut = db
    .prepare(
      `SELECT id, machine_id, started_at, timeout_seconds
       FROM sessions
       WHERE status = 'running'
         AND timeout_seconds IS NOT NULL
         AND started_at IS NOT NULL
         AND (started_at + timeout_seconds) < ?`,
    )
    .all(nowSeconds) as Array<{
    id: string;
    machine_id: string;
    started_at: number;
    timeout_seconds: number;
  }>;

  // Cost violations: session_costs SUM > sessions.max_cost_usd.
  const overBudget = db
    .prepare(
      `SELECT s.id, s.machine_id, s.max_cost_usd,
              COALESCE((SELECT SUM(cost_usd) FROM session_costs sc WHERE sc.session_id = s.id), 0) AS spent
       FROM sessions s
       WHERE s.status = 'running'
         AND s.max_cost_usd IS NOT NULL`,
    )
    .all() as Array<{
    id: string;
    machine_id: string;
    max_cost_usd: number;
    spent: number;
  }>;

  const violations: EnforcementViolation[] = [];

  for (const row of timedOut) {
    violations.push({
      sessionId: row.id,
      machineId: row.machine_id,
      reason: 'timeout',
      detail: {
        startedAt: row.started_at,
        timeoutSeconds: row.timeout_seconds,
        nowSeconds,
      },
    });
  }

  // Deduplicate — a session can hit both timeout and cost at once;
  // we only kill once and prefer the timeout reason (it's simpler).
  const timedOutIds = new Set(timedOut.map((r) => r.id));
  for (const row of overBudget) {
    if (timedOutIds.has(row.id)) continue;
    if (row.spent <= row.max_cost_usd) continue;
    violations.push({
      sessionId: row.id,
      machineId: row.machine_id,
      reason: 'cost_limit_exceeded',
      detail: {
        spent: row.spent,
        maxCostUsd: row.max_cost_usd,
      },
    });
  }

  return violations;
}

/**
 * Marks a session as failed with a termination_reason. Separated
 * from detectViolations so the caller can choose whether to mark
 * before or after notifying the agent — we prefer mark-then-kill so
 * a race in the kill channel still leaves a correct DB state.
 */
export function markTerminated(
  db: Database.Database,
  violation: EnforcementViolation,
): void {
  db.prepare(
    `UPDATE sessions
     SET status = 'failed',
         termination_reason = ?,
         ended_at = ?
     WHERE id = ? AND status = 'running'`,
  ).run(violation.reason, Math.floor(Date.now() / 1000), violation.sessionId);
}

export function createEnforcementSweeper(
  opts: EnforcementSweeperOptions,
): EnforcementSweeper {
  const intervalMs = opts.intervalMs ?? 10_000;
  let timer: ReturnType<typeof setInterval> | null = null;

  const sweepOnce = (): EnforcementViolation[] => {
    let violations: EnforcementViolation[] = [];
    try {
      violations = detectViolations(opts.db);
    } catch (err) {
      opts.logger.error({ err }, 'enforcement sweep: detection failed');
      return [];
    }
    for (const v of violations) {
      try {
        markTerminated(opts.db, v);
        opts.killSession(v);
        opts.logger.warn(
          { sessionId: v.sessionId, reason: v.reason, detail: v.detail },
          'session terminated by enforcement sweeper',
        );
      } catch (err) {
        opts.logger.error({ err, sessionId: v.sessionId }, 'enforcement kill failed');
      }
    }
    return violations;
  };

  return {
    sweep: sweepOnce,
    start(): void {
      if (timer) return;
      timer = setInterval(sweepOnce, intervalMs);
      // Don't keep Node alive just for the sweeper — graceful shutdown
      // will call stop() explicitly.
      timer.unref();
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
