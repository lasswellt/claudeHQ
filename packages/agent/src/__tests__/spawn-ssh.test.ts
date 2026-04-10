import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock spawn before importing the module under test
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    kill: vi.fn(),
    stdin: null,
    stdout: null,
    stderr: null,
    pid: 99999,
  })),
}));

vi.mock('pino', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { spawn } from 'node:child_process';
import { createSshSpawn } from '../spawn-ssh.js';

const mockSpawn = vi.mocked(spawn);

function getRemoteCmd(): string {
  const call = mockSpawn.mock.calls[0];
  // The remote command is the last element of the ssh args array
  const args = call![1] as string[];
  return args[args.length - 1]!;
}

function makeAbortSignal(): AbortSignal {
  return new AbortController().signal;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Normal path construction
// ---------------------------------------------------------------------------

describe('createSshSpawn — basic remote command construction', () => {
  it('should include cd to the provided cwd in the remote command', () => {
    // Arrange
    const spawnFn = createSshSpawn({ host: 'remote.example.com' });

    // Act
    spawnFn({ command: 'claude', args: [], cwd: '/home/user/project', env: {}, signal: makeAbortSignal() });

    // Assert
    expect(getRemoteCmd()).toContain("cd '/home/user/project'");
  });

  it('should default cwd to ~ when not provided', () => {
    // Arrange
    const spawnFn = createSshSpawn({ host: 'remote.example.com' });

    // Act
    spawnFn({ command: 'claude', args: [], env: {}, signal: makeAbortSignal() });

    // Assert
    expect(getRemoteCmd()).toContain("cd '~'");
  });

  it('should include env exports in the remote command', () => {
    // Arrange
    const spawnFn = createSshSpawn({ host: 'remote.example.com' });

    // Act
    spawnFn({ command: 'claude', args: [], env: { ANTHROPIC_API_KEY: 'sk-abc123' }, signal: makeAbortSignal() });

    // Assert
    expect(getRemoteCmd()).toContain("export ANTHROPIC_API_KEY='sk-abc123'");
  });

  it('should skip env entries whose value is undefined', () => {
    // Arrange
    const spawnFn = createSshSpawn({ host: 'remote.example.com' });

    // Act
    spawnFn({ command: 'claude', args: [], env: { DEFINED: 'yes', MISSING: undefined }, signal: makeAbortSignal() });

    // Assert
    const cmd = getRemoteCmd();
    expect(cmd).toContain('DEFINED');
    expect(cmd).not.toContain('MISSING');
  });

  it('should use user@host format when user is provided', () => {
    // Arrange
    const spawnFn = createSshSpawn({ host: 'server.example.com', user: 'claude' });

    // Act
    spawnFn({ command: 'claude', args: [], env: {}, signal: makeAbortSignal() });

    // Assert
    const sshArgs = mockSpawn.mock.calls[0]![1] as string[];
    expect(sshArgs).toContain('claude@server.example.com');
  });

  it('should add -p flag when port is provided', () => {
    // Arrange
    const spawnFn = createSshSpawn({ host: 'server.example.com', port: 2222 });

    // Act
    spawnFn({ command: 'claude', args: [], env: {}, signal: makeAbortSignal() });

    // Assert
    const sshArgs = mockSpawn.mock.calls[0]![1] as string[];
    expect(sshArgs).toContain('-p');
    expect(sshArgs).toContain('2222');
  });

  it('should add -i flag when identityFile is provided', () => {
    // Arrange
    const spawnFn = createSshSpawn({ host: 'server.example.com', identityFile: '/home/user/.ssh/id_ed25519' });

    // Act
    spawnFn({ command: 'claude', args: [], env: {}, signal: makeAbortSignal() });

    // Assert
    const sshArgs = mockSpawn.mock.calls[0]![1] as string[];
    expect(sshArgs).toContain('-i');
    expect(sshArgs).toContain('/home/user/.ssh/id_ed25519');
  });
});

// ---------------------------------------------------------------------------
// Single-quote escaping in cwd
// ---------------------------------------------------------------------------

describe('createSshSpawn — cwd single-quote escaping', () => {
  it("should escape a single quote in cwd using the x'\\''y idiom", () => {
    // Arrange
    const spawnFn = createSshSpawn({ host: 'remote.example.com' });
    const cwdWithQuote = "/home/user/tom's project";

    // Act
    spawnFn({ command: 'claude', args: [], cwd: cwdWithQuote, env: {}, signal: makeAbortSignal() });

    // Assert
    const cmd = getRemoteCmd();
    // Escaped form: '/home/user/tom'\''s project'
    expect(cmd).toContain("'/home/user/tom'\\''s project'");
    // The literal path must not appear unescaped
    expect(cmd).not.toContain("cd '/home/user/tom's project'");
  });

  it('should escape multiple single quotes in cwd', () => {
    // Arrange
    const spawnFn = createSshSpawn({ host: 'remote.example.com' });
    const cwdWithMultipleQuotes = "/it's a bird's eye view";

    // Act
    spawnFn({ command: 'claude', args: [], cwd: cwdWithMultipleQuotes, env: {}, signal: makeAbortSignal() });

    // Assert
    const cmd = getRemoteCmd();
    expect(cmd).toContain("'/it'\\''s a bird'\\''s eye view'");
  });
});

// ---------------------------------------------------------------------------
// Shell metacharacter neutralization in cwd
// ---------------------------------------------------------------------------

describe('createSshSpawn — cwd shell metacharacter neutralization', () => {
  it('should wrap cwd containing semicolons in single quotes', () => {
    // Arrange
    const spawnFn = createSshSpawn({ host: 'remote.example.com' });
    const cwdWithSemicolon = '/workspace/proj; rm -rf /';

    // Act
    spawnFn({ command: 'claude', args: [], cwd: cwdWithSemicolon, env: {}, signal: makeAbortSignal() });

    // Assert — the entire path is inside single quotes, neutralizing the semicolon
    const cmd = getRemoteCmd();
    expect(cmd).toContain("cd '/workspace/proj; rm -rf /'");
  });

  it('should wrap cwd containing pipe characters in single quotes', () => {
    // Arrange
    const spawnFn = createSshSpawn({ host: 'remote.example.com' });
    const cwdWithPipe = '/workspace/proj|evil';

    // Act
    spawnFn({ command: 'claude', args: [], cwd: cwdWithPipe, env: {}, signal: makeAbortSignal() });

    // Assert
    const cmd = getRemoteCmd();
    expect(cmd).toContain("cd '/workspace/proj|evil'");
    // The pipe should not become a shell pipe
    expect(cmd).not.toMatch(/cd '[^']*'\s*\|/);
  });

  it('should wrap cwd containing dollar sign in single quotes preventing variable expansion', () => {
    // Arrange
    const spawnFn = createSshSpawn({ host: 'remote.example.com' });
    const cwdWithDollar = '/workspace/$HOME/proj';

    // Act
    spawnFn({ command: 'claude', args: [], cwd: cwdWithDollar, env: {}, signal: makeAbortSignal() });

    // Assert — single-quoted: $ is not expanded
    const cmd = getRemoteCmd();
    expect(cmd).toContain("cd '/workspace/$HOME/proj'");
  });

  it('should wrap cwd containing backticks in single quotes preventing command substitution', () => {
    // Arrange
    const spawnFn = createSshSpawn({ host: 'remote.example.com' });
    const cwdWithBacktick = '/workspace/`id`/proj';

    // Act
    spawnFn({ command: 'claude', args: [], cwd: cwdWithBacktick, env: {}, signal: makeAbortSignal() });

    // Assert
    const cmd = getRemoteCmd();
    expect(cmd).toContain("cd '/workspace/`id`/proj'");
  });

  it('should wrap cwd containing spaces in single quotes', () => {
    // Arrange
    const spawnFn = createSshSpawn({ host: 'remote.example.com' });
    const cwdWithSpace = '/home/with spaces/project';

    // Act
    spawnFn({ command: 'claude', args: [], cwd: cwdWithSpace, env: {}, signal: makeAbortSignal() });

    // Assert
    const cmd = getRemoteCmd();
    expect(cmd).toContain("cd '/home/with spaces/project'");
  });

  it('should wrap cwd containing ampersand in single quotes', () => {
    // Arrange
    const spawnFn = createSshSpawn({ host: 'remote.example.com' });
    const cwdWithAmpersand = '/workspace/project && rm -rf /';

    // Act
    spawnFn({ command: 'claude', args: [], cwd: cwdWithAmpersand, env: {}, signal: makeAbortSignal() });

    // Assert
    const cmd = getRemoteCmd();
    expect(cmd).toContain("cd '/workspace/project && rm -rf /'");
  });
});

// ---------------------------------------------------------------------------
// Env value escaping
// ---------------------------------------------------------------------------

describe('createSshSpawn — env value single-quote escaping', () => {
  it("should escape single quotes in env values", () => {
    // Arrange
    const spawnFn = createSshSpawn({ host: 'remote.example.com' });

    // Act
    spawnFn({
      command: 'claude',
      args: [],
      env: { MSG: "she said 'hello'" },
      signal: makeAbortSignal(),
    });

    // Assert
    const cmd = getRemoteCmd();
    expect(cmd).toContain("export MSG='she said '\\''hello'\\'''");
  });
});

// ---------------------------------------------------------------------------
// Abort signal wires up process kill
// ---------------------------------------------------------------------------

describe('createSshSpawn — abort signal handling', () => {
  it('should kill the spawned process when the abort signal fires', () => {
    // Arrange
    const controller = new AbortController();
    const spawnFn = createSshSpawn({ host: 'remote.example.com' });
    const proc = spawnFn({ command: 'claude', args: [], env: {}, signal: controller.signal });

    // Act
    controller.abort();

    // Assert
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
