import { spawn, type ChildProcess } from 'node:child_process';
import pino from 'pino';

const log = pino({ name: 'wsl-spawn' });

/**
 * CAP-079 / story 018-007: WSL2 spawn strategy.
 *
 * Runs `claude` inside a WSL2 distribution from a Windows host.
 * Mirrors the SSH strategy's shape so the upstream contract test
 * (SpawnedProcess interface) passes without modification.
 *
 * Usage:
 *   wsl -d <distro> -- bash -lc 'cd <cwd> && <exports> && claude <args>'
 *
 * We use `bash -lc` to get a login shell so PATH and environment
 * (nvm, pyenv, etc.) are set up the same way an interactive WSL
 * shell would see them.
 *
 * AbortSignal.kill() sends SIGTERM to the outer `wsl.exe` process;
 * the Windows side translates that into a clean shutdown of the
 * Linux process tree.
 */

export interface WslSpawnOptions {
  /** WSL distro name, e.g. `Ubuntu-24.04`. Required. */
  distro: string;
  /** Optional user to exec as (--user). */
  user?: string;
  /** Override the `wsl` binary path (default: `wsl`). */
  wslBinary?: string;
}

export interface WslSpawnInput {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
}

/**
 * Escapes a value for inclusion in a single-quoted POSIX shell
 * string. The result is safe to paste inside `'...'`.
 */
function shellEscape(value: string): string {
  return value.replace(/'/g, "'\\''");
}

/**
 * Quote a path for POSIX shell — single-quoted unless empty.
 */
function quotePath(path: string): string {
  return `'${shellEscape(path)}'`;
}

/**
 * Builds the remote shell command string executed inside WSL.
 * Exported for unit tests — callers don't need to use it directly.
 */
export function buildWslRemoteCommand(input: WslSpawnInput): string {
  const envExports = Object.entries(input.env)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `export ${k}='${shellEscape(v as string)}'`)
    .join('; ');

  const cwd = input.cwd ? `cd ${quotePath(input.cwd)} && ` : '';
  const quotedArgs = input.args.map((a) => `'${shellEscape(a)}'`).join(' ');
  const quotedCmd = `'${shellEscape(input.command)}'`;

  return `${envExports ? envExports + '; ' : ''}${cwd}${quotedCmd} ${quotedArgs}`;
}

/**
 * Assemble the full `wsl` command-line args. Exported for tests.
 */
export function buildWslCliArgs(
  opts: WslSpawnOptions,
  remoteCmd: string,
): string[] {
  const args: string[] = ['-d', opts.distro];
  if (opts.user) args.push('--user', opts.user);
  args.push('--', 'bash', '-lc', remoteCmd);
  return args;
}

/**
 * Factory that returns a SpawnedProcess-compatible function.
 * Matches the shape of `createSshSpawn` so callers can swap
 * strategies without conditional logic.
 */
export function createWslSpawn(opts: WslSpawnOptions) {
  if (!opts.distro) {
    throw new Error('WSL spawn requires a `distro` name');
  }

  const wslBinary = opts.wslBinary ?? 'wsl';

  return (input: WslSpawnInput): ChildProcess => {
    const remoteCmd = buildWslRemoteCommand(input);
    const cliArgs = buildWslCliArgs(opts, remoteCmd);

    log.info({ distro: opts.distro, cwd: input.cwd }, 'Spawning via WSL');

    const proc = spawn(wslBinary, cliArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    input.signal.addEventListener('abort', () => {
      proc.kill('SIGTERM');
    });

    return proc;
  };
}
