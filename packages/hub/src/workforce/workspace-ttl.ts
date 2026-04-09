import type Database from 'better-sqlite3';

/**
 * CAP-050 / story 016-001: workspace TTL + max-per-machine cap.
 *
 * Pure-ish module. Two responsibilities:
 *
 *   1. `detectStale(db, opts)` — finds ready workspaces whose
 *      `idle_since` has exceeded the configured TTL and returns
 *      the list. Idempotent read.
 *
 *   2. `transitionStale(db, workspaceIds)` — moves the given
 *      workspaces through the state machine:
 *        ready → stale (after TTL)
 *        stale → cleanup (after 2 * TTL so the user can rescue)
 *        cleanup → deleted (caller actually removes files)
 *
 *   3. `checkMaxPerMachine(db, machineId, max)` — returns the
 *      current non-deleted workspace count for the machine so the
 *      provisioner can reject creates that would exceed `max`.
 *
 * Tests exercise each transition with fake clock + synthetic rows.
 */

export type WorkspaceStatus =
  | 'creating'
  | 'preparing'
  | 'ready'
  | 'active'
  | 'stale'
  | 'cleanup'
  | 'deleted';

export interface WorkspaceRow {
  id: string;
  repo_id: string;
  machine_id: string;
  status: WorkspaceStatus;
  idle_since: number | null;
  created_at: number;
  last_used_at: number | null;
}

export interface TtlOptions {
  /** Seconds after idle_since before ready → stale. */
  readyToStaleSeconds: number;
  /** Additional seconds after stale before stale → cleanup. */
  staleToCleanupSeconds: number;
  /** Injectable clock in seconds; defaults to Date.now()/1000. */
  now?: () => number;
}

export interface DetectResult {
  readyToStale: WorkspaceRow[];
  staleToCleanup: WorkspaceRow[];
}

/**
 * Reads candidate workspaces and partitions them by the transition
 * they should undergo. Neither function call mutates the DB; that
 * happens in `transitionStale`.
 */
export function detectStale(db: Database.Database, opts: TtlOptions): DetectResult {
  const now = (opts.now ?? (() => Math.floor(Date.now() / 1000)))();
  const readyCutoff = now - opts.readyToStaleSeconds;
  const staleCutoff = now - opts.readyToStaleSeconds - opts.staleToCleanupSeconds;

  const readyRows = db
    .prepare(
      `SELECT id, repo_id, machine_id, status, idle_since, created_at, last_used_at
       FROM workspaces
       WHERE status = 'ready'
         AND idle_since IS NOT NULL
         AND idle_since <= ?`,
    )
    .all(readyCutoff) as WorkspaceRow[];

  const staleRows = db
    .prepare(
      `SELECT id, repo_id, machine_id, status, idle_since, created_at, last_used_at
       FROM workspaces
       WHERE status = 'stale'
         AND idle_since IS NOT NULL
         AND idle_since <= ?`,
    )
    .all(staleCutoff) as WorkspaceRow[];

  return {
    readyToStale: readyRows,
    staleToCleanup: staleRows,
  };
}

/**
 * Applies the transitions detected above in a single transaction
 * so a concurrent create cannot re-ready a workspace we're about
 * to delete.
 */
export function transitionStale(
  db: Database.Database,
  detect: DetectResult,
): { becameStale: number; becameCleanup: number } {
  const updateStaleStmt = db.prepare(
    "UPDATE workspaces SET status = 'stale' WHERE id = ? AND status = 'ready'",
  );
  const updateCleanupStmt = db.prepare(
    "UPDATE workspaces SET status = 'cleanup' WHERE id = ? AND status = 'stale'",
  );

  let becameStale = 0;
  let becameCleanup = 0;

  const tx = db.transaction(() => {
    for (const w of detect.readyToStale) {
      const result = updateStaleStmt.run(w.id);
      becameStale += result.changes;
    }
    for (const w of detect.staleToCleanup) {
      const result = updateCleanupStmt.run(w.id);
      becameCleanup += result.changes;
    }
  });
  tx();

  return { becameStale, becameCleanup };
}

/**
 * Marks the given workspace as deleted. Called by the sweeper
 * after the filesystem cleanup step succeeds (that step lives
 * in the agent, not here).
 */
export function markDeleted(db: Database.Database, workspaceId: string): boolean {
  const result = db
    .prepare("UPDATE workspaces SET status = 'deleted' WHERE id = ? AND status = 'cleanup'")
    .run(workspaceId);
  return result.changes > 0;
}

/**
 * Returns the current non-deleted workspace count for a machine.
 * The provisioner compares this to the configured per-machine
 * cap before creating a new workspace.
 */
export function countActiveWorkspaces(
  db: Database.Database,
  machineId: string,
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM workspaces
       WHERE machine_id = ? AND status NOT IN ('deleted', 'cleanup')`,
    )
    .get(machineId) as { c: number };
  return row.c;
}

/**
 * Guard called by the provisioner. Returns whether a new workspace
 * may be created on the given machine. When false, the caller
 * should return 409 Conflict / `max_workspaces_reached`.
 */
export function canProvisionOnMachine(
  db: Database.Database,
  machineId: string,
  maxWorkspaces: number,
): { allowed: boolean; current: number; max: number } {
  const current = countActiveWorkspaces(db, machineId);
  return {
    allowed: current < maxWorkspaces,
    current,
    max: maxWorkspaces,
  };
}
