import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type Database from 'better-sqlite3';

export async function repoRoutes(app: FastifyInstance, db: Database.Database): Promise<void> {
  app.get('/api/repos', async () => {
    return db.prepare('SELECT * FROM repos ORDER BY name').all();
  });

  app.get<{ Params: { id: string } }>('/api/repos/:id', async (req, reply) => {
    const repo = db.prepare('SELECT * FROM repos WHERE id = ?').get(req.params.id);
    if (!repo) return reply.code(404).send({ error: 'Repo not found' });

    const jobs = db.prepare('SELECT * FROM jobs WHERE repo_id = ? ORDER BY created_at DESC LIMIT 10').all(req.params.id);
    const workspaces = db.prepare('SELECT * FROM workspaces WHERE repo_id = ? AND status != ?').all(req.params.id, 'deleted');

    return { ...(repo as Record<string, unknown>), jobs, workspaces };
  });

  const createBody = z.object({
    url: z.string().min(1),
    name: z.string().min(1),
    owner: z.string().optional(),
    default_branch: z.string().default('main'),
    auth_method: z.enum(['ssh_key', 'token', 'github_app']).default('ssh_key'),
    preferred_machine_id: z.string().optional(),
    dependency_manager: z.string().optional(),
    node_version: z.string().optional(),
    setup_commands: z.array(z.string()).optional(),
    pre_flight_commands: z.array(z.string()).optional(),
    post_flight_commands: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
  });

  app.post('/api/repos', async (req) => {
    const body = createBody.parse(req.body);
    const id = randomUUID();

    db.prepare(`
      INSERT INTO repos (id, url, name, owner, default_branch, auth_method,
        preferred_machine_id, dependency_manager, node_version,
        setup_commands, pre_flight_commands, post_flight_commands, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, body.url, body.name, body.owner ?? null, body.default_branch,
      body.auth_method, body.preferred_machine_id ?? null,
      body.dependency_manager ?? null, body.node_version ?? null,
      body.setup_commands ? JSON.stringify(body.setup_commands) : null,
      body.pre_flight_commands ? JSON.stringify(body.pre_flight_commands) : null,
      body.post_flight_commands ? JSON.stringify(body.post_flight_commands) : null,
      body.tags ? JSON.stringify(body.tags) : null,
    );

    return { id, ...body };
  });

  app.put<{ Params: { id: string } }>('/api/repos/:id', async (req, reply) => {
    const existing = db.prepare('SELECT id FROM repos WHERE id = ?').get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Repo not found' });

    const body = createBody.partial().parse(req.body);
    const sets: string[] = [];
    const params: unknown[] = [];

    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        sets.push(`${col} = ?`);
        params.push(Array.isArray(value) ? JSON.stringify(value) : value);
      }
    }

    if (sets.length > 0) {
      params.push(req.params.id);
      db.prepare(`UPDATE repos SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }

    return db.prepare('SELECT * FROM repos WHERE id = ?').get(req.params.id);
  });

  app.delete<{ Params: { id: string } }>('/api/repos/:id', async (req, reply) => {
    const result = db.prepare('DELETE FROM repos WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Repo not found' });
    return { deleted: true };
  });

  // Import from GitHub URL (auto-detect name/owner from URL)
  app.post('/api/repos/import', async (req) => {
    const { url } = z.object({ url: z.string().url() }).parse(req.body);

    // Parse GitHub URL: https://github.com/owner/repo or git@github.com:owner/repo.git
    const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
    const sshMatch = url.match(/github\.com:([^/]+)\/([^/.]+)/);
    const match = httpsMatch ?? sshMatch;

    const owner = match?.[1] ?? undefined;
    const name = match?.[2] ?? url.split('/').pop()?.replace('.git', '') ?? 'unknown';

    const id = randomUUID();
    db.prepare(`
      INSERT INTO repos (id, url, name, owner, default_branch, auth_method)
      VALUES (?, ?, ?, ?, 'main', 'ssh_key')
    `).run(id, url, name, owner ?? null);

    return db.prepare('SELECT * FROM repos WHERE id = ?').get(id);
  });
}
