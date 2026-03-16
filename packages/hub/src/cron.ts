import type Database from 'better-sqlite3';
import type { FastifyBaseLogger } from 'fastify';

// Simple cron expression parser for: minute hour day-of-month month day-of-week
// Supports: *, */N, N, N-N, N,N,N
function matchesCron(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const checks = [
    { value: date.getMinutes(), field: parts[0]!, max: 59 },
    { value: date.getHours(), field: parts[1]!, max: 23 },
    { value: date.getDate(), field: parts[2]!, max: 31 },
    { value: date.getMonth() + 1, field: parts[3]!, max: 12 },
    { value: date.getDay(), field: parts[4]!, max: 7 },
  ];

  return checks.every(({ value, field, max }) => matchesField(field, value, max));
}

function matchesField(field: string, value: number, max: number): boolean {
  if (field === '*') return true;

  // */N — step
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    return value % step === 0;
  }

  // N-N — range
  if (field.includes('-')) {
    const [start, end] = field.split('-').map(Number);
    return value >= (start ?? 0) && value <= (end ?? max);
  }

  // N,N,N — list
  if (field.includes(',')) {
    return field.split(',').map(Number).includes(value);
  }

  // Exact value
  return parseInt(field, 10) === value;
}

export function startCronRunner(
  db: Database.Database,
  logger: FastifyBaseLogger,
  onTrigger: (task: { id: string; prompt: string; cwd: string; machineId: string | null; repoId: string | null }) => void,
  intervalMs: number = 60000,
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const now = new Date();
    const tasks = db.prepare(
      'SELECT * FROM scheduled_tasks WHERE enabled = 1',
    ).all() as Record<string, unknown>[];

    for (const task of tasks) {
      const cronExpr = task.cron_expression as string;
      const concurrencyPolicy = task.concurrency_policy as string;

      if (!matchesCron(cronExpr, now)) continue;

      // Check concurrency
      if (concurrencyPolicy === 'forbid') {
        const running = db.prepare(
          "SELECT COUNT(*) as c FROM sessions WHERE job_id IN (SELECT id FROM jobs WHERE repo_id = ?) AND status = 'running'",
        ).get(task.repo_id ?? '') as { c: number };
        if (running.c > 0) {
          logger.debug({ taskId: task.id, name: task.name }, 'Skipping: concurrent run in progress');
          continue;
        }
      }

      // Update last_run_at
      db.prepare('UPDATE scheduled_tasks SET last_run_at = ? WHERE id = ?').run(
        Math.floor(now.getTime() / 1000),
        task.id,
      );

      logger.info({ taskId: task.id, name: task.name }, 'Cron task triggered');

      onTrigger({
        id: task.id as string,
        prompt: task.prompt as string,
        cwd: task.cwd as string,
        machineId: task.machine_id as string | null,
        repoId: task.repo_id as string | null,
      });
    }
  }, intervalMs);
}

export function calculateNextRun(cronExpression: string): number | null {
  const now = new Date();
  // Simple: check the next 1440 minutes (24h)
  for (let i = 1; i <= 1440; i++) {
    const candidate = new Date(now.getTime() + i * 60000);
    if (matchesCron(cronExpression, candidate)) {
      return Math.floor(candidate.getTime() / 1000);
    }
  }
  return null;
}
