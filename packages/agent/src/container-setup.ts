import Docker from 'dockerode';
import pino from 'pino';
import type { ContainerSecurityConfig } from './container-security.js';

const log = pino({ name: 'container-setup' });

// Allowlist of safe command prefixes for setup containers
const ALLOWED_SETUP_PREFIXES = [
  'pnpm ', 'npm ', 'yarn ', 'bun ', 'npx ',
  'pip ', 'uv ', 'cargo ', 'go ',
  'make', 'cmake',
  'apt-get ', 'apk ',
  'git ', 'cp ', 'mv ', 'mkdir ', 'chmod ', 'ln ',
  'node ', 'python', 'ruby ', 'java ',
  'tsc', 'eslint', 'prettier', 'vitest', 'jest',
];

function isAllowedCommand(cmd: string): boolean {
  const trimmed = cmd.trim();
  return ALLOWED_SETUP_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/**
 * Runs setup commands (pnpm install, etc.) in a temporary container
 * before launching the Claude Code container. This ensures the workspace
 * has all dependencies installed.
 *
 * Setup containers apply most of the same hardening as Claude containers:
 * - cap-drop ALL, no-new-privileges, PID limits, memory limits
 * - The only relaxation: network is 'bridge' (needs internet for npm install)
 *   and rootfs is writable (needs to install packages)
 * - Commands are validated against an allowlist
 */
export async function runSetupPipeline(
  docker: Docker,
  opts: {
    image: string;
    workspacePath: string;
    setupCommands: string[];
    preFlightCommands: string[];
    env: Record<string, string>;
    security: Partial<ContainerSecurityConfig>;
    onOutput?: (data: string) => void;
    timeoutMs?: number;
  },
): Promise<{ success: boolean; failedStep?: string; output: string }> {
  const allCommands = [...opts.setupCommands, ...opts.preFlightCommands];
  if (allCommands.length === 0) return { success: true, output: '' };

  // Validate all commands against allowlist
  for (const cmd of allCommands) {
    if (!isAllowedCommand(cmd)) {
      log.warn({ cmd }, 'Setup command rejected — not in allowlist');
      return { success: false, failedStep: cmd, output: `Rejected: "${cmd}" is not an allowed setup command` };
    }
  }

  let fullOutput = '';
  const timeout = opts.timeoutMs ?? 300000; // 5 min default per command

  for (const cmd of allCommands) {
    log.info({ cmd, workspace: opts.workspacePath }, 'Running setup command');

    const container = (await docker.createContainer({
      Image: opts.image,
      Cmd: ['sh', '-c', cmd],
      Tty: false,
      AttachStdout: true,
      AttachStderr: true,
      Env: Object.entries(opts.env)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${v}`),
      WorkingDir: '/workspace',
      User: opts.security.user ?? '1000:1000',
      HostConfig: {
        Binds: [`${opts.workspacePath}:/workspace:rw`],
        Memory: opts.security.memoryBytes ?? 2 * 1024 * 1024 * 1024,
        // Setup needs network for package installs (bridge, not host)
        NetworkMode: 'bridge',
        // Apply hardening even for setup containers
        SecurityOpt: ['no-new-privileges'],
        CapDrop: ['ALL'],
        // rootfs writable for setup (packages install to container fs)
        ReadonlyRootfs: false,
        PidsLimit: opts.security.pidsLimit ?? 256,
        CpuQuota: opts.security.cpuQuota ?? 200000,
        CpuPeriod: opts.security.cpuPeriod ?? 100000,
        Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=512m' },
      },
    })) as unknown as Docker.Container;

    await container.start();

    const stream = await container.attach({ stream: true, stdout: true, stderr: true });
    let cmdOutput = '';
    let timedOut = false;

    // Timeout protection — kill container if command hangs
    const timeoutTimer = setTimeout(async () => {
      timedOut = true;
      log.warn({ cmd, timeout }, 'Setup command timed out');
      try {
        await container.stop({ t: 5 });
      } catch {
        // Container may already be stopped
      }
    }, timeout);

    await new Promise<void>((resolve) => {
      container.modem.demuxStream(
        stream,
        {
          write: (chunk: Buffer) => {
            const text = chunk.toString();
            cmdOutput += text;
            opts.onOutput?.(text);
          },
        },
        {
          write: (chunk: Buffer) => {
            const text = chunk.toString();
            cmdOutput += text;
            opts.onOutput?.(text);
          },
        },
      );

      stream.on('end', resolve);
    });

    clearTimeout(timeoutTimer);

    const result = await container.wait();
    await container.remove();

    fullOutput += `$ ${cmd}\n${cmdOutput}\n`;

    if (timedOut) {
      return { success: false, failedStep: `${cmd} (timed out after ${timeout}ms)`, output: fullOutput };
    }

    if (result.StatusCode !== 0) {
      log.error({ cmd, exitCode: result.StatusCode }, 'Setup command failed');
      return { success: false, failedStep: cmd, output: fullOutput };
    }

    log.info({ cmd }, 'Setup command completed');
  }

  return { success: true, output: fullOutput };
}
