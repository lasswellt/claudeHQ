import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { type AgentConfig, type HubToAgentMessage } from '@chq/shared';
import { PtyPool } from './pty-pool.js';
import { WsClient } from './ws-client.js';
import { Recorder } from './recorder.js';
import { getSystemHealth } from './health.js';
import { writeHooksConfig } from './hooks-config.js';
import { ContainerPool } from './container-pool.js';
import { getDefaultSecurityConfig } from './container-security.js';
import { ensureRepoCloned, createWorktree, commitAndPush, removeWorktree } from './container-worktree.js';
import { runSetupPipeline } from './container-setup.js';
import type { OutputChunk } from '@chq/shared';
import pino from 'pino';

const log = pino({ name: 'chq-agent' });

// Default image for Claude Code containers (can be overridden via env)
const CONTAINER_IMAGE = process.env.CHQ_CONTAINER_IMAGE ?? 'chq-agent:local';
// Base path for cloned repos on this agent machine
const REPOS_BASE_PATH = process.env.CHQ_REPOS_PATH ?? path.join(process.env.HOME ?? '/tmp', '.chq', 'repos');

// Track per-container metadata needed for post-exit cleanup
interface ContainerMeta {
  jobId: string;
  repoDir: string;
  worktreePath: string;
  branch: string;
  prompt: string;
  statsInterval: ReturnType<typeof setInterval> | null;
}

export class Daemon {
  private readonly config: AgentConfig;
  private readonly pool: PtyPool;
  private readonly containerPool: ContainerPool;
  private readonly wsClient: WsClient;
  private readonly recorders = new Map<string, Recorder>();
  private readonly sessionMeta = new Map<string, { prompt: string; cwd: string }>();
  private readonly containerMeta = new Map<string, ContainerMeta>();
  private running = false;

  constructor(config: AgentConfig) {
    this.config = config;
    this.pool = new PtyPool(config.maxConcurrentSessions);
    this.containerPool = new ContainerPool();

    this.wsClient = new WsClient({
      url: config.hubUrl,
      machineId: config.machineId,
      version: '0.1.0',
      maxSessions: config.maxConcurrentSessions,
      os: `${os.platform()}-${os.arch()}`,
      onMessage: (msg) => this.handleHubMessage(msg),
    });
  }

  async start(): Promise<void> {
    log.info({ machineId: this.config.machineId }, 'Starting agent daemon');

    // Write Claude Code hooks config before spawning any sessions
    writeHooksConfig(this.config.hubUrl);
    log.info('Wrote Claude Code hooks config');

    // Wire up pool events → WS client
    this.pool.on('session:started', (sessionId: string) => {
      const session = this.pool.get(sessionId);
      if (!session) return;

      const meta = this.sessionMeta.get(sessionId);
      this.wsClient.send({
        type: 'agent:session:started',
        sessionId,
        machineId: this.config.machineId,
        prompt: meta?.prompt ?? '',
        cwd: meta?.cwd ?? '',
        pid: session.pid ?? 0,
      });
    });

    this.pool.on('session:output', (sessionId: string, chunks: OutputChunk[]) => {
      this.wsClient.send({
        type: 'agent:session:output',
        sessionId,
        chunks,
      });

      // Forward to recorder
      const recorder = this.recorders.get(sessionId);
      if (recorder) recorder.addChunks(chunks);
    });

    this.pool.on('session:exit', (sessionId: string, exitCode: number) => {
      const session = this.pool.get(sessionId);
      this.wsClient.send({
        type: 'agent:session:ended',
        sessionId,
        exitCode,
        claudeSessionId: session?.claudeSessionId ?? null,
      });

      // Finalize recorder
      const recorder = this.recorders.get(sessionId);
      if (recorder) {
        recorder.finalize();
        recorder.dispose();
        this.recorders.delete(sessionId);
      }
    });

    // Wire container pool events → WS client
    this.containerPool.on('container:created', (id: string, containerId: string) => {
      const meta = this.containerMeta.get(id);
      if (!meta) return;
      this.wsClient.send({
        type: 'agent:container:created',
        jobId: meta.jobId,
        containerId,
      });
    });

    this.containerPool.on('container:started', (id: string, containerId: string) => {
      const meta = this.containerMeta.get(id);
      if (!meta) return;
      this.wsClient.send({
        type: 'agent:container:started',
        jobId: meta.jobId,
        containerId,
      });

      // Begin periodic stats reporting (every 15 s)
      const interval = setInterval(async () => {
        const stats = await this.containerPool.getStats(id);
        if (!stats) return;
        this.wsClient.send({
          type: 'agent:container:stats',
          containerId,
          cpuPercent: stats.cpuPercent,
          memoryMB: stats.memoryMB,
          pids: stats.pids,
        });
      }, 15000);

      meta.statsInterval = interval;
    });

    this.containerPool.on('container:stdout', (id: string, data: string) => {
      // Look up the actual Docker container ID for the message
      const containers = this.containerPool.list();
      const entry = containers.find(c => c.id === id);
      if (!entry) return;
      this.wsClient.send({
        type: 'agent:container:stdout',
        containerId: entry.containerId,
        data,
      });
    });

    this.containerPool.on('container:exited', (id: string, exitCode: number) => {
      const meta = this.containerMeta.get(id);
      if (!meta) return;

      // Stop stats interval
      if (meta.statsInterval) {
        clearInterval(meta.statsInterval);
        meta.statsInterval = null;
      }

      // Commit and push any changes from the worktree
      const { commitHash, filesChanged } = commitAndPush(
        meta.worktreePath,
        `chore: claude code job ${meta.jobId}`,
      );

      const containers = this.containerPool.list();
      const entry = containers.find(c => c.id === id);
      const containerId = entry?.containerId ?? id;

      this.wsClient.send({
        type: 'agent:container:exited',
        jobId: meta.jobId,
        containerId,
        exitCode,
        commitHash,
        filesChanged,
        branch: meta.branch,
      });

      // Best-effort cleanup: remove container then worktree
      this.containerPool.remove(id).catch((err: unknown) => {
        log.warn({ id, err }, 'Failed to remove container after exit');
      });

      // Remove worktree after container is gone
      removeWorktree(meta.repoDir, meta.worktreePath);
      this.containerMeta.delete(id);
    });

    // Heartbeat handler
    this.wsClient.on('heartbeatTick', () => {
      const health = getSystemHealth();
      this.wsClient.sendHeartbeat(health.cpuPercent, health.memPercent, this.pool.activeCount);
    });

    this.wsClient.on('stateChange', (state: string) => {
      log.info({ state }, 'WebSocket connection state changed');
    });

    // Connect to Hub
    this.wsClient.connect();
    this.running = true;

    // Graceful shutdown
    const shutdown = async (): Promise<void> => {
      if (!this.running) return;
      this.running = false;
      log.info('Shutting down...');

      await this.pool.killAll();
      this.wsClient.destroy();
      this.pool.dispose();

      // Stop stats intervals before disposing containers
      for (const meta of this.containerMeta.values()) {
        if (meta.statsInterval) clearInterval(meta.statsInterval);
      }
      await this.containerPool.dispose();
      this.containerMeta.clear();

      for (const recorder of this.recorders.values()) {
        recorder.dispose();
      }
      this.recorders.clear();

      log.info('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }

  private handleHubMessage(msg: HubToAgentMessage): void {
    switch (msg.type) {
      case 'hub:session:start':
        this.handleSessionStart(msg);
        break;
      case 'hub:session:kill':
        this.handleSessionKill(msg.sessionId);
        break;
      case 'hub:session:input':
        this.handleSessionInput(msg.sessionId, msg.input);
        break;
      case 'hub:session:resume':
        log.info({ sessionId: msg.sessionId }, 'Resume not yet implemented');
        break;
      case 'hub:queue:add':
      case 'hub:queue:remove':
      case 'hub:queue:reorder':
        log.info({ type: msg.type }, 'Queue commands not yet implemented');
        break;
      case 'hub:container:create':
        this.handleContainerCreate(msg).catch((err: unknown) => {
          log.error({ jobId: msg.jobId, err }, 'Container create failed');
          this.wsClient.send({
            type: 'agent:container:error',
            jobId: msg.jobId,
            error: err instanceof Error ? err.message : String(err),
            phase: 'create',
          });
        });
        break;
      case 'hub:container:stop':
        this.handleContainerStop(msg.containerId).catch((err: unknown) => {
          log.error({ containerId: msg.containerId, err }, 'Container stop failed');
        });
        break;
      case 'hub:container:remove':
        this.handleContainerRemove(msg.containerId).catch((err: unknown) => {
          log.error({ containerId: msg.containerId, err }, 'Container remove failed');
        });
        break;
      // Workspace messages handled elsewhere (workspace-provisioner)
      case 'hub:workspace:provision':
      case 'hub:workspace:cleanup':
        log.info({ type: msg.type }, 'Workspace commands not yet implemented in daemon');
        break;
      // Approval decision is handled by the approvals bridge, not here
      case 'hub:approval:decision':
        log.debug({ type: msg.type }, 'Approval decision received (handled by approvals bridge)');
        break;
    }
  }

  /**
   * Hub→Agent: create a container for a job.
   * Steps: clone/fetch repo → create worktree → run setup pipeline → create+start container.
   */
  private async handleContainerCreate(msg: {
    jobId: string;
    repoId: string;
    repoUrl: string;
    branch: string;
    prompt: string;
    setupCommands: string[];
    preFlightCommands: string[];
    env: Record<string, string>;
  }): Promise<void> {
    if (!this.containerPool.hasCapacity) {
      throw new Error('Container pool at capacity');
    }

    log.info({ jobId: msg.jobId, repoUrl: msg.repoUrl, branch: msg.branch }, 'Creating container for job');

    // Ensure repos base directory exists
    mkdirSync(REPOS_BASE_PATH, { recursive: true });

    // Clone or fetch the repo
    const repoDir = ensureRepoCloned(msg.repoUrl, msg.repoId, REPOS_BASE_PATH);

    // Generate a unique ID for the pool entry
    const poolId = randomUUID();

    // Create a git worktree for this job
    const worktreeInfo = createWorktree(repoDir, poolId, msg.jobId, msg.branch);

    const meta: ContainerMeta = {
      jobId: msg.jobId,
      repoDir,
      worktreePath: worktreeInfo.worktreePath,
      branch: worktreeInfo.branch,
      prompt: msg.prompt,
      statsInterval: null,
    };
    this.containerMeta.set(poolId, meta);

    // Run setup pipeline before launching the main container
    if (msg.setupCommands.length > 0 || msg.preFlightCommands.length > 0) {
      log.info({ jobId: msg.jobId, setupCount: msg.setupCommands.length }, 'Running setup pipeline');
      const Docker = (await import('dockerode')).default;
      const docker = new Docker();
      const setupResult = await runSetupPipeline(docker, {
        image: CONTAINER_IMAGE,
        workspacePath: worktreeInfo.worktreePath,
        setupCommands: msg.setupCommands,
        preFlightCommands: msg.preFlightCommands,
        env: msg.env,
        security: getDefaultSecurityConfig(),
        onOutput: (data) => {
          this.wsClient.send({
            type: 'agent:container:stdout',
            containerId: poolId,
            data,
          });
        },
      });

      if (!setupResult.success) {
        this.containerMeta.delete(poolId);
        removeWorktree(repoDir, worktreeInfo.worktreePath);
        throw new Error(`Setup pipeline failed at step: ${setupResult.failedStep ?? 'unknown'}`);
      }
    }

    // Create the container (emits container:created event)
    await this.containerPool.create({
      id: poolId,
      jobId: msg.jobId,
      image: CONTAINER_IMAGE,
      prompt: msg.prompt,
      workspacePath: worktreeInfo.worktreePath,
      env: msg.env,
      security: getDefaultSecurityConfig(),
    });

    // Start the container (emits container:started then container:exited when done)
    // Run in background — the exited event handler sends agent:container:exited
    this.containerPool.start(poolId).catch((err: unknown) => {
      log.error({ poolId, jobId: msg.jobId, err }, 'Container start/run failed');
      const meta2 = this.containerMeta.get(poolId);
      this.wsClient.send({
        type: 'agent:container:error',
        jobId: msg.jobId,
        error: err instanceof Error ? err.message : String(err),
        phase: 'run',
      });
      // Cleanup on error
      if (meta2?.statsInterval) clearInterval(meta2.statsInterval);
      this.containerPool.remove(poolId).catch(() => undefined);
      if (meta2) removeWorktree(meta2.repoDir, meta2.worktreePath);
      this.containerMeta.delete(poolId);
    });
  }

  /**
   * Hub→Agent: stop a running container by its Docker container ID.
   * We find the pool entry by matching containerId.
   */
  private async handleContainerStop(containerId: string): Promise<void> {
    const entry = this.containerPool.list().find(c => c.containerId === containerId);
    if (!entry) {
      log.warn({ containerId }, 'Container stop: not found in pool');
      return;
    }
    log.info({ containerId, poolId: entry.id }, 'Stopping container');
    await this.containerPool.stop(entry.id);
  }

  /**
   * Hub→Agent: remove a container by its Docker container ID.
   */
  private async handleContainerRemove(containerId: string): Promise<void> {
    const entry = this.containerPool.list().find(c => c.containerId === containerId);
    if (!entry) {
      log.warn({ containerId }, 'Container remove: not found in pool');
      return;
    }
    const meta = this.containerMeta.get(entry.id);
    log.info({ containerId, poolId: entry.id }, 'Removing container');

    if (meta?.statsInterval) clearInterval(meta.statsInterval);
    await this.containerPool.remove(entry.id);
    if (meta) removeWorktree(meta.repoDir, meta.worktreePath);
    this.containerMeta.delete(entry.id);
  }

  private handleSessionStart(msg: { sessionId: string; prompt: string; cwd: string; flags: string[] }): void {
    if (!this.pool.hasCapacity) {
      log.warn({ sessionId: msg.sessionId }, 'No capacity for new session');
      return;
    }

    // Store session metadata for the started event
    this.sessionMeta.set(msg.sessionId, { prompt: msg.prompt, cwd: msg.cwd });

    // Create recorder for this session
    const recorder = new Recorder({
      sessionId: msg.sessionId,
      wsClient: this.wsClient,
      uploadIntervalMs: this.config.recordingUploadIntervalMs,
    });
    recorder.start();
    this.recorders.set(msg.sessionId, recorder);

    // Spawn the session
    this.pool.spawn({
      sessionId: msg.sessionId,
      prompt: msg.prompt,
      cwd: msg.cwd || this.config.defaultCwd || process.cwd(),
      flags: msg.flags.length > 0 ? msg.flags : this.config.defaultFlags,
      machineId: this.config.machineId,
      claudeBinary: this.config.claudeBinary,
    });

    log.info({ sessionId: msg.sessionId, prompt: msg.prompt.slice(0, 100) }, 'Session started');
  }

  private handleSessionKill(sessionId: string): void {
    try {
      this.pool.kill(sessionId);
      log.info({ sessionId }, 'Session killed');
    } catch (err) {
      log.error({ sessionId, err }, 'Failed to kill session');
    }
  }

  private handleSessionInput(sessionId: string, input: string): void {
    try {
      this.pool.write(sessionId, input);
    } catch (err) {
      log.error({ sessionId, err }, 'Failed to write to session');
    }
  }

  getStatus(): { running: boolean; sessions: ReturnType<PtyPool['list']>; connected: boolean } {
    return {
      running: this.running,
      sessions: this.pool.list(),
      connected: this.wsClient.state === 'connected',
    };
  }
}
