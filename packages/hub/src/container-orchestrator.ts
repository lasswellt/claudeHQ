import Docker from 'dockerode';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type pino from 'pino';
import type { HubConfig } from '@chq/shared';
import type { SpawnedAgentRecord } from '@chq/shared';

interface SpawnOptions {
  repoUrl: string;
  repoId?: string;
  branch?: string;
  displayName?: string;
}

type ActiveStatus = 'creating' | 'starting' | 'running' | 'stopping';
const ACTIVE_STATUSES: ActiveStatus[] = ['creating', 'starting', 'running', 'stopping'];

const execOpts = { encoding: 'utf-8' as const, timeout: 300000 };

function sanitizeRepoName(repoUrl: string): string {
  // Turn a URL like https://github.com/org/repo.git into org-repo
  return repoUrl
    .replace(/\.git$/, '')
    .replace(/.*[/:]/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 64);
}

function rowToRecord(row: Record<string, unknown>): SpawnedAgentRecord {
  return {
    id: row.id as string,
    container_id: (row.container_id as string | null) ?? undefined,
    repo_id: (row.repo_id as string | null) ?? undefined,
    repo_url: row.repo_url as string,
    branch: (row.branch as string) ?? 'main',
    worktree_path: (row.worktree_path as string | null) ?? undefined,
    status: row.status as SpawnedAgentRecord['status'],
    error_message: (row.error_message as string | null) ?? undefined,
    created_at: row.created_at as number,
    started_at: (row.started_at as number | null) ?? undefined,
    stopped_at: (row.stopped_at as number | null) ?? undefined,
  };
}

export class ContainerOrchestrator {
  private readonly docker: Docker;
  private readonly db: Database.Database;
  private readonly config: HubConfig;
  private readonly logger: pino.Logger;
  private dashboardBroadcast: ((msg: unknown) => void) | null = null;

  // Dedup in-flight bare clones: repoUrl → Promise<bareRepoPath>
  private readonly cloneInFlight = new Map<string, Promise<string>>();

  // Prepared statements
  private readonly stmtInsert: Database.Statement;
  private readonly stmtUpdateStatus: Database.Statement;
  private readonly stmtUpdateStarted: Database.Statement;
  private readonly stmtUpdateStopped: Database.Statement;
  private readonly stmtUpdateContainerId: Database.Statement;
  private readonly stmtUpdateWorktree: Database.Statement;
  private readonly stmtSetError: Database.Statement;
  private readonly stmtGet: Database.Statement;
  private readonly stmtList: Database.Statement;
  private readonly stmtListByStatus: Database.Statement;

  constructor(db: Database.Database, config: HubConfig, logger: pino.Logger) {
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.docker = new Docker({ socketPath: config.dockerSocketPath });

    this.stmtInsert = db.prepare(
      `INSERT INTO spawned_agents (id, repo_id, repo_url, branch, status, created_at)
       VALUES (?, ?, ?, ?, 'creating', unixepoch())`,
    );
    this.stmtUpdateStatus = db.prepare(
      `UPDATE spawned_agents SET status = ? WHERE id = ?`,
    );
    this.stmtUpdateStarted = db.prepare(
      `UPDATE spawned_agents SET status = 'running', started_at = unixepoch() WHERE id = ?`,
    );
    this.stmtUpdateStopped = db.prepare(
      `UPDATE spawned_agents SET status = 'stopped', stopped_at = unixepoch() WHERE id = ?`,
    );
    this.stmtUpdateContainerId = db.prepare(
      `UPDATE spawned_agents SET container_id = ? WHERE id = ?`,
    );
    this.stmtUpdateWorktree = db.prepare(
      `UPDATE spawned_agents SET worktree_path = ? WHERE id = ?`,
    );
    this.stmtSetError = db.prepare(
      `UPDATE spawned_agents SET status = 'error', error_message = ? WHERE id = ?`,
    );
    this.stmtGet = db.prepare(
      `SELECT * FROM spawned_agents WHERE id = ?`,
    );
    this.stmtList = db.prepare(
      `SELECT * FROM spawned_agents ORDER BY created_at DESC`,
    );
    this.stmtListByStatus = db.prepare(
      `SELECT * FROM spawned_agents WHERE status = ? ORDER BY created_at DESC`,
    );
  }

  setDashboardBroadcast(fn: (msg: unknown) => void): void {
    this.dashboardBroadcast = fn;
  }

  async initialize(): Promise<void> {
    await this.reconcile();
    // Best-effort pre-pull of agent image — don't block startup on failure
    this.prePullImage(this.config.agentImage).catch((err: unknown) => {
      this.logger.warn({ err, image: this.config.agentImage }, 'Failed to pre-pull agent image');
    });
  }

  async spawn(opts: SpawnOptions): Promise<SpawnedAgentRecord> {
    // Enforce max container limit before spawning
    const activeCount = this.list()
      .filter((a) => ACTIVE_STATUSES.includes(a.status as ActiveStatus)).length;
    if (activeCount >= this.config.agentMaxContainers) {
      throw new Error(
        `Agent container limit reached (${activeCount}/${this.config.agentMaxContainers}). Stop or remove existing agents first.`,
      );
    }

    const id = randomUUID();
    const branch = opts.branch ?? 'main';

    this.stmtInsert.run(id, opts.repoId ?? null, opts.repoUrl, branch);

    let record = this.getRecord(id);

    try {
      // Ensure bare clone (deduplicated across concurrent spawns for same repo)
      const bareRepoPath = await this.ensureBareClone(opts.repoUrl);

      // Create worktree for this agent
      const worktreePath = path.join(this.config.reposPath, 'worktrees', id);
      this.createWorktree(bareRepoPath, worktreePath, branch);
      this.stmtUpdateWorktree.run(worktreePath, id);

      // Build env array
      const agentToken = process.env.CHQ_AGENT_TOKEN ?? '';
      const anthropicKey = process.env.ANTHROPIC_API_KEY ?? '';
      const hubUrl = `ws://hub:${this.config.port}/ws/agent`;

      const env: string[] = [
        `CHQ_AGENT_MACHINE_ID=${id}`,
        `CHQ_AGENT_HUB_URL=${hubUrl}`,
        `CHQ_AGENT_DEFAULT_CWD=/workspace`,
        `ANTHROPIC_API_KEY=${anthropicKey}`,
      ];
      if (agentToken) env.push(`CHQ_AGENT_TOKEN=${agentToken}`);

      // Build bind mounts
      const binds: string[] = [`${worktreePath}:/workspace:rw`];
      if (this.config.claudeBinaryHostPath) {
        binds.push(`${this.config.claudeBinaryHostPath}:/usr/local/bin/claude:ro`);
      }

      const container = await this.docker.createContainer({
        Image: this.config.agentImage,
        Env: env,
        WorkingDir: '/workspace',
        HostConfig: {
          Binds: binds,
          Memory: this.config.agentDefaultMemoryMb * 1024 * 1024,
          MemorySwap: this.config.agentDefaultMemoryMb * 1024 * 1024,
          PidsLimit: 256,
          NetworkMode: this.config.agentNetworkName,
          SecurityOpt: ['no-new-privileges'],
          CapDrop: ['ALL'],
        },
      });

      this.stmtUpdateContainerId.run(container.id, id);
      this.stmtUpdateStatus.run('starting', id);

      await container.start();
      this.logger.info({ id, containerId: container.id }, 'Spawned agent container started');

      record = this.getRecord(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.stmtSetError.run(message, id);
      this.logger.error({ id, err }, 'Failed to spawn agent container');
      record = this.getRecord(id);
    }

    return record;
  }

  async stop(id: string): Promise<void> {
    const record = this.stmtGet.get(id) as Record<string, unknown> | undefined;
    if (!record) throw new Error(`Spawned agent ${id} not found`);

    this.stmtUpdateStatus.run('stopping', id);

    if (record.container_id) {
      try {
        const container = this.docker.getContainer(record.container_id as string);
        await container.stop({ t: 10 });
      } catch (err) {
        this.logger.warn({ id, err }, 'Container stop error (may already be stopped)');
      }
    }

    this.stmtUpdateStopped.run(id);
    this.logger.info({ id }, 'Spawned agent stopped');
  }

  async remove(id: string): Promise<void> {
    const record = this.stmtGet.get(id) as Record<string, unknown> | undefined;
    if (!record) throw new Error(`Spawned agent ${id} not found`);

    const status = record.status as string;
    if (ACTIVE_STATUSES.includes(status as ActiveStatus)) {
      await this.stop(id);
    }

    if (record.container_id) {
      try {
        const container = this.docker.getContainer(record.container_id as string);
        await container.remove({ force: true });
      } catch (err) {
        this.logger.warn({ id, err }, 'Container remove error (may already be removed)');
      }
    }

    // Clean up worktree directory
    const worktreePath = record.worktree_path as string | null;
    if (worktreePath && existsSync(worktreePath)) {
      try {
        // Try git worktree remove first, then fallback to rm -rf
        const bareRepoPath = this.getBareRepoPath(record.repo_url as string);
        if (existsSync(bareRepoPath)) {
          execFileSync('git', ['worktree', 'remove', worktreePath, '--force'], {
            ...execOpts,
            cwd: bareRepoPath,
          });
        } else {
          rmSync(worktreePath, { recursive: true, force: true });
        }
      } catch {
        rmSync(worktreePath, { recursive: true, force: true });
      }
    }

    this.stmtUpdateStatus.run('removed', id);
    this.dashboardBroadcast?.({ type: 'agent:removed', agentId: id });
    this.logger.info({ id }, 'Spawned agent removed');
  }

  list(statusFilter?: string): SpawnedAgentRecord[] {
    const rows = statusFilter
      ? (this.stmtListByStatus.all(statusFilter) as Record<string, unknown>[])
      : (this.stmtList.all() as Record<string, unknown>[]);
    return rows.map(rowToRecord);
  }

  get(id: string): SpawnedAgentRecord | undefined {
    const row = this.stmtGet.get(id) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  /**
   * Called by agent-handler when a spawned agent registers via WebSocket.
   * Updates status to running and broadcasts agent:spawned to dashboard.
   */
  markRunning(machineId: string): void {
    const row = this.stmtGet.get(machineId) as Record<string, unknown> | undefined;
    if (!row) return;

    const status = row.status as string;
    if (status === 'starting' || status === 'creating') {
      this.stmtUpdateStarted.run(machineId);
      const updated = this.get(machineId);
      if (updated) {
        this.dashboardBroadcast?.({ type: 'agent:spawned', agent: updated });
        this.logger.info({ machineId }, 'Spawned agent marked running');
      }
    }
  }

  /**
   * Called by agent-handler when a spawned agent's socket closes.
   * Updates status to stopped if still in an active state.
   */
  markStopped(machineId: string): void {
    const row = this.stmtGet.get(machineId) as Record<string, unknown> | undefined;
    if (!row) return;

    const status = row.status as string;
    if (ACTIVE_STATUSES.includes(status as ActiveStatus)) {
      this.stmtUpdateStopped.run(machineId);
      this.logger.info({ machineId }, 'Spawned agent marked stopped on disconnect');
    }
  }

  async dispose(): Promise<void> {
    // Nothing to tear down — containers keep running after hub shuts down.
    this.logger.info('ContainerOrchestrator disposed');
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private getRecord(id: string): SpawnedAgentRecord {
    const row = this.stmtGet.get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`Spawned agent record ${id} not found after insert`);
    return rowToRecord(row);
  }

  private getBareRepoPath(repoUrl: string): string {
    const name = sanitizeRepoName(repoUrl);
    return path.join(this.config.reposPath, 'bare', `${name}.git`);
  }

  private async ensureBareClone(repoUrl: string): Promise<string> {
    const existing = this.cloneInFlight.get(repoUrl);
    if (existing) return existing;

    const promise = this.doEnsureBareClone(repoUrl);
    this.cloneInFlight.set(repoUrl, promise);
    try {
      return await promise;
    } finally {
      this.cloneInFlight.delete(repoUrl);
    }
  }

  private async doEnsureBareClone(repoUrl: string): Promise<string> {
    const bareRepoPath = this.getBareRepoPath(repoUrl);
    const bareDir = path.dirname(bareRepoPath);

    if (existsSync(path.join(bareRepoPath, 'HEAD'))) {
      this.logger.info({ bareRepoPath }, 'Bare repo exists, fetching');
      execFileSync('git', ['fetch', 'origin', '--prune'], { ...execOpts, cwd: bareRepoPath });
    } else {
      this.logger.info({ repoUrl, bareRepoPath }, 'Cloning bare repo');
      if (!existsSync(bareDir)) mkdirSync(bareDir, { recursive: true });
      execFileSync(
        'git',
        ['clone', '--bare', '--filter=blob:none', '--', repoUrl, bareRepoPath],
        execOpts,
      );
    }

    return bareRepoPath;
  }

  private createWorktree(bareRepoPath: string, worktreePath: string, branch: string): void {
    const worktreeParent = path.dirname(worktreePath);
    if (!existsSync(worktreeParent)) mkdirSync(worktreeParent, { recursive: true });

    this.logger.info({ bareRepoPath, worktreePath, branch }, 'Creating worktree');

    execFileSync(
      'git',
      ['worktree', 'add', '--detach', worktreePath, `origin/${branch}`],
      { ...execOpts, cwd: bareRepoPath },
    );
  }

  private async prePullImage(image: string): Promise<void> {
    this.logger.info({ image }, 'Pre-pulling agent image');
    const stream = await this.docker.pull(image);
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
    this.logger.info({ image }, 'Agent image pre-pulled');
  }

  private async reconcile(): Promise<void> {
    this.logger.info('Reconciling spawned agent records');

    const placeholders = ACTIVE_STATUSES.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT * FROM spawned_agents WHERE status IN (${placeholders})`)
      .all(...ACTIVE_STATUSES) as Record<string, unknown>[];

    for (const row of rows) {
      const id = row.id as string;
      const containerId = row.container_id as string | null;

      if (!containerId) {
        // Never got a container — mark as error
        this.stmtSetError.run('Container never created before hub restart', id);
        continue;
      }

      try {
        const container = this.docker.getContainer(containerId);
        const info = await container.inspect();
        const running = info.State?.Running ?? false;
        const exited = info.State?.Status === 'exited' || info.State?.Status === 'dead';

        if (running) {
          // Still running — keep as-is (or fix up to 'running' if stuck in 'starting')
          if (row.status === 'starting' || row.status === 'creating') {
            this.stmtUpdateStarted.run(id);
          }
        } else if (exited) {
          this.stmtUpdateStopped.run(id);
        } else {
          this.stmtSetError.run(`Unexpected container state: ${info.State?.Status}`, id);
        }
      } catch {
        // Container does not exist in Docker — mark stopped
        this.stmtUpdateStopped.run(id);
        this.logger.warn({ id, containerId }, 'Container not found during reconcile, marked stopped');
      }
    }
  }
}
