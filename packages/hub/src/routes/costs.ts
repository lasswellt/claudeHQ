import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type Database from 'better-sqlite3';

export async function costRoutes(app: FastifyInstance, db: Database.Database): Promise<void> {
  const sumTodayCostsStmt = db.prepare(
    'SELECT COALESCE(SUM(cost_usd), 0) as total, COALESCE(SUM(input_tokens + output_tokens + thinking_tokens), 0) as tokens FROM session_costs WHERE created_at >= ?',
  );
  const sumPeriodCostStmt = db.prepare(
    'SELECT COALESCE(SUM(cost_usd), 0) as total FROM session_costs WHERE created_at >= ?',
  );
  const costByRepoStmt = db.prepare(`
    SELECT r.name as repo_name, r.id as repo_id, COALESCE(SUM(sc.cost_usd), 0) as total_cost, COUNT(sc.session_id) as session_count
    FROM repos r
    LEFT JOIN jobs j ON j.repo_id = r.id
    LEFT JOIN sessions s ON s.job_id = j.id
    LEFT JOIN session_costs sc ON sc.session_id = s.id AND sc.created_at >= ?
    GROUP BY r.id
    ORDER BY total_cost DESC
  `);
  const costByMachineStmt = db.prepare(`
    SELECT m.display_name as machine_name, m.id as machine_id, COALESCE(SUM(sc.cost_usd), 0) as total_cost, COUNT(sc.session_id) as session_count
    FROM machines m
    LEFT JOIN sessions s ON s.machine_id = m.id
    LEFT JOIN session_costs sc ON sc.session_id = s.id AND sc.created_at >= ?
    GROUP BY m.id
    ORDER BY total_cost DESC
  `);
  const dailyCostStmt = db.prepare(`
    SELECT date(created_at, 'unixepoch') as day, SUM(cost_usd) as cost, SUM(input_tokens + output_tokens) as tokens
    FROM session_costs
    WHERE created_at >= ?
    GROUP BY day
    ORDER BY day
  `);
  const getBudgetConfigStmt = db.prepare("SELECT * FROM budget_config WHERE id = 'default'");
  const upsertBudgetConfigStmt = db.prepare(`
    INSERT INTO budget_config (id, per_session_max_usd, per_machine_daily_usd, global_daily_usd, enabled)
    VALUES ('default', ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      per_session_max_usd = excluded.per_session_max_usd,
      per_machine_daily_usd = excluded.per_machine_daily_usd,
      global_daily_usd = excluded.global_daily_usd,
      enabled = excluded.enabled
  `);

  // Cost summary
  app.get('/api/costs/summary', async () => {
    const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    const weekStart = todayStart - 7 * 86400;
    const monthStart = todayStart - 30 * 86400;

    const today = sumTodayCostsStmt.get(todayStart) as { total: number; tokens: number };
    const week = sumPeriodCostStmt.get(weekStart) as { total: number };
    const month = sumPeriodCostStmt.get(monthStart) as { total: number };

    return {
      today: { cost: today.total, tokens: today.tokens },
      week: { cost: week.total },
      month: { cost: month.total },
    };
  });

  // Cost by repo
  app.get('/api/costs/by-repo', async () => {
    const monthStart = Math.floor(Date.now() / 1000) - 30 * 86400;
    return costByRepoStmt.all(monthStart);
  });

  // Cost by machine
  app.get('/api/costs/by-machine', async () => {
    const monthStart = Math.floor(Date.now() / 1000) - 30 * 86400;
    return costByMachineStmt.all(monthStart);
  });

  // Daily cost timeline (last 30 days)
  app.get('/api/costs/daily', async () => {
    const monthStart = Math.floor(Date.now() / 1000) - 30 * 86400;
    return dailyCostStmt.all(monthStart);
  });

  // Budget config
  app.get('/api/costs/budget', async () => {
    const config = getBudgetConfigStmt.get();
    return config ?? { per_session_max_usd: null, per_machine_daily_usd: null, global_daily_usd: null, enabled: false };
  });

  const budgetBody = z.object({
    perSessionMaxUsd: z.number().nullable().optional(),
    perMachineDailyUsd: z.number().nullable().optional(),
    globalDailyUsd: z.number().nullable().optional(),
    enabled: z.boolean(),
  });

  app.put('/api/costs/budget', async (req) => {
    const body = budgetBody.parse(req.body);
    upsertBudgetConfigStmt.run(
      body.perSessionMaxUsd ?? null, body.perMachineDailyUsd ?? null,
      body.globalDailyUsd ?? null, body.enabled ? 1 : 0,
    );
    return { updated: true };
  });
}
