import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import type { AgentHandler } from '../ws/agent-handler.js';
import type { GitHubClient } from '../github/client.js';
import { createChecksLifecycle, jobStatusToConclusion } from '../github/checks-lifecycle.js';
import {
  planBatch,
  cancelBatch,
  batchStatus,
  isBatchError,
} from '../workforce/batch-planner.js';

export async function jobRoutes(
  app: FastifyInstance,
  db: Database.Database,
  agentHandler: AgentHandler,
  githubClient: GitHubClient,
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
  const updateJobStatusEndedStmt = db.prepare(
    'UPDATE jobs SET status = ?, ended_at = unixepoch() WHERE id = ?',
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

    // Send hub:container:create so the agent clones the repo, prepares a worktree,
    // and runs Claude Code in a sandboxed container.  Fall back to a plain PTY
    // session only if the repo has no URL (shouldn't happen given the FK, but
    // guards against unexpected schema drift).
    const repoUrl = (repo.url as string | undefined) ?? '';
    if (repoUrl) {
      const setupCommands = repo.setup_commands
        ? (JSON.parse(repo.setup_commands as string) as string[])
        : [];
      const preFlightCommands = repo.pre_flight_commands
        ? (JSON.parse(repo.pre_flight_commands as string) as string[])
        : [];
      const repoEnvVars = repo.env_vars
        ? (JSON.parse(repo.env_vars as string) as Record<string, string>)
        : {};

      agentHandler.sendToAgent(machineId, {
        type: 'hub:container:create',
        jobId: id,
        repoId: body.repoId,
        repoUrl,
        branch: body.branch ?? (repo.default_branch as string | undefined) ?? 'main',
        prompt: body.prompt,
        setupCommands,
        preFlightCommands,
        env: repoEnvVars,
      });
    } else {
      // Legacy PTY path — no repo URL available
      agentHandler.sendToAgent(machineId, {
        type: 'hub:session:start',
        sessionId: id,
        prompt: body.prompt,
        cwd: `/workspaces/${id}`,
        flags: [],
      });
    }

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

  // CAP-062 / story 016-007: Update job status to a terminal state and finish
  // the associated GitHub Check Run so it appears on the PR.
  const terminalStatuses = new Set(['completed', 'failed', 'cancelled', 'timed_out']);
  const updateStatusBody = z.object({
    status: z.enum(['completed', 'failed', 'cancelled', 'timed_out']),
    summary: z.string().optional(),
  });

  app.patch<{ Params: { id: string } }>('/api/jobs/:id/status', async (req, reply) => {
    const body = updateStatusBody.parse(req.body);
    const job = getJobStmt.get(req.params.id) as Record<string, unknown> | undefined;
    if (!job) return reply.code(404).send({ error: 'Job not found' });

    const currentStatus = job.status as string;
    if (terminalStatuses.has(currentStatus)) {
      return reply.code(400).send({
        error: `Job is already in terminal status '${currentStatus}'`,
      });
    }

    updateJobStatusEndedStmt.run(body.status, req.params.id);
    app.log.info({ jobId: req.params.id, status: body.status }, 'Job status updated');

    // Finish the GitHub Check Run if one was recorded for this job
    const checkRunId = job.check_run_id as number | null;
    if (checkRunId && githubClient.isConfigured) {
      const repo = getRepoByIdStmt.get(job.repo_id as string) as Record<string, unknown> | undefined;
      if (repo) {
        const checksLifecycle = createChecksLifecycle(githubClient.asCheckRunClient());
        const conclusion = jobStatusToConclusion(body.status);
        const summary = body.summary ?? `Job ${body.status} with conclusion: ${conclusion}`;
        try {
          await checksLifecycle.finish({
            checkRunId,
            owner: repo.owner as string,
            repo: repo.name as string,
            conclusion,
            summary,
            title: `Claude HQ: ${job.title as string}`,
          });
          app.log.info({ jobId: req.params.id, checkRunId, conclusion }, 'Check run finished');
        } catch (err) {
          // Log but don't fail the status update response
          app.log.error({ err, jobId: req.params.id, checkRunId }, 'Failed to finish check run');
        }
      }
    }

    return getJobStmt.get(req.params.id);
  });

  // CAP-055 / story 016-004: batch jobs (planner-backed).
  const batchBody = z.object({
    repoIds: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    prompt: z.string().min(1),
    branchPrefix: z.string().optional(),
    maxConcurrency: z.number().int().min(1).max(10).optional(),
    autoPr: z.boolean().default(false),
    maxCostUsd: z.number().nonnegative().optional(),
    timeoutSeconds: z.number().int().positive().optional(),
  });

  app.post('/api/jobs/batch', async (req, reply) => {
    const parsed = batchBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid batch payload', detail: parsed.error.issues });
    }

    const result = planBatch(db, parsed.data);
    if (isBatchError(result)) {
      const statusCode = result.error === 'no_repos_matched' ? 404 : 400;
      return reply.code(statusCode).send(result);
    }

    return reply.code(201).send(result);
  });

  // CAP-055 / story 016-006: batch detail page backend.
  app.get<{ Params: { id: string } }>('/api/jobs/batch/:id', async (req, reply) => {
    const summary = batchStatus(db, req.params.id);
    if (summary.total === 0) {
      return reply.code(404).send({ error: 'Batch not found' });
    }
    const jobs = db
      .prepare(
        'SELECT id, repo_id, title, status, branch, pr_url, cost_usd, started_at, ended_at FROM jobs WHERE batch_id = ? ORDER BY title',
      )
      .all(req.params.id) as Array<Record<string, unknown>>;
    return { ...summary, jobs };
  });

  // Cancel the entire batch — cascades to every non-terminal child job.
  app.delete<{ Params: { id: string } }>('/api/jobs/batch/:id', async (req, reply) => {
    const summary = batchStatus(db, req.params.id);
    if (summary.total === 0) {
      return reply.code(404).send({ error: 'Batch not found' });
    }
    return cancelBatch(db, req.params.id);
  });
}
