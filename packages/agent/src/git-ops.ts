import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import pino from 'pino';

const log = pino({ name: 'git-ops' });

const execOpts: ExecFileSyncOptions = { encoding: 'utf-8', timeout: 120000 };

export interface GitStatus {
  branch: string;
  uncommitted: number;
  ahead: number;
  behind: number;
}

export function cloneRepo(url: string, targetPath: string, options?: { depth?: number; branch?: string }): void {
  const args = ['clone'];
  if (options?.depth) args.push('--depth', String(options.depth));
  if (options?.branch) args.push('--branch', options.branch);
  args.push('--filter=blob:none', url, targetPath);

  log.info({ url, targetPath }, 'Cloning repository');
  execFileSync('git', args, execOpts);
}

export function fetchRepo(repoPath: string): void {
  execFileSync('git', ['fetch', 'origin'], { ...execOpts, cwd: repoPath });
}

export function createWorktree(basePath: string, worktreePath: string, branch: string): void {
  log.info({ basePath, worktreePath, branch }, 'Creating worktree');
  execFileSync('git', ['worktree', 'add', '-b', branch, worktreePath, 'origin/HEAD'], {
    ...execOpts,
    cwd: basePath,
  });
}

export function removeWorktree(basePath: string, worktreePath: string): void {
  execFileSync('git', ['worktree', 'remove', worktreePath, '--force'], { ...execOpts, cwd: basePath });
  execFileSync('git', ['worktree', 'prune'], { ...execOpts, cwd: basePath });
}

export function createBranch(repoPath: string, branchName: string, startPoint?: string): void {
  const args = ['checkout', '-b', branchName];
  if (startPoint) args.push(startPoint);
  execFileSync('git', args, { ...execOpts, cwd: repoPath });
}

export function checkoutBranch(repoPath: string, branch: string): void {
  execFileSync('git', ['checkout', branch], { ...execOpts, cwd: repoPath });
}

export function commitAll(repoPath: string, message: string): string | null {
  try {
    execFileSync('git', ['add', '-A'], { ...execOpts, cwd: repoPath });
    const status = execFileSync('git', ['status', '--porcelain'], { ...execOpts, cwd: repoPath }) as string;
    if (!status.trim()) return null;

    execFileSync('git', ['commit', '-m', message], { ...execOpts, cwd: repoPath });
    const hash = (execFileSync('git', ['rev-parse', 'HEAD'], { ...execOpts, cwd: repoPath }) as string).trim();
    return hash;
  } catch {
    return null;
  }
}

export function push(repoPath: string, branch: string, remote: string = 'origin'): void {
  execFileSync('git', ['push', '-u', remote, branch], { ...execOpts, cwd: repoPath });
}

export function getStatus(repoPath: string): GitStatus {
  const branch = (execFileSync('git', ['branch', '--show-current'], { ...execOpts, cwd: repoPath }) as string).trim();
  const porcelain = (execFileSync('git', ['status', '--porcelain'], { ...execOpts, cwd: repoPath }) as string).trim();
  const uncommitted = porcelain ? porcelain.split('\n').length : 0;

  let ahead = 0;
  let behind = 0;
  try {
    const revList = (execFileSync('git', ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], {
      ...execOpts, cwd: repoPath,
    }) as string).trim();
    const parts = revList.split('\t');
    ahead = parseInt(parts[0] ?? '0', 10);
    behind = parseInt(parts[1] ?? '0', 10);
  } catch {
    // No upstream configured
  }

  return { branch, uncommitted, ahead, behind };
}

export function getDiffSummary(repoPath: string, base?: string): { filesChanged: number; insertions: number; deletions: number } {
  try {
    const ref = base ?? 'HEAD~1';
    const output = (execFileSync('git', ['diff', '--stat', '--numstat', ref], { ...execOpts, cwd: repoPath }) as string).trim();
    const lines = output.split('\n').filter((l) => l.trim());
    let insertions = 0;
    let deletions = 0;
    for (const line of lines) {
      const parts = line.split('\t');
      insertions += parseInt(parts[0] ?? '0', 10) || 0;
      deletions += parseInt(parts[1] ?? '0', 10) || 0;
    }
    return { filesChanged: lines.length, insertions, deletions };
  } catch {
    return { filesChanged: 0, insertions: 0, deletions: 0 };
  }
}

export function isGitRepo(path: string): boolean {
  return existsSync(`${path}/.git`);
}
