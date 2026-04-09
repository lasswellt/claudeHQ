import { describe, it, expect, vi } from 'vitest';
import {
  buildSetupScript,
  runSetupContainer,
  type DockerRunFn,
} from '../setup-container-runner.js';

// CAP-089 / story 018-006: async setup container runner.

describe('buildSetupScript', () => {
  it('prepends the safety header', () => {
    const script = buildSetupScript(['echo hi']);
    expect(script.startsWith('set -euxo pipefail')).toBe(true);
  });

  it('joins multiple commands with newlines', () => {
    const script = buildSetupScript(['pnpm install', 'pnpm build']);
    expect(script).toContain('pnpm install');
    expect(script).toContain('pnpm build');
  });
});

function makeMockRun(
  behavior:
    | { exitCode: number; output: string }
    | { throws: Error }
    | { hang: true },
): DockerRunFn {
  return vi.fn().mockImplementation(async (args) => {
    if ('throws' in behavior) throw behavior.throws;
    if ('hang' in behavior) {
      return new Promise((_, reject) => {
        const handler = (): void => reject(new Error('Aborted by signal'));
        args.signal?.addEventListener('abort', handler);
      });
    }
    return behavior;
  });
}

describe('runSetupContainer', () => {
  const baseInput = {
    commands: ['pnpm install'],
    workspaceHostPath: '/host/workspace',
    image: 'node:22',
    networkMode: 'claude-restricted',
  };

  it('rejects an empty command list', async () => {
    const run = vi.fn();
    const outcome = await runSetupContainer(run, { ...baseInput, commands: [] });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('empty_commands');
    expect(run).not.toHaveBeenCalled();
  });

  it('passes the expected args to docker.run()', async () => {
    const run = makeMockRun({ exitCode: 0, output: 'ok' });
    await runSetupContainer(run, {
      ...baseInput,
      env: { NODE_ENV: 'test' },
      timeoutSeconds: 120,
    });
    const call = (run as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as Record<string, unknown>;
    expect(call.image).toBe('node:22');
    expect(call.networkMode).toBe('claude-restricted');
    expect(call.workdir).toBe('/workspace');
    expect(call.binds).toEqual(['/host/workspace:/workspace:rw']);
    expect(call.env).toEqual(['NODE_ENV=test']);
    expect(call.timeoutMs).toBe(120_000);
    expect(call.command).toEqual([
      'bash',
      '-c',
      expect.stringContaining('set -euxo pipefail') as unknown as string,
    ]);
  });

  it('clamps timeoutSeconds to 30 minutes', async () => {
    const run = makeMockRun({ exitCode: 0, output: '' });
    await runSetupContainer(run, { ...baseInput, timeoutSeconds: 9999 });
    const call = (run as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as Record<string, unknown>;
    expect(call.timeoutMs).toBe(1800 * 1000);
  });

  it('defaults timeoutSeconds to 300', async () => {
    const run = makeMockRun({ exitCode: 0, output: '' });
    await runSetupContainer(run, baseInput);
    const call = (run as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as Record<string, unknown>;
    expect(call.timeoutMs).toBe(300_000);
  });

  it('returns ok on exit 0', async () => {
    const run = makeMockRun({ exitCode: 0, output: 'installed 42 packages' });
    const outcome = await runSetupContainer(run, baseInput);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.exitCode).toBe(0);
      expect(outcome.result.output).toContain('installed');
    }
  });

  it('returns non_zero_exit on non-zero exit code', async () => {
    const run = makeMockRun({ exitCode: 2, output: 'lint failed' });
    const outcome = await runSetupContainer(run, baseInput);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('non_zero_exit');
      expect(outcome.result?.exitCode).toBe(2);
      expect(outcome.detail).toContain('code 2');
    }
  });

  it('returns timeout when docker rejects with a timeout message', async () => {
    const run = makeMockRun({ throws: new Error('Container run timed out after 5 minutes') });
    const outcome = await runSetupContainer(run, baseInput);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('timeout');
  });

  it('returns docker_error on generic errors', async () => {
    const run = makeMockRun({ throws: new Error('docker daemon unreachable') });
    const outcome = await runSetupContainer(run, baseInput);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('docker_error');
  });

  it('truncates output over 64 KB', async () => {
    const huge = 'x'.repeat(100 * 1024);
    const run = makeMockRun({ exitCode: 0, output: huge });
    const outcome = await runSetupContainer(run, baseInput);
    if (outcome.ok) {
      expect(outcome.result.output.length).toBeLessThan(100 * 1024);
      expect(outcome.result.output).toContain('truncated');
    }
  });
});
