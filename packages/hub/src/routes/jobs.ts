import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import type { AgentHandler } from '../ws/agent-handler.js';

export async function jobRoutes(
  app: FastifyInstance,
  db: Database.Database,
  agentHandler: AgentHandler,
): Promise<void> {
  const insertJobStmt = db.prepare(`
    INSERT INTO jobs (id, repo_id, machine_id, title, prompt, branch, status,
      timeout_seconds, max_cost_usd, auto_pr, auto_cleanup, tags)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
  `);

  const getJobStmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
  const updateJobStatusStmt = db.prepare('UPDATE jobs SET status = ? WHERE id = ?');
  const getSessionsByJobStmt = db.prepare('SELECT * FROM sessions WHERE job_id = ?');
  const getWorkspaceByIdStmt = db.prepare('SELECT * FROM workspaces WHERE id = ?');
  const getRepoByIdStmt = db.prepare('SELECT * FROM repos WHERE id = ?');
  const insertWorkspaceStmt = db.prepare(`
    INSERT INTO workspaces (id, repo_id, machine_id, path, branch, status, job_id)
    VALUES (?, ?, ?, ?, ?, 'creating', ?)
  `);
  const updateJobWorkspaceStmt = db.prepare('UPDATE jobs SET workspace_id = ? WHERE id = ?');
  const getRunningSessionsByJobStmt = db.prepare(
    "SELECT id FROM sessions WHERE job_id = ? AND status = 'running'",
  );

  // List jobs
  app.get<{ Querystring: { repoId?: string; status?: string } }>('/api/jobs', async (req) => {
    let sql = 'SELECT * FROM jobs WHERE 1=1';
    const params: unknown[] = [];
    if (req.query.repoId) { sql += ' AND repo_id = ?'; params.push(req.query.repoId); }
    if (req.query.status) { sql += ' AND status = ?'; params.push(req.query.status); }
    sql += ' ORDER BY created_at DESC LIMIT 100';
    return db.prepare(sql).all(...params);
  });

  // Get job detail
  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (req, reply) => {
    const job = getJobStmt.get(req.params.id) as Record<string, unknown> | undefined;
    if (!job) return reply.code(404).send({ error: 'Job not found' });

    const sessions = getSessionsByJobStmt.all(req.params.id);
    const workspace = job.workspace_id
      ? getWorkspaceByIdStmt.get(job.workspace_id as string)
      : null;

    return { ...job, sessions, workspace };
  });

  // Create job
  const createBody = z.object({
    repoId: z.string(),
    title: z.string().min(1),
    prompt: z.string().min(1),
    machineId: z.string().optional(),
    branch: z.string().optional(),
    timeoutSeconds: z.number().optional(),
    maxCostUsd: z.number().optional(),
    autoPr: z.boolean().default(false),
    autoCleanup: z.boolean().default(false),
    tags: z.array(z.string()).optional(),
  });

  app.post('/api/jobs', async (req, reply) => {
    const body = createBody.parse(req.body);

    // Verify repo exists
    const repo = getRepoByIdStmt.get(body.repoId) as Record<string, unknown> | undefined;
    if (!repo) return reply.code(404).send({ error: 'Repo not found' });

    // Select machine
    const machineId = body.machineId ?? (repo.preferred_machine_id as string | null);
    if (!machineId) {
      return reply.code(400).send({ error: 'No machine specified and repo has no preferred machine' });
    }

    const id = randomUUID();
    const workspaceId = randomUUID();

    // Wrap all DB mutations in a transaction — agent command sent only after commit
    db.transaction(() => {
      insertJobStmt.run(
        id, body.repoId, machineId, body.title, body.prompt,
        body.branch ?? null, body.timeoutSeconds ?? null,
        body.maxCostUsd ?? null, body.autoPr ? 1 : 0,
        body.autoCleanup ? 1 : 0,
        body.tags ? JSON.stringify(body.tags) : null,
      );

      // Start the job orchestration: provision workspace → prepare → spawn session
      updateJobStatusStmt.run('provisioning', id);

      // Create workspace
      insertWorkspaceStmt.run(workspaceId, body.repoId, machineId, `/workspaces/${id}`, body.branch ?? 'main', id);

      updateJobWorkspaceStmt.run(workspaceId, id);
    })();

    // Send workspace provision command to agent after transaction commits
    agentHandler.sendToAgent(machineId, {
      type: 'hub:session:start' as const,
      sessionId: id,
      prompt: body.prompt,
      cwd: `/workspaces/${id}`,
      flags: [],
    });

    app.log.info({ jobId: id, repoId: body.repoId, machineId }, 'Job created');

    return reply.code(201).send(getJobStmt.get(id));
  });

  // Cancel job — also signals agent to stop running container/session
  app.post<{ Params: { id: string } }>('/api/jobs/:id/cancel', async (req, reply) => {
    const job = getJobStmt.get(req.params.id) as Record<string, unknown> | undefined;
    if (!job) return reply.code(404).send({ error: 'Job not found' });

    updateJobStatusStmt.run('cancelled', req.params.id);

    // Signal agent to kill any running session for this job
    const machineId = job.machine_id as string | null;
    if (machineId) {
      // Find running sessions for this job
      const sessions = getRunningSessionsByJobStmt.all(req.params.id) as Array<{ id: string }>;

      for (const session of sessions) {
        agentHandler.sendToAgent(machineId, {
          type: 'hub:session:kill',
          sessionId: session.id,
        });
      }
    }

    return { cancelled: true };
  });

  // Retry job
  app.post<{ Params: { id: string } }>('/api/jobs/:id/retry', async (req, reply) => {
    const job = getJobStmt.get(req.params.id) as Record<string, unknown> | undefined;
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    updateJobStatusStmt.run('pending', req.params.id);
    return { retried: true };
  });

  // Batch jobs
  const batchBody = z.object({
    repoIds: z.array(z.string()),
    prompt: z.string().min(1),
    autoPr: z.boolean().default(false),
    tags: z.array(z.string()).optional(),
  });

  app.post('/api/jobs/batch', async (req) => {
    const body = batchBody.parse(req.body);
    const created: string[] = [];

    // Use transaction for atomicity — all jobs created or none
    const batchInsert = db.transaction(() => {
      for (const repoId of body.repoIds) {
        const repo = getRepoByIdStmt.get(repoId) as Record<string, unknown> | undefined;
        if (!repo) continue;

        const id = randomUUID();
        const machineId = repo.preferred_machine_id as string | null;
        if (!machineId) continue;

        insertJobStmt.run(
          id, repoId, machineId, body.prompt.slice(0, 100), body.prompt,
          null, null, null, body.autoPr ? 1 : 0, 0,
          body.tags ? JSON.stringify(body.tags) : null,
        );
        created.push(id);
      }
    });
    batchInsert();

    return { created, total: created.length };
  });
}
