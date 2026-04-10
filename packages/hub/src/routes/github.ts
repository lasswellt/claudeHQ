import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import type { GitHubClient } from '../github/client.js';
import { createChecksLifecycle } from '../github/checks-lifecycle.js';


export async function githubRoutes(
  app: FastifyInstance,
  db: Database.Database,
  githubClient: GitHubClient,
  broadcastToDashboard: (msg: unknown) => void,
): Promise<void> {
  // Prepared statements — hoisted to plugin scope so they are compiled once at registration
  const listPrsStmt = db.prepare('SELECT * FROM pull_requests ORDER BY created_at DESC LIMIT 50');
  const getPrByIdStmt = db.prepare('SELECT * FROM pull_requests WHERE id = ?');
  const getJobByIdStmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
  const getRepoByIdStmt = db.prepare('SELECT * FROM repos WHERE id = ?');
  const insertPrStmt = db.prepare(`
    INSERT INTO pull_requests (id, job_id, repo_id, github_pr_number, github_pr_url, head_branch, base_branch, title, additions, deletions, changed_files)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateJobPrStmt = db.prepare('UPDATE jobs SET pr_number = ?, pr_url = ? WHERE id = ?');
  const setPrMergedStmt = db.prepare(
    "UPDATE pull_requests SET status = 'merged', updated_at = unixepoch() WHERE github_pr_number = ?",
  );
  const setPrClosedStmt = db.prepare(
    "UPDATE pull_requests SET status = 'closed', updated_at = unixepoch() WHERE github_pr_number = ?",
  );
  const updatePrCiStatusStmt = db.prepare(
    "UPDATE pull_requests SET ci_status = ?, updated_at = unixepoch() WHERE head_branch = ? AND status = 'open'",
  );
  const updatePrReviewStatusStmt = db.prepare(
    'UPDATE pull_requests SET review_status = ?, updated_at = unixepoch() WHERE github_pr_number = ?',
  );
  const updateJobIssueLinkStmt = db.prepare('UPDATE jobs SET github_issue_number = ? WHERE id = ?');
  const updateJobCheckRunStmt = db.prepare('UPDATE jobs SET check_run_id = ? WHERE id = ?');

  // ── Setup / Config ──────────────────────────────────────────

  // Get GitHub config status (no secrets exposed)
  app.get('/api/github/status', async () => {
    const config = githubClient.getSafeConfig();
    return {
      configured: githubClient.isConfigured,
      authMethod: config?.authMethod ?? 'none',
      hasApp: !!config?.appId,
      hasInstallation: !!config?.installationId,
    };
  });

  // Save GitHub App credentials (from manifest flow callback)
  const saveAppBody = z.object({
    appId: z.string(),
    privateKey: z.string(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    webhookSecret: z.string().optional(),
    slug: z.string().optional(),
  });

  app.post('/api/github/app', async (req) => {
    const body = saveAppBody.parse(req.body);
    githubClient.saveConfig({
      authMethod: 'github_app',
      appId: body.appId,
      privateKey: body.privateKey,
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      webhookSecret: body.webhookSecret,
      slug: body.slug,
    });
    return { saved: true };
  });

  // Save installation ID (after user installs the app)
  app.post('/api/github/installation', async (req) => {
    const { installationId } = z.object({ installationId: z.string() }).parse(req.body);
    const config = githubClient.getConfig();
    if (config) {
      githubClient.saveConfig({ ...config, installationId });
    }
    await githubClient.initialize();
    return { saved: true, configured: githubClient.isConfigured };
  });

  // Save PAT token (fallback auth)
  app.post('/api/github/pat', async (req) => {
    const { token } = z.object({ token: z.string() }).parse(req.body);
    githubClient.saveConfig({ authMethod: 'pat', patToken: token });
    await githubClient.initialize();
    return { saved: true, configured: githubClient.isConfigured };
  });

  // Test connection
  app.post('/api/github/test', async () => {
    const ok = await githubClient.initialize();
    return { connected: ok };
  });

  // Get manifest JSON for GitHub App creation flow
  // baseUrl is provided as a query param or falls back to a safe default.
  // Do NOT trust x-forwarded-proto/Host headers without trustProxy configured.
  app.get<{ Querystring: { baseUrl?: string } }>('/api/github/manifest', async (req) => {
    const baseUrl = req.query.baseUrl ?? `http://localhost:7700`;

    return {
      name: 'Claude HQ',
      url: baseUrl,
      hook_attributes: { url: `${baseUrl}/hooks/github`, active: true },
      redirect_url: `${baseUrl}/settings/github/wizard`,
      setup_url: `${baseUrl}/settings/github/wizard`,
      setup_on_update: true,
      public: false,
      default_permissions: {
        contents: 'write',
        pull_requests: 'write',
        issues: 'write',
        checks: 'write',
        actions: 'read',
        metadata: 'read',
      },
      default_events: ['pull_request', 'push', 'check_run', 'check_suite', 'issue_comment', 'installation'],
    };
  });

  // ── Pull Requests ───────────────────────────────────────────

  app.get('/api/prs', async () => {
    return listPrsStmt.all();
  });

  app.get<{ Params: { id: string } }>('/api/prs/:id', async (req, reply) => {
    const pr = getPrByIdStmt.get(req.params.id);
    if (!pr) return reply.code(404).send({ error: 'PR not found' });
    return pr;
  });

  // Create PR for a job
  app.post<{ Params: { jobId: string } }>('/api/jobs/:jobId/create-pr', async (req, reply) => {
    const job = getJobByIdStmt.get(req.params.jobId) as Record<string, unknown> | undefined;
    if (!job) return reply.code(404).send({ error: 'Job not found' });

    const repo = getRepoByIdStmt.get(job.repo_id as string) as Record<string, unknown> | undefined;
    if (!repo) return reply.code(404).send({ error: 'Repo not found' });

    if (!githubClient.isConfigured) {
      return reply.code(400).send({ error: 'GitHub not configured' });
    }

    const owner = repo.owner as string;
    const repoName = repo.name as string;
    const branch = job.branch_created as string ?? `chq/${job.id}`;
    const base = repo.default_branch as string ?? 'main';

    const prResult = await githubClient.createPullRequest({
      owner,
      repo: repoName,
      head: branch,
      base,
      title: job.title as string,
      body: [
        `## Claude HQ Job`,
        '',
        `**Prompt:** ${job.prompt as string}`,
        `**Machine:** ${job.machine_id as string}`,
        `**Cost:** $${((job.cost_usd as number) ?? 0).toFixed(2)}`,
        `**Files changed:** ${job.files_changed ?? 0}`,
        '',
        `_Created by [Claude HQ](${req.protocol}://${req.headers.host}/jobs/${job.id})_`,
      ].join('\n'),
      labels: ['ai-generated'],
    });

    if (!prResult) {
      return reply.code(500).send({ error: 'Failed to create PR' });
    }

    const prId = randomUUID();
    db.transaction(() => {
      insertPrStmt.run(prId, job.id, repo.id, prResult.number, prResult.url, branch, base, job.title, prResult.additions, prResult.deletions, prResult.changedFiles);
      updateJobPrStmt.run(prResult.number, prResult.url, job.id);
    })();

    // Start a GitHub Check Run so the job appears as an in-progress check
    // on the PR. We do this after the transaction so a GitHub API failure
    // never rolls back the PR record.
    const checksLifecycle = createChecksLifecycle(githubClient.asCheckRunClient());
    const headSha = await githubClient.getBranchSha(owner, repoName, branch);
    if (headSha) {
      const detailsUrl = `${req.protocol}://${req.headers.host}/jobs/${job.id as string}`;
      try {
        const { checkRunId } = await checksLifecycle.start({
          owner,
          repo: repoName,
          headSha,
          name: 'Claude HQ Agent',
          detailsUrl,
          externalId: job.id as string,
        });
        updateJobCheckRunStmt.run(checkRunId, job.id);
        app.log.info({ jobId: job.id, checkRunId }, 'Check run started for job PR');
      } catch (err) {
        // Log but don't fail the response — PR was already created
        app.log.error({ err, jobId: job.id }, 'Failed to start check run after PR creation');
      }
    } else {
      app.log.warn({ jobId: job.id, branch }, 'Could not resolve branch SHA — check run skipped');
    }

    return { id: prId, ...prResult };
  });

  // ── GitHub Webhooks ─────────────────────────────────────────

  app.post('/hooks/github', async (req, reply) => {
    const config = githubClient.getConfig();
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    // Reject immediately when no webhook secret is configured
    if (!config?.webhookSecret) {
      app.log.warn('GitHub webhook received but no webhook secret is configured');
      return reply.code(403).send({ error: 'Webhook secret not configured' });
    }

    if (!signature) {
      app.log.warn('GitHub webhook missing signature header');
      return reply.code(401).send({ error: 'Missing signature' });
    }

    const crypto = await import('node:crypto');
    const rawBody = (req as unknown as Record<string, unknown>).rawBody as Buffer | undefined;
    if (!rawBody) {
      app.log.warn('GitHub webhook missing raw body — cannot verify signature');
      return reply.code(400).send({ error: 'Unable to verify signature' });
    }
    const expected = 'sha256=' + crypto.createHmac('sha256', config.webhookSecret)
      .update(rawBody)
      .digest('hex');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      app.log.warn('GitHub webhook signature mismatch');
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    const event = req.headers['x-github-event'] as string;
    const payload = req.body as Record<string, unknown>;

    app.log.info({ event }, 'GitHub webhook received');

    switch (event) {
      case 'pull_request': {
        const action = payload.action as string;
        const pr = payload.pull_request as Record<string, unknown>;
        const prNumber = pr?.number as number;

        if (action === 'closed' && pr?.merged) {
          setPrMergedStmt.run(prNumber);
          broadcastToDashboard({ type: 'pr:updated', prNumber, status: 'merged' });
        } else if (action === 'closed') {
          setPrClosedStmt.run(prNumber);
          broadcastToDashboard({ type: 'pr:updated', prNumber, status: 'closed' });
        }
        break;
      }
      case 'check_run': {
        const checkRun = payload.check_run as Record<string, unknown>;
        const conclusion = checkRun?.conclusion as string;
        const headBranch = ((checkRun?.check_suite as Record<string, unknown>)?.head_branch as string) ?? null;

        if (conclusion && headBranch) {
          const ciStatus = conclusion === 'success' ? 'passing' : 'failing';
          // Only update PRs that match the specific branch this check ran on
          updatePrCiStatusStmt.run(ciStatus, headBranch);
          broadcastToDashboard({ type: 'pr:updated', headBranch, ciStatus });
        }
        break;
      }
      case 'pull_request_review': {
        const review = payload.review as Record<string, unknown>;
        const reviewState = review?.state as string;
        const prNumber = (payload.pull_request as Record<string, unknown>)?.number as number;

        const reviewStatus = reviewState === 'approved' ? 'approved' : reviewState === 'changes_requested' ? 'changes_requested' : 'reviewed';
        updatePrReviewStatusStmt.run(reviewStatus, prNumber);
        broadcastToDashboard({ type: 'pr:updated', prNumber, reviewStatus });
        break;
      }
    }

    return reply.code(200).send({ ok: true });
  });

  // ── Issue Linking ───────────────────────────────────────────

  app.post<{ Params: { jobId: string } }>('/api/jobs/:jobId/link-issue', async (req, reply) => {
    const { issueNumber } = z.object({ issueNumber: z.number() }).parse(req.body);
    const job = getJobByIdStmt.get(req.params.jobId) as Record<string, unknown> | undefined;
    if (!job) return reply.code(404).send({ error: 'Job not found' });

    const repo = getRepoByIdStmt.get(job.repo_id as string) as Record<string, unknown> | undefined;
    if (!repo) return reply.code(404).send({ error: 'Repo not found' });

    updateJobIssueLinkStmt.run(issueNumber, job.id);

    await githubClient.commentOnIssue(
      repo.owner as string,
      repo.name as string,
      issueNumber,
      `Claude HQ is working on this. Job: \`${job.id}\`, Machine: \`${job.machine_id}\``,
    );

    return { linked: true };
  });
}
