import Docker from 'dockerode';
import pino from 'pino';
import type { ContainerSecurityConfig } from './container-security.js';

const log = pino({ name: 'container-setup' });

/**
 * Runs setup commands (pnpm install, etc.) in a temporary container
 * before launching the Claude Code container. This ensures the workspace
 * has all dependencies installed.
 *
 * Uses a separate container so the Claude container starts with a ready workspace.
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
  },
): Promise<{ success: boolean; failedStep?: string; output: string }> {
  const allCommands = [...opts.setupCommands, ...opts.preFlightCommands];
  if (allCommands.length === 0) return { success: true, output: '' };

  let fullOutput = '';

  for (const cmd of allCommands) {
    log.info({ cmd, workspace: opts.workspacePath }, 'Running setup command');

    // Parse command into shell args
    const container = (await docker.createContainer({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dockerode overloaded return type
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
        Memory: (opts.security.memoryBytes ?? 2 * 1024 * 1024 * 1024),
        NetworkMode: opts.security.networkMode ?? 'bridge',
      },
    })) as unknown as Docker.Container;

    await container.start();

    const stream = await container.attach({ stream: true, stdout: true, stderr: true });
    let cmdOutput = '';

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

    const result = await container.wait();
    await container.remove();

    fullOutput += `$ ${cmd}\n${cmdOutput}\n`;

    if (result.StatusCode !== 0) {
      log.error({ cmd, exitCode: result.StatusCode }, 'Setup command failed');
      return { success: false, failedStep: cmd, output: fullOutput };
    }

    log.info({ cmd }, 'Setup command completed');
  }

  return { success: true, output: fullOutput };
}
