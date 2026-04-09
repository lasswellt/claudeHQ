import { describe, it, expect } from 'vitest';
import {
  buildWslRemoteCommand,
  buildWslCliArgs,
  createWslSpawn,
} from '../spawn-wsl.js';

// CAP-079 / story 018-007: WSL2 spawn strategy.

describe('buildWslRemoteCommand', () => {
  it('includes cwd, env exports, command, and args', () => {
    const cmd = buildWslRemoteCommand({
      command: 'claude',
      args: ['--print', 'hello'],
      cwd: '/home/user/project',
      env: { FOO: 'bar', BAZ: 'qux' },
      signal: new AbortController().signal,
    });
    expect(cmd).toContain("export FOO='bar'");
    expect(cmd).toContain("export BAZ='qux'");
    expect(cmd).toContain("cd '/home/user/project'");
    expect(cmd).toContain("'claude'");
    expect(cmd).toContain("'--print' 'hello'");
  });

  it('escapes single quotes in values', () => {
    const cmd = buildWslRemoteCommand({
      command: 'claude',
      args: ["don't"],
      env: { MSG: "she said 'hi'" },
      signal: new AbortController().signal,
    });
    // 'don''\''t' is the escaped form
    expect(cmd).toContain("'don'\\''t'");
    expect(cmd).toContain("'she said '\\''hi'\\'''");
  });

  it('omits env exports when no env is provided', () => {
    const cmd = buildWslRemoteCommand({
      command: 'claude',
      args: [],
      env: {},
      signal: new AbortController().signal,
    });
    expect(cmd).not.toContain('export');
  });

  it('omits the cd prefix when cwd is absent', () => {
    const cmd = buildWslRemoteCommand({
      command: 'claude',
      args: [],
      env: {},
      signal: new AbortController().signal,
    });
    expect(cmd.startsWith('cd')).toBe(false);
  });

  it('skips env entries whose value is undefined', () => {
    const cmd = buildWslRemoteCommand({
      command: 'claude',
      args: [],
      env: { REAL: 'yes', MISSING: undefined },
      signal: new AbortController().signal,
    });
    expect(cmd).toContain("REAL='yes'");
    expect(cmd).not.toContain('MISSING');
  });

  it('quotes paths containing spaces', () => {
    const cmd = buildWslRemoteCommand({
      command: 'claude',
      args: [],
      cwd: '/home/with space/project',
      env: {},
      signal: new AbortController().signal,
    });
    expect(cmd).toContain("cd '/home/with space/project'");
  });
});

describe('buildWslCliArgs', () => {
  it('emits the basic invocation', () => {
    const args = buildWslCliArgs({ distro: 'Ubuntu-24.04' }, 'echo hi');
    expect(args).toEqual(['-d', 'Ubuntu-24.04', '--', 'bash', '-lc', 'echo hi']);
  });

  it('adds --user when provided', () => {
    const args = buildWslCliArgs({ distro: 'Ubuntu', user: 'claude' }, 'true');
    expect(args).toEqual([
      '-d',
      'Ubuntu',
      '--user',
      'claude',
      '--',
      'bash',
      '-lc',
      'true',
    ]);
  });
});

describe('createWslSpawn', () => {
  it('throws when distro is missing', () => {
    expect(() => createWslSpawn({ distro: '' })).toThrow(/distro/);
  });

  it('returns a callable that accepts the SpawnedProcess contract', () => {
    const spawnFn = createWslSpawn({ distro: 'Ubuntu' });
    expect(typeof spawnFn).toBe('function');
    // We don't actually invoke WSL in CI — this just asserts the
    // factory produces a stable shape.
  });
});
