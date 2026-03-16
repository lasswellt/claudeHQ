import { spawn, type ChildProcess } from 'node:child_process';
import pino from 'pino';

const log = pino({ name: 'ssh-spawn' });

export interface SshSpawnOptions {
  host: string;
  user?: string;
  port?: number;
  identityFile?: string;
}

/**
 * Creates a spawn function that routes execution to a remote machine via SSH.
 *
 * ChildProcess from spawn('ssh', [...]) directly satisfies SpawnedProcess.
 *
 * CRITICAL: Do NOT use -tt (pseudo-TTY). JSON-lines protocol requires raw pipes.
 */
export function createSshSpawn(opts: SshSpawnOptions) {
  return (spawnOpts: {
    command: string;
    args: string[];
    cwd?: string;
    env: Record<string, string | undefined>;
    signal: AbortSignal;
  }): ChildProcess => {
    const target = opts.user ? `${opts.user}@${opts.host}` : opts.host;

    // Build environment exports
    const envExports = Object.entries(spawnOpts.env)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `export ${k}='${(v as string).replace(/'/g, "'\\''")}'`)
      .join('; ');

    const cwd = spawnOpts.cwd ?? '~';
    const remoteCmd = `${envExports}; cd ${cwd} && claude ${spawnOpts.args.join(' ')}`;

    const sshArgs = [
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'BatchMode=yes', // No interactive prompts
      '-o', 'ServerAliveInterval=30',
      ...(opts.port ? ['-p', String(opts.port)] : []),
      ...(opts.identityFile ? ['-i', opts.identityFile] : []),
      target,
      remoteCmd,
    ];

    log.info({ host: opts.host, cwd }, 'Spawning via SSH');

    const proc = spawn('ssh', sshArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    spawnOpts.signal.addEventListener('abort', () => {
      proc.kill('SIGTERM');
    });

    return proc;
  };
}
