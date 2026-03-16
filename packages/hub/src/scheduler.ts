import type Database from 'better-sqlite3';

// Prepared statements are cached per Database instance so they are compiled once
// rather than on every call to selectMachine / checkBudget.
interface SchedulerStmts {
  getOnlineMachines: Database.Statement;
  countRunningSessions: Database.Statement;
  countQueueDepth: Database.Statement;
  getBudgetConfig: Database.Statement;
  sumGlobalDailySpend: Database.Statement;
  sumMachineDailySpend: Database.Statement;
}

const stmtCache = new WeakMap<Database.Database, SchedulerStmts>();

function getStmts(db: Database.Database): SchedulerStmts {
  const cached = stmtCache.get(db);
  if (cached) return cached;

  const stmts: SchedulerStmts = {
    getOnlineMachines: db.prepare("SELECT * FROM machines WHERE status = 'online'"),
    countRunningSessions: db.prepare(
      "SELECT COUNT(*) as c FROM sessions WHERE machine_id = ? AND status = 'running'",
    ),
    countQueueDepth: db.prepare('SELECT COUNT(*) as c FROM queue WHERE machine_id = ?'),
    getBudgetConfig: db.prepare("SELECT * FROM budget_config WHERE id = 'default'"),
    sumGlobalDailySpend: db.prepare(
      'SELECT COALESCE(SUM(cost_usd), 0) as total FROM session_costs WHERE created_at >= ?',
    ),
    sumMachineDailySpend: db.prepare(
      'SELECT COALESCE(SUM(sc.cost_usd), 0) as total FROM session_costs sc JOIN sessions s ON sc.session_id = s.id WHERE s.machine_id = ? AND sc.created_at >= ?',
    ),
  };
  stmtCache.set(db, stmts);
  return stmts;
}

export interface MachineScore {
  machineId: string;
  score: number;
  freeSlots: number;
  cpuPercent: number;
  memPercent: number;
  queueDepth: number;
}

export function selectMachine(
  db: Database.Database,
  requirements?: string[],
): MachineScore | null {
  const stmts = getStmts(db);
  const machines = stmts.getOnlineMachines.all() as Record<string, unknown>[];

  if (machines.length === 0) return null;

  const scores: MachineScore[] = [];

  for (const m of machines) {
    const machineId = m.id as string;
    const maxSessions = m.max_sessions as number;
    let capabilities: string[] = [];
    try { capabilities = m.capabilities ? (JSON.parse(m.capabilities as string) as string[]) : []; } catch { /* malformed JSON */ }

    // Check capability requirements
    if (requirements?.length) {
      const met = requirements.every((r) => capabilities.includes(r));
      if (!met) continue;
    }

    // Count active sessions
    const active = stmts.countRunningSessions.get(machineId) as { c: number };
    const freeSlots = maxSessions - active.c;

    if (freeSlots <= 0) continue;

    // Get latest health data
    let meta: Record<string, unknown> = {};
    try { meta = m.meta ? (JSON.parse(m.meta as string) as Record<string, unknown>) : {}; } catch { /* malformed JSON */ }
    const cpuPercent = (meta.cpuPercent as number) ?? 50;
    const memPercent = (meta.memPercent as number) ?? 50;

    // Queue depth
    const queueDepth = (stmts.countQueueDepth.get(machineId) as { c: number }).c;

    // Score: higher = better
    const score = freeSlots * 10 + (100 - cpuPercent) + (100 - memPercent) - queueDepth * 5;

    scores.push({ machineId, score, freeSlots, cpuPercent, memPercent, queueDepth });
  }

  if (scores.length === 0) return null;

  // Pick highest score
  scores.sort((a, b) => b.score - a.score);
  return scores[0]!;
}

export function checkBudget(
  db: Database.Database,
  machineId?: string,
): { allowed: boolean; reason?: string; dailySpent: number; globalDailySpent: number } {
  const stmts = getStmts(db);
  const config = stmts.getBudgetConfig.get() as Record<string, unknown> | undefined;

  if (!config || !(config.enabled as number)) {
    return { allowed: true, dailySpent: 0, globalDailySpent: 0 };
  }

  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

  // Global daily spend
  const globalSpent = stmts.sumGlobalDailySpend.get(todayStart) as { total: number };

  const globalDailyMax = config.global_daily_usd as number | null;
  if (globalDailyMax && globalSpent.total >= globalDailyMax) {
    return { allowed: false, reason: 'Global daily budget exceeded', dailySpent: 0, globalDailySpent: globalSpent.total };
  }

  // Per-machine daily spend
  let machineSpent = 0;
  if (machineId) {
    const result = stmts.sumMachineDailySpend.get(machineId, todayStart) as { total: number };
    machineSpent = result.total;

    const machineDailyMax = config.per_machine_daily_usd as number | null;
    if (machineDailyMax && machineSpent >= machineDailyMax) {
      return { allowed: false, reason: `Machine daily budget exceeded ($${machineSpent.toFixed(2)})`, dailySpent: machineSpent, globalDailySpent: globalSpent.total };
    }
  }

  return { allowed: true, dailySpent: machineSpent, globalDailySpent: globalSpent.total };
}
