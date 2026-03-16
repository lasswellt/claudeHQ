import { z } from 'zod';

// ── Repository ───────────────────────────────────────────────

export const repoRecordSchema = z.object({
  id: z.string(),
  url: z.string(),
  name: z.string(),
  owner: z.string().optional(),
  default_branch: z.string().default('main'),
  auth_method: z.enum(['ssh_key', 'token', 'github_app']).default('ssh_key'),
  auth_credential_ref: z.string().optional(),
  preferred_machine_id: z.string().optional(),
  dependency_manager: z.string().optional(),
  node_version: z.string().optional(),
  setup_commands: z.array(z.string()).optional(),
  pre_flight_commands: z.array(z.string()).optional(),
  post_flight_commands: z.array(z.string()).optional(),
  env_vars: z.record(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  last_synced_at: z.number().optional(),
  created_at: z.number(),
});
export type RepoRecord = z.infer<typeof repoRecordSchema>;

// ── Workspace ────────────────────────────────────────────────

export const workspaceStatusSchema = z.enum([
  'creating', 'preparing', 'ready', 'active', 'stale', 'cleanup', 'deleted',
]);

export const workspaceRecordSchema = z.object({
  id: z.string(),
  repo_id: z.string(),
  machine_id: z.string(),
  path: z.string(),
  branch: z.string(),
  is_worktree: z.boolean().default(false),
  status: workspaceStatusSchema,
  job_id: z.string().optional(),
  disk_usage_bytes: z.number().optional(),
  deps_installed_at: z.number().optional(),
  last_used_at: z.number().optional(),
  created_at: z.number(),
  expires_at: z.number().optional(),
});
export type WorkspaceRecord = z.infer<typeof workspaceRecordSchema>;

// ── Job ──────────────────────────────────────────────────────

export const jobStatusSchema = z.enum([
  'pending', 'provisioning', 'preparing', 'running',
  'post_processing', 'completed', 'failed', 'cancelled',
]);

export const jobRecordSchema = z.object({
  id: z.string(),
  repo_id: z.string(),
  workspace_id: z.string().optional(),
  machine_id: z.string().optional(),
  title: z.string(),
  prompt: z.string(),
  branch: z.string().optional(),
  branch_created: z.string().optional(),
  status: jobStatusSchema,
  pr_number: z.number().optional(),
  pr_url: z.string().optional(),
  github_issue_number: z.number().optional(),
  cost_usd: z.number().default(0),
  tokens_used: z.number().default(0),
  files_changed: z.number().default(0),
  tests_passed: z.boolean().optional(),
  error_message: z.string().optional(),
  parent_job_id: z.string().optional(),
  timeout_seconds: z.number().optional(),
  max_cost_usd: z.number().optional(),
  auto_pr: z.boolean().default(false),
  auto_cleanup: z.boolean().default(false),
  tags: z.array(z.string()).optional(),
  started_at: z.number().optional(),
  ended_at: z.number().optional(),
  created_at: z.number(),
});
export type JobRecord = z.infer<typeof jobRecordSchema>;

// ── Workspace Protocol Messages ──────────────────────────────

export const hubWorkspaceProvisionMsg = z.object({
  type: z.literal('hub:workspace:provision'),
  workspaceId: z.string(),
  repoUrl: z.string(),
  branch: z.string(),
  createBranch: z.string().optional(),
  setupCommands: z.array(z.string()),
  clonePath: z.string(),
  useWorktree: z.boolean().default(false),
});

export const hubWorkspaceCleanupMsg = z.object({
  type: z.literal('hub:workspace:cleanup'),
  workspaceId: z.string(),
  path: z.string(),
});

export const agentWorkspaceReadyMsg = z.object({
  type: z.literal('agent:workspace:ready'),
  workspaceId: z.string(),
  path: z.string(),
  branch: z.string(),
  diskUsageBytes: z.number(),
});

export const agentWorkspaceErrorMsg = z.object({
  type: z.literal('agent:workspace:error'),
  workspaceId: z.string(),
  error: z.string(),
  phase: z.string(),
});

// ── Container Orchestration Protocol ─────────────────────────

export const hubContainerCreateMsg = z.object({
  type: z.literal('hub:container:create'),
  jobId: z.string(),
  repoId: z.string(),
  repoUrl: z.string(),
  branch: z.string(),
  prompt: z.string(),
  setupCommands: z.array(z.string()).default([]),
  preFlightCommands: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
});

export const hubContainerStopMsg = z.object({
  type: z.literal('hub:container:stop'),
  containerId: z.string(),
});

export const hubContainerRemoveMsg = z.object({
  type: z.literal('hub:container:remove'),
  containerId: z.string(),
});

export const agentContainerCreatedMsg = z.object({
  type: z.literal('agent:container:created'),
  jobId: z.string(),
  containerId: z.string(),
});

export const agentContainerStartedMsg = z.object({
  type: z.literal('agent:container:started'),
  jobId: z.string(),
  containerId: z.string(),
});

export const agentContainerStdoutMsg = z.object({
  type: z.literal('agent:container:stdout'),
  containerId: z.string(),
  data: z.string(),
});

export const agentContainerExitedMsg = z.object({
  type: z.literal('agent:container:exited'),
  jobId: z.string(),
  containerId: z.string(),
  exitCode: z.number(),
  commitHash: z.string().nullable(),
  filesChanged: z.number(),
  branch: z.string(),
});

export const agentContainerStatsMsg = z.object({
  type: z.literal('agent:container:stats'),
  containerId: z.string(),
  cpuPercent: z.number(),
  memoryMB: z.number(),
  pids: z.number(),
});

export const agentContainerErrorMsg = z.object({
  type: z.literal('agent:container:error'),
  jobId: z.string(),
  containerId: z.string().optional(),
  error: z.string(),
  phase: z.string(),
});
