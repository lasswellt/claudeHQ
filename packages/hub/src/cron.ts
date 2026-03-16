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

  return checks.every(({ value, field }) => matchesField(field, value));
}

function matchesField(field: string, value: number): boolean {
  if (field === '*') return true;

  // */N — step (validate N > 0)
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    if (!step || step <= 0) return false; // Guard against */0 and NaN
    return value % step === 0;
  }

  // N-N — range
  if (field.includes('-')) {
    const [start, end] = field.split('-').map(Number);
    if (start === undefined || end === undefined || isNaN(start) || isNaN(end)) return false;
    return value >= start && value <= end;
  }

  // N,N,N — list
  if (field.includes(',')) {
    return field.split(',').map(Number).includes(value);
  }

  // Exact value
  const exact = parseInt(field, 10);
  if (isNaN(exact)) return false;
  return exact === value;
}

/**
 * Validates a cron expression has 5 fields with valid syntax.
 */
export function isValidCron(expression: string): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const fieldPattern = /^(\*|(\*\/[1-9]\d*)|(\d+(-\d+)?)(,\d+(-\d+)?)*)$/;
  return parts.every((p) => fieldPattern.test(p));
}

export function startCronRunner(
  db: Database.Database,
  logger: FastifyBaseLogger,
  onTrigger: (task: { id: string; prompt: string; cwd: string; machineId: string | null; repoId: string | null }) => void,
  intervalMs: number = 60000,
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const now = new Date();
    const nowEpoch = Math.floor(now.getTime() / 1000);
    const currentMinuteStart = nowEpoch - (nowEpoch % 60); // Round to minute boundary

    const tasks = db.prepare(
      'SELECT * FROM scheduled_tasks WHERE enabled = 1',
    ).all() as Record<string, unknown>[];

    for (const task of tasks) {
      const cronExpr = task.cron_expression as string;
      const concurrencyPolicy = task.concurrency_policy as string;
      const lastRunAt = (task.last_run_at as number | null) ?? 0;

      if (!matchesCron(cronExpr, now)) continue;

      // Prevent double-fire: skip if already ran in this minute
      const lastRunMinuteStart = lastRunAt - (lastRunAt % 60);
      if (lastRunMinuteStart >= currentMinuteStart) {
        continue; // Already fired this minute
      }

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
      db.prepare('UPDATE scheduled_tasks SET last_run_at = ? WHERE id = ?').run(nowEpoch, task.id);

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
  for (let i = 1; i <= 1440; i++) {
    const candidate = new Date(now.getTime() + i * 60000);
    if (matchesCron(cronExpression, candidate)) {
      return Math.floor(candidate.getTime() / 1000);
    }
  }
  return null;
}
