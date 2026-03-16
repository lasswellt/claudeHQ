import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import pino from 'pino';
import { cloneRepo, fetchRepo, createWorktree, isGitRepo } from './git-ops.js';

const log = pino({ name: 'workspace-provisioner' });

export interface ProvisionOptions {
  workspaceId: string;
  repoUrl: string;
  branch: string;
  createBranch?: string;
  setupCommands: string[];
  clonePath: string;
  useWorktree: boolean;
}

export interface ProvisionResult {
  path: string;
  branch: string;
  diskUsageBytes: number;
}

export async function provisionWorkspace(opts: ProvisionOptions): Promise<ProvisionResult> {
  const basePath = opts.clonePath.replace(/\/[^/]+$/, ''); // parent directory
  const repoDir = `${basePath}/_repo`;

  // Step 1: Clone if not already cloned
  if (!isGitRepo(repoDir)) {
    log.info({ repoUrl: opts.repoUrl, repoDir }, 'Cloning repository');
    if (!existsSync(basePath)) mkdirSync(basePath, { recursive: true });
    cloneRepo(opts.repoUrl, repoDir);
  } else {
    log.info({ repoDir }, 'Repository already cloned, fetching');
    fetchRepo(repoDir);
  }

  // Step 2: Create workspace (worktree or branch checkout)
  const workspacePath = opts.clonePath;
  const branchName = opts.createBranch ?? `chq/${opts.workspaceId}`;

  if (opts.useWorktree) {
    createWorktree(repoDir, workspacePath, branchName);
  } else {
    if (!existsSync(workspacePath)) mkdirSync(workspacePath, { recursive: true });
    // Simple clone into workspace path
    cloneRepo(opts.repoUrl, workspacePath, { branch: opts.branch });
  }

  // Step 3: Run setup commands
  for (const cmd of opts.setupCommands) {
    log.info({ cmd, cwd: workspacePath }, 'Running setup command');
    try {
      execSync(cmd, { cwd: workspacePath, encoding: 'utf-8', timeout: 300000 });
    } catch (err) {
      log.error({ cmd, err }, 'Setup command failed');
      throw new Error(`Setup command failed: ${cmd}`);
    }
  }

  // Step 4: Get disk usage
  let diskUsageBytes = 0;
  try {
    const output = execSync(`du -sb "${workspacePath}" | cut -f1`, {
      encoding: 'utf-8',
    }).trim();
    diskUsageBytes = parseInt(output, 10) || 0;
  } catch {
    // Best effort
  }

  return {
    path: workspacePath,
    branch: branchName,
    diskUsageBytes,
  };
}

export function detectPackageManager(workspacePath: string): string | null {
  if (existsSync(`${workspacePath}/pnpm-lock.yaml`)) return 'pnpm';
  if (existsSync(`${workspacePath}/yarn.lock`)) return 'yarn';
  if (existsSync(`${workspacePath}/package-lock.json`)) return 'npm';
  if (existsSync(`${workspacePath}/bun.lockb`) || existsSync(`${workspacePath}/bun.lock`)) return 'bun';
  if (existsSync(`${workspacePath}/Cargo.toml`)) return 'cargo';
  if (existsSync(`${workspacePath}/go.mod`)) return 'go';
  if (existsSync(`${workspacePath}/requirements.txt`) || existsSync(`${workspacePath}/pyproject.toml`)) return 'pip';
  return null;
}

export function detectNodeVersion(workspacePath: string): string | null {
  for (const file of ['.nvmrc', '.node-version']) {
    try {
      const version = execSync(`cat "${workspacePath}/${file}"`, { encoding: 'utf-8' }).trim();
      if (version) return version;
    } catch {
      // Not found
    }
  }
  return null;
}
