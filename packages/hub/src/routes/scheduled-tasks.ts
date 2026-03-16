import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { calculateNextRun } from '../cron.js';

export async function scheduledTaskRoutes(app: FastifyInstance, db: Database.Database): Promise<void> {
  app.get('/api/scheduled-tasks', async () => {
    return db.prepare('SELECT * FROM scheduled_tasks ORDER BY name').all();
  });

  app.get<{ Params: { id: string } }>('/api/scheduled-tasks/:id', async (req, reply) => {
    const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(req.params.id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    return task;
  });

  const createBody = z.object({
    name: z.string().min(1),
    cronExpression: z.string().min(1),
    prompt: z.string().min(1),
    cwd: z.string().min(1),
    machineId: z.string().optional(),
    repoId: z.string().optional(),
    concurrencyPolicy: z.enum(['allow', 'forbid', 'replace']).default('forbid'),
  });

  app.post('/api/scheduled-tasks', async (req) => {
    const body = createBody.parse(req.body);
    const id = randomUUID();
    const nextRun = calculateNextRun(body.cronExpression);

    db.prepare(`
      INSERT INTO scheduled_tasks (id, name, cron_expression, prompt, cwd, machine_id, repo_id, concurrency_policy, next_run_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, body.name, body.cronExpression, body.prompt, body.cwd, body.machineId ?? null, body.repoId ?? null, body.concurrencyPolicy, nextRun);

    return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id);
  });

  app.patch<{ Params: { id: string } }>('/api/scheduled-tasks/:id', async (req, reply) => {
    const existing = db.prepare('SELECT id FROM scheduled_tasks WHERE id = ?').get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Task not found' });

    const body = z.object({ enabled: z.boolean().optional(), cronExpression: z.string().optional() }).parse(req.body);

    if (body.enabled !== undefined) {
      db.prepare('UPDATE scheduled_tasks SET enabled = ? WHERE id = ?').run(body.enabled ? 1 : 0, req.params.id);
    }
    if (body.cronExpression) {
      const nextRun = calculateNextRun(body.cronExpression);
      db.prepare('UPDATE scheduled_tasks SET cron_expression = ?, next_run_at = ? WHERE id = ?').run(body.cronExpression, nextRun, req.params.id);
    }

    return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(req.params.id);
  });

  app.delete<{ Params: { id: string } }>('/api/scheduled-tasks/:id', async (req, reply) => {
    const result = db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Task not found' });
    return { deleted: true };
  });
}
