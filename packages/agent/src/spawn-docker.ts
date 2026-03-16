import { spawn, type ChildProcess } from 'node:child_process';
import pino from 'pino';

const log = pino({ name: 'docker-spawn' });

export interface DockerSpawnOptions {
  containerName: string;
  image?: string;
  volumeMounts?: Array<{ host: string; container: string; readonly?: boolean }>;
  resourceLimits?: { cpus?: string; memory?: string };
}

/**
 * Creates a spawn function compatible with the Claude Agent SDK's
 * `spawnClaudeCodeProcess` option. Routes execution into a Docker container.
 *
 * ChildProcess from spawn('docker', ['exec', ...]) directly satisfies
 * the SpawnedProcess interface — zero adapter code needed.
 *
 * CRITICAL: Do NOT use -t (TTY) flag. The SDK uses JSON-lines, not terminal escape sequences.
 */
export function createDockerExecSpawn(opts: DockerSpawnOptions) {
  return (spawnOpts: {
    command: string;
    args: string[];
    cwd?: string;
    env: Record<string, string | undefined>;
    signal: AbortSignal;
  }): ChildProcess => {
    const containerCwd = spawnOpts.cwd ?? '/workspace';

    const dockerArgs = [
      'exec',
      '-i', // Interactive stdin — NO -t (TTY corrupts JSON-lines)
      '-w', containerCwd,
      // Inject environment variables
      ...Object.entries(spawnOpts.env)
        .filter(([, v]) => v !== undefined)
        .flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      opts.containerName,
      'claude', // Use container's claude binary, not host path
      ...spawnOpts.args,
    ];

    log.info({ container: opts.containerName, cwd: containerCwd }, 'Spawning in Docker');

    const proc = spawn('docker', dockerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Forward abort signal
    spawnOpts.signal.addEventListener('abort', () => {
      proc.kill('SIGTERM');
    });

    return proc; // ChildProcess satisfies SpawnedProcess
  };
}

/**
 * Creates a spawn function that runs each session in a new container.
 * Container is auto-removed on exit.
 */
export function createDockerRunSpawn(opts: DockerSpawnOptions) {
  return (spawnOpts: {
    command: string;
    args: string[];
    cwd?: string;
    env: Record<string, string | undefined>;
    signal: AbortSignal;
  }): ChildProcess => {
    const containerCwd = '/workspace';

    const dockerArgs = [
      'run',
      '--rm',
      '-i', // NO -t
      '-w', containerCwd,
      ...(opts.resourceLimits?.cpus ? ['--cpus', opts.resourceLimits.cpus] : []),
      ...(opts.resourceLimits?.memory ? ['--memory', opts.resourceLimits.memory] : []),
      ...(opts.volumeMounts ?? []).flatMap((m) => [
        '-v',
        `${m.host}:${m.container}${m.readonly ? ':ro' : ''}`,
      ]),
      ...Object.entries(spawnOpts.env)
        .filter(([, v]) => v !== undefined)
        .flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      opts.image ?? 'ghcr.io/anthropics/claude-code:latest',
      'claude',
      ...spawnOpts.args,
    ];

    log.info({ image: opts.image, cwd: spawnOpts.cwd }, 'Spawning in new Docker container');

    const proc = spawn('docker', dockerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    spawnOpts.signal.addEventListener('abort', () => {
      proc.kill('SIGTERM');
    });

    return proc;
  };
}
