import Docker from 'dockerode';
import { EventEmitter } from 'node:events';
import pino from 'pino';
import type { ContainerSecurityConfig } from './container-security.js';

const log = pino({ name: 'container-pool' });

export interface ContainerInfo {
  id: string;
  containerId: string;
  jobId: string;
  status: 'creating' | 'running' | 'exited' | 'error';
  exitCode: number | null;
  startedAt: number;
}

export interface CreateContainerOptions {
  id: string;
  jobId: string;
  image: string;
  prompt: string;
  workspacePath: string;
  env: Record<string, string>;
  security: ContainerSecurityConfig;
  flags?: string[];
}

export class ContainerPool extends EventEmitter {
  private readonly docker: Docker;
  private readonly containers = new Map<string, {
    container: Docker.Container;
    info: ContainerInfo;
  }>();
  private readonly maxContainers: number;

  constructor(maxContainers: number = 4, socketPath?: string) {
    super();
    this.docker = new Docker({ socketPath: socketPath ?? '/var/run/docker.sock' });
    this.maxContainers = maxContainers;
  }

  get activeCount(): number {
    return [...this.containers.values()].filter(c => c.info.status === 'running').length;
  }

  get hasCapacity(): boolean {
    return this.activeCount < this.maxContainers;
  }

  async prePullImage(image: string): Promise<boolean> {
    log.info({ image }, 'Pre-pulling image');
    try {
      const stream = await this.docker.pull(image);
      await new Promise<void>((resolve, reject) => {
        this.docker.modem.followProgress(stream, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      log.info({ image }, 'Image pulled');
      return true;
    } catch (err) {
      log.error({ image, err }, 'Failed to pull image');
      return false;
    }
  }

  async create(opts: CreateContainerOptions): Promise<string> {
    if (!this.hasCapacity) {
      throw new Error(`Container pool at capacity (${this.activeCount}/${this.maxContainers})`);
    }

    // Validate workspace path — prevent mounting sensitive host directories
    const forbidden = ['/etc', '/var/run', '/root', '/proc', '/sys', '/dev'];
    const normalizedPath = opts.workspacePath.replace(/\/+$/, '');
    if (forbidden.some((f) => normalizedPath === f || normalizedPath.startsWith(f + '/'))) {
      throw new Error(`Workspace path "${opts.workspacePath}" is forbidden — cannot mount system directories`);
    }

    const claudeArgs = [
      '-p', opts.prompt,
      '--dangerously-skip-permissions',
      ...(opts.flags ?? []),
    ];

    const envArray = Object.entries(opts.env)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${v}`);

    // Always disable non-essential traffic in containers
    envArray.push('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1');

    log.info({ id: opts.id, jobId: opts.jobId, workspace: opts.workspacePath }, 'Creating container');

    const container = (await this.docker.createContainer({
      Image: opts.image,
      Cmd: ['claude', ...claudeArgs],
      Tty: false,
      AttachStdout: true,
      AttachStderr: true,
      Env: envArray,
      WorkingDir: '/workspace',
      User: opts.security.user,
      HostConfig: {
        Binds: [`${opts.workspacePath}:/workspace:rw`],
        Memory: opts.security.memoryBytes,
        MemorySwap: opts.security.memoryBytes,
        CpuQuota: opts.security.cpuQuota,
        CpuPeriod: opts.security.cpuPeriod,
        PidsLimit: opts.security.pidsLimit,
        NetworkMode: opts.security.networkMode,
        SecurityOpt: opts.security.securityOpt,
        CapDrop: opts.security.capDrop,
        ReadonlyRootfs: opts.security.readonlyRootfs,
        Tmpfs: opts.security.tmpfs,
      },
    })) as unknown as Docker.Container;

    const info: ContainerInfo = {
      id: opts.id,
      containerId: container.id,
      jobId: opts.jobId,
      status: 'creating',
      exitCode: null,
      startedAt: Date.now(),
    };

    this.containers.set(opts.id, { container, info });
    this.emit('container:created', opts.id, container.id);

    return container.id;
  }

  async start(id: string): Promise<void> {
    const entry = this.containers.get(id);
    if (!entry) throw new Error(`Container ${id} not found`);

    await entry.container.start();
    entry.info.status = 'running';
    this.emit('container:started', id, entry.info.containerId);

    // Attach to stdout/stderr
    const stream = await entry.container.attach({
      stream: true,
      stdout: true,
      stderr: true,
    });

    entry.container.modem.demuxStream(
      stream,
      {
        write: (chunk: Buffer) => {
          this.emit('container:stdout', id, chunk.toString());
        },
      },
      {
        write: (chunk: Buffer) => {
          this.emit('container:stderr', id, chunk.toString());
        },
      },
    );

    // Wait for container to exit
    const result = await entry.container.wait();

    // Check if entry still exists (may have been removed by concurrent stop/remove)
    const current = this.containers.get(id);
    if (current) {
      current.info.status = 'exited';
      current.info.exitCode = result.StatusCode;
    }

    log.info({ id, exitCode: result.StatusCode }, 'Container exited');
    this.emit('container:exited', id, result.StatusCode);
  }

  async stop(id: string): Promise<void> {
    const entry = this.containers.get(id);
    if (!entry) return; // Gracefully handle already-removed

    try {
      await entry.container.stop({ t: 10 });
    } catch {
      // Container may already be stopped
    }
  }

  async remove(id: string): Promise<void> {
    const entry = this.containers.get(id);
    if (!entry) return;

    // Delete from map FIRST to prevent concurrent access
    this.containers.delete(id);

    try {
      await entry.container.remove({ force: true });
    } catch {
      // Container may already be removed
    }

    this.emit('container:removed', id);
  }

  async getStats(id: string): Promise<{ cpuPercent: number; memoryMB: number; pids: number } | null> {
    const entry = this.containers.get(id);
    if (!entry || entry.info.status !== 'running') return null;

    try {
      const stats = await entry.container.stats({ stream: false }) as Docker.ContainerStats;
      const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
      const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
      const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * 100 : 0;
      const memoryMB = stats.memory_stats.usage / (1024 * 1024);
      const pids = stats.pids_stats?.current ?? 0;

      return { cpuPercent: Math.round(cpuPercent * 10) / 10, memoryMB: Math.round(memoryMB), pids };
    } catch {
      return null;
    }
  }

  list(): ContainerInfo[] {
    return [...this.containers.values()].map(e => e.info);
  }

  async dispose(): Promise<void> {
    // Copy keys to avoid modifying map during iteration
    const ids = [...this.containers.keys()];
    for (const id of ids) {
      await this.remove(id);
    }
    this.removeAllListeners();
  }
}
