import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';

const log = pino({ name: 'docker-spawn' });

export interface DockerSpawnOptions {
  containerName: string;
  image?: string;
  volumeMounts?: Array<{ host: string; container: string; readonly?: boolean }>;
  resourceLimits?: { cpus?: string; memory?: string };
}

/**
 * Writes env vars to a temp file (mode 0o600) and returns the path.
 * The caller is responsible for deleting the file after the process starts.
 */
function writeEnvFile(env: Record<string, string | undefined>): string {
  const dir = mkdtempSync(join(tmpdir(), 'chq-'));
  const envFile = join(dir, '.env');
  const content = Object.entries(env)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v as string}`)
    .join('\n');
  writeFileSync(envFile, content, { mode: 0o600 });
  return envFile;
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

    // Write env vars to a temp file to avoid exposing secrets in ps/cmdline
    const envFile = writeEnvFile(spawnOpts.env);

    const dockerArgs = [
      'exec',
      '-i', // Interactive stdin — NO -t (TTY corrupts JSON-lines)
      '-w', containerCwd,
      '--env-file', envFile,
      opts.containerName,
      'claude', // Use container's claude binary, not host path
      ...spawnOpts.args,
    ];

    log.info({ container: opts.containerName, cwd: containerCwd }, 'Spawning in Docker');

    const proc = spawn('docker', dockerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Clean up env file after process starts (file descriptors are already open)
    proc.once('spawn', () => {
      try { unlinkSync(envFile); } catch { /* ignore */ }
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

    // Write env vars to a temp file to avoid exposing secrets in ps/cmdline
    const envFile = writeEnvFile(spawnOpts.env);

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
      '--env-file', envFile,
      opts.image ?? 'ghcr.io/anthropics/claude-code:latest',
      'claude',
      ...spawnOpts.args,
    ];

    log.info({ image: opts.image, cwd: spawnOpts.cwd }, 'Spawning in new Docker container');

    const proc = spawn('docker', dockerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Clean up env file after process starts (file descriptors are already open)
    proc.once('spawn', () => {
      try { unlinkSync(envFile); } catch { /* ignore */ }
    });

    spawnOpts.signal.addEventListener('abort', () => {
      proc.kill('SIGTERM');
    });

    return proc;
  };
}
