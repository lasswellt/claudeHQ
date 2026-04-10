import { describe, it, expect } from 'vitest';
import {
  workspaceStatusSchema,
  workspaceRecordSchema,
  jobStatusSchema,
  jobRecordSchema,
  repoRecordSchema,
  hubWorkspaceProvisionMsg,
  hubWorkspaceCleanupMsg,
  agentWorkspaceReadyMsg,
  agentWorkspaceErrorMsg,
  hubContainerCreateMsg,
  hubContainerStopMsg,
  hubContainerRemoveMsg,
  agentContainerCreatedMsg,
  agentContainerStartedMsg,
  agentContainerStdoutMsg,
  agentContainerExitedMsg,
  agentContainerStatsMsg,
  agentContainerErrorMsg,
  type WorkspaceStatus,
  type JobStatus,
} from '../workforce.js';

// ── Type exports ─────────────────────────────────────────────

describe('WorkspaceStatus type export', () => {
  it('should be assignable from valid status strings', () => {
    const status: WorkspaceStatus = 'ready';
    expect(status).toBe('ready');
  });
});

describe('JobStatus type export', () => {
  it('should be assignable from valid status strings', () => {
    const status: JobStatus = 'running';
    expect(status).toBe('running');
  });
});

// ── workspaceStatusSchema ────────────────────────────────────

describe('workspaceStatusSchema', () => {
  it('should accept all valid workspace statuses', () => {
    const validStatuses = ['creating', 'preparing', 'ready', 'active', 'stale', 'cleanup', 'deleted'];
    for (const status of validStatuses) {
      expect(workspaceStatusSchema.parse(status)).toBe(status);
    }
  });

  it('should reject an unknown workspace status', () => {
    const result = workspaceStatusSchema.safeParse('provisioning');
    expect(result.success).toBe(false);
  });

  it('should reject an empty string', () => {
    const result = workspaceStatusSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('should reject a numeric value', () => {
    const result = workspaceStatusSchema.safeParse(1);
    expect(result.success).toBe(false);
  });
});

// ── jobStatusSchema ──────────────────────────────────────────

describe('jobStatusSchema', () => {
  it('should accept all valid job statuses', () => {
    const validStatuses = [
      'pending', 'provisioning', 'preparing', 'running',
      'post_processing', 'completed', 'failed', 'cancelled',
    ];
    for (const status of validStatuses) {
      expect(jobStatusSchema.parse(status)).toBe(status);
    }
  });

  it('should reject an unknown job status', () => {
    const result = jobStatusSchema.safeParse('queued');
    expect(result.success).toBe(false);
  });

  it('should reject an empty string', () => {
    const result = jobStatusSchema.safeParse('');
    expect(result.success).toBe(false);
  });
});

// ── repoRecordSchema ─────────────────────────────────────────

describe('repoRecordSchema', () => {
  const minimalValid = {
    id: 'repo-1',
    url: 'git@github.com:acme/api.git',
    name: 'api',
    created_at: 1710000000,
  };

  it('should parse a minimal valid repo record with defaults', () => {
    const result = repoRecordSchema.parse(minimalValid);
    expect(result.default_branch).toBe('main');
    expect(result.auth_method).toBe('ssh_key');
  });

  it('should parse a fully specified repo record', () => {
    const result = repoRecordSchema.parse({
      ...minimalValid,
      owner: 'acme',
      default_branch: 'develop',
      auth_method: 'github_app',
      auth_credential_ref: 'cred-abc',
      preferred_machine_id: 'studio-pc',
      dependency_manager: 'pnpm',
      node_version: '20',
      setup_commands: ['pnpm install'],
      pre_flight_commands: ['pnpm build'],
      post_flight_commands: ['pnpm test'],
      env_vars: { NODE_ENV: 'test' },
      tags: ['backend'],
      last_synced_at: 1710005000,
    });
    expect(result.auth_method).toBe('github_app');
    expect(result.setup_commands).toEqual(['pnpm install']);
    expect(result.env_vars).toEqual({ NODE_ENV: 'test' });
  });

  it('should accept all valid auth methods', () => {
    const validMethods = ['ssh_key', 'token', 'github_app'];
    for (const auth_method of validMethods) {
      const result = repoRecordSchema.safeParse({ ...minimalValid, auth_method });
      expect(result.success).toBe(true);
    }
  });

  it('should reject an invalid auth method', () => {
    const result = repoRecordSchema.safeParse({ ...minimalValid, auth_method: 'oauth' });
    expect(result.success).toBe(false);
  });

  it('should reject when required fields are missing', () => {
    const result = repoRecordSchema.safeParse({ id: 'repo-1' });
    expect(result.success).toBe(false);
  });
});

// ── workspaceRecordSchema ────────────────────────────────────

describe('workspaceRecordSchema', () => {
  const minimalValid = {
    id: 'ws-1',
    repo_id: 'repo-1',
    machine_id: 'studio-pc',
    path: '/tmp/ws-1',
    branch: 'main',
    status: 'ready',
    created_at: 1710000000,
  };

  it('should parse a minimal valid workspace record with defaults', () => {
    const result = workspaceRecordSchema.parse(minimalValid);
    expect(result.is_worktree).toBe(false);
    expect(result.job_id).toBeUndefined();
  });

  it('should parse a fully specified workspace record', () => {
    const result = workspaceRecordSchema.parse({
      ...minimalValid,
      is_worktree: true,
      job_id: 'job-1',
      disk_usage_bytes: 512000,
      deps_installed_at: 1710001000,
      last_used_at: 1710002000,
      expires_at: 1710086400,
    });
    expect(result.is_worktree).toBe(true);
    expect(result.job_id).toBe('job-1');
    expect(result.disk_usage_bytes).toBe(512000);
  });

  it('should reject an invalid workspace status', () => {
    const result = workspaceRecordSchema.safeParse({ ...minimalValid, status: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('should reject when required fields are missing', () => {
    const result = workspaceRecordSchema.safeParse({ id: 'ws-1' });
    expect(result.success).toBe(false);
  });
});

// ── jobRecordSchema ──────────────────────────────────────────

describe('jobRecordSchema', () => {
  const minimalValid = {
    id: 'job-1',
    repo_id: 'repo-1',
    title: 'Fix the login bug',
    prompt: 'Users cannot log in with special characters in passwords.',
    status: 'pending',
    created_at: 1710000000,
  };

  it('should parse a minimal valid job record with defaults', () => {
    const result = jobRecordSchema.parse(minimalValid);
    expect(result.cost_usd).toBe(0);
    expect(result.tokens_used).toBe(0);
    expect(result.files_changed).toBe(0);
    expect(result.auto_pr).toBe(false);
    expect(result.auto_cleanup).toBe(false);
  });

  it('should parse a fully specified job record', () => {
    const result = jobRecordSchema.parse({
      ...minimalValid,
      workspace_id: 'ws-1',
      machine_id: 'studio-pc',
      branch: 'fix/login-bug',
      branch_created: 'fix/login-bug',
      status: 'completed',
      pr_number: 42,
      pr_url: 'https://github.com/acme/api/pull/42',
      github_issue_number: 10,
      cost_usd: 0.5,
      tokens_used: 8000,
      files_changed: 3,
      tests_passed: true,
      error_message: undefined,
      parent_job_id: 'job-0',
      timeout_seconds: 3600,
      max_cost_usd: 5.0,
      auto_pr: true,
      auto_cleanup: true,
      tags: ['auth', 'bug'],
      started_at: 1710001000,
      ended_at: 1710002000,
    });
    expect(result.pr_number).toBe(42);
    expect(result.tests_passed).toBe(true);
    expect(result.auto_pr).toBe(true);
    expect(result.tags).toEqual(['auth', 'bug']);
  });

  it('should accept all valid job statuses', () => {
    const validStatuses = [
      'pending', 'provisioning', 'preparing', 'running',
      'post_processing', 'completed', 'failed', 'cancelled',
    ];
    for (const status of validStatuses) {
      const result = jobRecordSchema.safeParse({ ...minimalValid, status });
      expect(result.success).toBe(true);
    }
  });

  it('should reject an invalid job status', () => {
    const result = jobRecordSchema.safeParse({ ...minimalValid, status: 'queued' });
    expect(result.success).toBe(false);
  });

  it('should reject when required fields are missing', () => {
    const result = jobRecordSchema.safeParse({ id: 'job-1' });
    expect(result.success).toBe(false);
  });

  it('should reject when title is missing', () => {
    const { title: _title, ...withoutTitle } = minimalValid;
    const result = jobRecordSchema.safeParse(withoutTitle);
    expect(result.success).toBe(false);
  });
});

// ── Workspace protocol messages ──────────────────────────────

describe('hubWorkspaceProvisionMsg', () => {
  it('should parse a valid hub:workspace:provision message with defaults', () => {
    const msg = hubWorkspaceProvisionMsg.parse({
      type: 'hub:workspace:provision',
      workspaceId: 'ws-1',
      repoUrl: 'git@github.com:acme/api.git',
      branch: 'main',
      setupCommands: ['pnpm install'],
      clonePath: '/tmp/ws-1',
    });
    expect(msg.type).toBe('hub:workspace:provision');
    expect(msg.useWorktree).toBe(false);
    expect(msg.createBranch).toBeUndefined();
  });

  it('should parse with all optional fields', () => {
    const msg = hubWorkspaceProvisionMsg.parse({
      type: 'hub:workspace:provision',
      workspaceId: 'ws-1',
      repoUrl: 'git@github.com:acme/api.git',
      branch: 'main',
      createBranch: 'feature/new-branch',
      setupCommands: ['pnpm install', 'pnpm build'],
      clonePath: '/tmp/ws-1',
      useWorktree: true,
    });
    expect(msg.useWorktree).toBe(true);
    expect(msg.createBranch).toBe('feature/new-branch');
    expect(msg.setupCommands).toHaveLength(2);
  });

  it('should reject when required fields are missing', () => {
    const result = hubWorkspaceProvisionMsg.safeParse({
      type: 'hub:workspace:provision',
      workspaceId: 'ws-1',
    });
    expect(result.success).toBe(false);
  });

  it('should reject a wrong type literal', () => {
    const result = hubWorkspaceProvisionMsg.safeParse({
      type: 'hub:workspace:create',
      workspaceId: 'ws-1',
      repoUrl: 'git@github.com:acme/api.git',
      branch: 'main',
      setupCommands: [],
      clonePath: '/tmp/ws-1',
    });
    expect(result.success).toBe(false);
  });
});

describe('hubWorkspaceCleanupMsg', () => {
  it('should parse a valid hub:workspace:cleanup message', () => {
    const msg = hubWorkspaceCleanupMsg.parse({
      type: 'hub:workspace:cleanup',
      workspaceId: 'ws-1',
      path: '/tmp/ws-1',
    });
    expect(msg.type).toBe('hub:workspace:cleanup');
    expect(msg.workspaceId).toBe('ws-1');
  });

  it('should reject when path is missing', () => {
    const result = hubWorkspaceCleanupMsg.safeParse({
      type: 'hub:workspace:cleanup',
      workspaceId: 'ws-1',
    });
    expect(result.success).toBe(false);
  });
});

describe('agentWorkspaceReadyMsg', () => {
  it('should parse a valid agent:workspace:ready message', () => {
    const msg = agentWorkspaceReadyMsg.parse({
      type: 'agent:workspace:ready',
      workspaceId: 'ws-1',
      path: '/tmp/ws-1',
      branch: 'main',
      diskUsageBytes: 204800,
    });
    expect(msg.type).toBe('agent:workspace:ready');
    expect(msg.diskUsageBytes).toBe(204800);
  });

  it('should reject when diskUsageBytes is missing', () => {
    const result = agentWorkspaceReadyMsg.safeParse({
      type: 'agent:workspace:ready',
      workspaceId: 'ws-1',
      path: '/tmp/ws-1',
      branch: 'main',
    });
    expect(result.success).toBe(false);
  });
});

describe('agentWorkspaceErrorMsg', () => {
  it('should parse a valid agent:workspace:error message', () => {
    const msg = agentWorkspaceErrorMsg.parse({
      type: 'agent:workspace:error',
      workspaceId: 'ws-1',
      error: 'Failed to clone repository',
      phase: 'clone',
    });
    expect(msg.type).toBe('agent:workspace:error');
    expect(msg.phase).toBe('clone');
  });

  it('should reject when error or phase is missing', () => {
    const result = agentWorkspaceErrorMsg.safeParse({
      type: 'agent:workspace:error',
      workspaceId: 'ws-1',
    });
    expect(result.success).toBe(false);
  });
});

// ── Container protocol messages ──────────────────────────────

describe('hubContainerCreateMsg', () => {
  it('should parse a minimal hub:container:create message with defaults', () => {
    const msg = hubContainerCreateMsg.parse({
      type: 'hub:container:create',
      jobId: 'job-1',
      repoId: 'repo-1',
      repoUrl: 'git@github.com:acme/api.git',
      branch: 'main',
      prompt: 'Fix the bug',
    });
    expect(msg.type).toBe('hub:container:create');
    expect(msg.setupCommands).toEqual([]);
    expect(msg.preFlightCommands).toEqual([]);
    expect(msg.env).toEqual({});
  });

  it('should parse with all optional arrays populated', () => {
    const msg = hubContainerCreateMsg.parse({
      type: 'hub:container:create',
      jobId: 'job-1',
      repoId: 'repo-1',
      repoUrl: 'git@github.com:acme/api.git',
      branch: 'main',
      prompt: 'Run tests and fix failures',
      setupCommands: ['pnpm install'],
      preFlightCommands: ['pnpm build'],
      env: { CI: 'true', NODE_ENV: 'test' },
    });
    expect(msg.setupCommands).toEqual(['pnpm install']);
    expect(msg.env).toEqual({ CI: 'true', NODE_ENV: 'test' });
  });

  it('should reject when jobId is missing', () => {
    const result = hubContainerCreateMsg.safeParse({
      type: 'hub:container:create',
      repoId: 'repo-1',
      repoUrl: 'git@github.com:acme/api.git',
      branch: 'main',
      prompt: 'Fix the bug',
    });
    expect(result.success).toBe(false);
  });

  it('should reject when prompt is missing', () => {
    const result = hubContainerCreateMsg.safeParse({
      type: 'hub:container:create',
      jobId: 'job-1',
      repoId: 'repo-1',
      repoUrl: 'git@github.com:acme/api.git',
      branch: 'main',
    });
    expect(result.success).toBe(false);
  });
});

describe('hubContainerStopMsg', () => {
  it('should parse a valid hub:container:stop message', () => {
    const msg = hubContainerStopMsg.parse({
      type: 'hub:container:stop',
      containerId: 'ctr-abcdef',
    });
    expect(msg.type).toBe('hub:container:stop');
    expect(msg.containerId).toBe('ctr-abcdef');
  });

  it('should reject when containerId is missing', () => {
    const result = hubContainerStopMsg.safeParse({ type: 'hub:container:stop' });
    expect(result.success).toBe(false);
  });
});

describe('hubContainerRemoveMsg', () => {
  it('should parse a valid hub:container:remove message', () => {
    const msg = hubContainerRemoveMsg.parse({
      type: 'hub:container:remove',
      containerId: 'ctr-abcdef',
    });
    expect(msg.type).toBe('hub:container:remove');
    expect(msg.containerId).toBe('ctr-abcdef');
  });

  it('should reject a wrong type literal', () => {
    const result = hubContainerRemoveMsg.safeParse({
      type: 'hub:container:delete',
      containerId: 'ctr-abcdef',
    });
    expect(result.success).toBe(false);
  });
});

describe('agentContainerCreatedMsg', () => {
  it('should parse a valid agent:container:created message', () => {
    const msg = agentContainerCreatedMsg.parse({
      type: 'agent:container:created',
      jobId: 'job-1',
      containerId: 'ctr-abcdef',
    });
    expect(msg.type).toBe('agent:container:created');
    expect(msg.jobId).toBe('job-1');
    expect(msg.containerId).toBe('ctr-abcdef');
  });

  it('should reject when containerId is missing', () => {
    const result = agentContainerCreatedMsg.safeParse({
      type: 'agent:container:created',
      jobId: 'job-1',
    });
    expect(result.success).toBe(false);
  });
});

describe('agentContainerStartedMsg', () => {
  it('should parse a valid agent:container:started message', () => {
    const msg = agentContainerStartedMsg.parse({
      type: 'agent:container:started',
      jobId: 'job-1',
      containerId: 'ctr-abcdef',
    });
    expect(msg.type).toBe('agent:container:started');
  });

  it('should reject when jobId is missing', () => {
    const result = agentContainerStartedMsg.safeParse({
      type: 'agent:container:started',
      containerId: 'ctr-abcdef',
    });
    expect(result.success).toBe(false);
  });
});

describe('agentContainerStdoutMsg', () => {
  it('should parse a valid agent:container:stdout message', () => {
    const msg = agentContainerStdoutMsg.parse({
      type: 'agent:container:stdout',
      containerId: 'ctr-abcdef',
      data: 'Running tests...\n',
    });
    expect(msg.type).toBe('agent:container:stdout');
    expect(msg.data).toBe('Running tests...\n');
  });

  it('should parse with empty data string', () => {
    const result = agentContainerStdoutMsg.safeParse({
      type: 'agent:container:stdout',
      containerId: 'ctr-abcdef',
      data: '',
    });
    expect(result.success).toBe(true);
  });

  it('should reject when data is missing', () => {
    const result = agentContainerStdoutMsg.safeParse({
      type: 'agent:container:stdout',
      containerId: 'ctr-abcdef',
    });
    expect(result.success).toBe(false);
  });
});

describe('agentContainerExitedMsg', () => {
  it('should parse a valid exit with a commit hash', () => {
    const msg = agentContainerExitedMsg.parse({
      type: 'agent:container:exited',
      jobId: 'job-1',
      containerId: 'ctr-abcdef',
      exitCode: 0,
      commitHash: 'abc1234',
      filesChanged: 3,
      branch: 'fix/login-bug',
    });
    expect(msg.type).toBe('agent:container:exited');
    expect(msg.exitCode).toBe(0);
    expect(msg.commitHash).toBe('abc1234');
  });

  it('should parse a valid exit with null commitHash', () => {
    const msg = agentContainerExitedMsg.parse({
      type: 'agent:container:exited',
      jobId: 'job-1',
      containerId: 'ctr-abcdef',
      exitCode: 1,
      commitHash: null,
      filesChanged: 0,
      branch: 'main',
    });
    expect(msg.commitHash).toBeNull();
    expect(msg.exitCode).toBe(1);
  });

  it('should reject when commitHash is undefined (not null)', () => {
    const result = agentContainerExitedMsg.safeParse({
      type: 'agent:container:exited',
      jobId: 'job-1',
      containerId: 'ctr-abcdef',
      exitCode: 0,
      filesChanged: 0,
      branch: 'main',
    });
    expect(result.success).toBe(false);
  });

  it('should reject when required fields are missing', () => {
    const result = agentContainerExitedMsg.safeParse({
      type: 'agent:container:exited',
      jobId: 'job-1',
    });
    expect(result.success).toBe(false);
  });
});

describe('agentContainerStatsMsg', () => {
  it('should parse a valid agent:container:stats message', () => {
    const msg = agentContainerStatsMsg.parse({
      type: 'agent:container:stats',
      containerId: 'ctr-abcdef',
      cpuPercent: 45.2,
      memoryMB: 256.5,
      pids: 12,
    });
    expect(msg.type).toBe('agent:container:stats');
    expect(msg.cpuPercent).toBe(45.2);
    expect(msg.memoryMB).toBe(256.5);
    expect(msg.pids).toBe(12);
  });

  it('should parse stats with zero values', () => {
    const msg = agentContainerStatsMsg.parse({
      type: 'agent:container:stats',
      containerId: 'ctr-abcdef',
      cpuPercent: 0,
      memoryMB: 0,
      pids: 0,
    });
    expect(msg.cpuPercent).toBe(0);
  });

  it('should reject when cpuPercent is missing', () => {
    const result = agentContainerStatsMsg.safeParse({
      type: 'agent:container:stats',
      containerId: 'ctr-abcdef',
      memoryMB: 128,
      pids: 5,
    });
    expect(result.success).toBe(false);
  });

  it('should reject when containerId is missing', () => {
    const result = agentContainerStatsMsg.safeParse({
      type: 'agent:container:stats',
      cpuPercent: 10,
      memoryMB: 128,
      pids: 5,
    });
    expect(result.success).toBe(false);
  });
});

describe('agentContainerErrorMsg', () => {
  it('should parse a valid error message with all fields', () => {
    const msg = agentContainerErrorMsg.parse({
      type: 'agent:container:error',
      jobId: 'job-1',
      containerId: 'ctr-abcdef',
      error: 'Out of memory',
      phase: 'running',
    });
    expect(msg.type).toBe('agent:container:error');
    expect(msg.containerId).toBe('ctr-abcdef');
    expect(msg.phase).toBe('running');
  });

  it('should parse without optional containerId', () => {
    const msg = agentContainerErrorMsg.parse({
      type: 'agent:container:error',
      jobId: 'job-1',
      error: 'Failed to pull image',
      phase: 'setup',
    });
    expect(msg.containerId).toBeUndefined();
    expect(msg.error).toBe('Failed to pull image');
  });

  it('should reject when jobId is missing', () => {
    const result = agentContainerErrorMsg.safeParse({
      type: 'agent:container:error',
      error: 'Something went wrong',
      phase: 'setup',
    });
    expect(result.success).toBe(false);
  });

  it('should reject when error or phase is missing', () => {
    const result = agentContainerErrorMsg.safeParse({
      type: 'agent:container:error',
      jobId: 'job-1',
    });
    expect(result.success).toBe(false);
  });

  it('should reject a wrong type literal', () => {
    const result = agentContainerErrorMsg.safeParse({
      type: 'agent:container:failure',
      jobId: 'job-1',
      error: 'error',
      phase: 'setup',
    });
    expect(result.success).toBe(false);
  });
});
