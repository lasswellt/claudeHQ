import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import pino from 'pino';

const log = pino({ name: 'container-worktree' });

const execOpts = { encoding: 'utf-8' as const, timeout: 300000 };

export interface WorktreeInfo {
  repoId: string;
  containerId: string;
  worktreePath: string;
  branch: string;
}

/**
 * Ensures a repo is cloned to the shared repo directory.
 * Uses partial clone for efficiency.
 */
export function ensureRepoCloned(repoUrl: string, repoId: string, basePath: string): string {
  const repoDir = `${basePath}/${repoId}`;

  if (existsSync(`${repoDir}/.git`)) {
    log.info({ repoId, repoDir }, 'Repo exists, fetching');
    execFileSync('git', ['fetch', 'origin', '--prune'], { ...execOpts, cwd: repoDir });
  } else {
    log.info({ repoId, repoUrl, repoDir }, 'Cloning repo');
    if (!existsSync(basePath)) mkdirSync(basePath, { recursive: true });
    execFileSync('git', ['clone', '--filter=blob:none', '--', repoUrl, repoDir], execOpts);
  }

  return repoDir;
}

/**
 * Creates a git worktree for a container. Each container gets its own
 * branch and working directory. The .git object store is shared.
 */
export function createWorktree(
  repoDir: string,
  containerId: string,
  jobId: string,
  baseBranch: string = 'main',
): WorktreeInfo {
  const worktreeDir = `${repoDir}/worktrees`;
  if (!existsSync(worktreeDir)) mkdirSync(worktreeDir, { recursive: true });

  const worktreePath = `${worktreeDir}/${containerId}`;
  const branchName = `chq/${jobId}/${containerId.slice(0, 8)}`;

  log.info({ worktreePath, branchName, baseBranch }, 'Creating worktree');

  execFileSync('git', [
    'worktree', 'add',
    '-b', branchName,
    worktreePath,
    `origin/${baseBranch}`,
  ], { ...execOpts, cwd: repoDir });

  return {
    repoId: repoDir.replace(/\/+$/, '').split('/').pop() ?? repoDir,
    containerId,
    worktreePath,
    branch: branchName,
  };
}

/**
 * Commits all changes in a worktree, pushes, and returns the commit hash.
 * Called by the Orchestration Agent AFTER the container exits.
 */
export function commitAndPush(worktreePath: string, message: string): { commitHash: string | null; filesChanged: number } {
  try {
    execFileSync('git', ['add', '-A'], { ...execOpts, cwd: worktreePath });

    const status = (execFileSync('git', ['status', '--porcelain'], {
      ...execOpts, cwd: worktreePath,
    }) as string).trim();

    if (!status) return { commitHash: null, filesChanged: 0 };

    const filesChanged = status.split('\n').length;

    execFileSync('git', ['commit', '-m', message], { ...execOpts, cwd: worktreePath });
    const hash = (execFileSync('git', ['rev-parse', 'HEAD'], {
      ...execOpts, cwd: worktreePath,
    }) as string).trim();

    // Push the branch
    const branch = (execFileSync('git', ['branch', '--show-current'], {
      ...execOpts, cwd: worktreePath,
    }) as string).trim();

    execFileSync('git', ['push', '-u', 'origin', branch], { ...execOpts, cwd: worktreePath });

    log.info({ hash, filesChanged, branch }, 'Committed and pushed');
    return { commitHash: hash, filesChanged };
  } catch (err) {
    log.error({ err, worktreePath }, 'Failed to commit/push');
    return { commitHash: null, filesChanged: 0 };
  }
}

/**
 * Removes a worktree after the container is done.
 */
export function removeWorktree(repoDir: string, worktreePath: string): void {
  try {
    execFileSync('git', ['worktree', 'remove', worktreePath, '--force'], {
      ...execOpts, cwd: repoDir,
    });
    execFileSync('git', ['worktree', 'prune'], { ...execOpts, cwd: repoDir });
    log.info({ worktreePath }, 'Worktree removed');
  } catch (err) {
    log.warn({ err, worktreePath }, 'Failed to remove worktree');
  }
}

/**
 * Gets disk usage of a worktree directory.
 */
export function getWorktreeDiskUsage(worktreePath: string): number {
  try {
    const output = execFileSync('du', ['-sb', worktreePath], execOpts) as string;
    return parseInt(output.split('\t')[0] ?? '0', 10);
  } catch {
    return 0;
  }
}
