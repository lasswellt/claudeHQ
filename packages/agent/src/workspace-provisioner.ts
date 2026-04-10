import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import pino from 'pino';
import { cloneRepo, fetchRepo, createWorktree, isGitRepo } from './git-ops.js';

// Allowlist of safe command prefixes — mirrors container-setup.ts to enforce
// consistent policy for host-side workspace setup.
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
    if (!isAllowedCommand(cmd)) {
      log.warn({ cmd }, 'Setup command rejected — not in allowlist');
      throw new Error(`Setup command rejected (not in allowlist): ${cmd}`);
    }
    log.info({ cmd, cwd: workspacePath }, 'Running setup command');
    // Split into executable + args to avoid shell interpretation
    const [executable, ...args] = cmd.trim().split(/\s+/);
    try {
      execFileSync(executable!, args, { cwd: workspacePath, encoding: 'utf-8', timeout: 300000 });
    } catch (err) {
      log.error({ cmd, err }, 'Setup command failed');
      throw new Error(`Setup command failed: ${cmd}`);
    }
  }

  // Step 4: Get disk usage
  let diskUsageBytes = 0;
  try {
    // Use execFileSync with argument array to avoid shell injection via workspacePath
    const output = execFileSync('du', ['-sb', workspacePath], {
      encoding: 'utf-8',
    }).trim();
    // du output format: "<bytes>\t<path>" — extract only the first field
    diskUsageBytes = parseInt(output.split('\t')[0] ?? '0', 10) || 0;
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
      // Use readFileSync directly — avoids shell injection via workspacePath or filename
      const version = readFileSync(`${workspacePath}/${file}`, 'utf-8').trim();
      if (version) return version;
    } catch {
      // Not found
    }
  }
  return null;
}
