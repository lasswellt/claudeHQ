import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type Database from 'better-sqlite3';

export async function templateRoutes(app: FastifyInstance, db: Database.Database): Promise<void> {
  // List templates
  app.get('/api/templates', async () => {
    return db.prepare('SELECT * FROM templates ORDER BY name').all();
  });

  // Get template
  app.get<{ Params: { id: string } }>('/api/templates/:id', async (req, reply) => {
    const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
    if (!row) return reply.code(404).send({ error: 'Template not found' });
    return row;
  });

  // Create template
  const createBody = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    icon: z.string().optional(),
    prompt: z.string().min(1),
    cwd: z.string().optional(),
    flags: z.array(z.string()).optional(),
    machine_id: z.string().optional(),
    timeout_seconds: z.number().optional(),
    max_cost_usd: z.number().optional(),
    variables: z.array(z.object({
      name: z.string(),
      label: z.string(),
      description: z.string().optional(),
      default: z.string().optional(),
      type: z.enum(['text', 'number', 'select']).optional(),
      options: z.array(z.string()).optional(),
    })).optional(),
    tags: z.array(z.string()).optional(),
  });

  app.post('/api/templates', async (req) => {
    const body = createBody.parse(req.body);
    const id = randomUUID();

    db.prepare(`
      INSERT INTO templates (id, name, description, icon, prompt, cwd, flags, machine_id,
        timeout_seconds, max_cost_usd, variables, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      body.name,
      body.description ?? null,
      body.icon ?? null,
      body.prompt,
      body.cwd ?? null,
      body.flags ? JSON.stringify(body.flags) : null,
      body.machine_id ?? null,
      body.timeout_seconds ?? null,
      body.max_cost_usd ?? null,
      body.variables ? JSON.stringify(body.variables) : null,
      body.tags ? JSON.stringify(body.tags) : null,
    );

    return { id, ...body };
  });

  // Delete template
  app.delete<{ Params: { id: string } }>('/api/templates/:id', async (req, reply) => {
    const result = db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Template not found' });
    return { deleted: true };
  });

  // Launch session from template
  app.post<{ Params: { id: string } }>('/api/templates/:id/launch', async (req, reply) => {
    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!template) return reply.code(404).send({ error: 'Template not found' });

    const variables = req.body as Record<string, string> | undefined;
    let prompt = template.prompt as string;

    // Substitute variables
    if (variables) {
      for (const [key, value] of Object.entries(variables)) {
        prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }
    }

    // Return the resolved session params (caller creates the session)
    return {
      prompt,
      cwd: template.cwd ?? undefined,
      flags: template.flags ? JSON.parse(template.flags as string) : undefined,
      machineId: template.machine_id ?? undefined,
      timeoutSeconds: template.timeout_seconds ?? undefined,
      maxCostUsd: template.max_cost_usd ?? undefined,
    };
  });
}
