/**
 * CAP-014 / story 014-002: pure scheduler scoring module.
 *
 * No database access. Given a snapshot of machine telemetry, returns
 * the score the scheduler uses to rank candidates. The scoring
 * formula is fixed by the epic's acceptance criterion:
 *
 *   score = (maxSessions - active) * 10
 *         + (100 - cpuPercent)
 *         + (100 - memoryPercent)
 *         - (queueDepth * 5)
 *
 * Keeping this pure means the full scoring decision can be unit
 * tested against fixture snapshots without standing up a DB.
 */

export interface MachineSnapshot {
  machineId: string;
  maxSessions: number;
  activeSessions: number;
  cpuPercent: number;
  memoryPercent: number;
  queueDepth: number;
  /** JSON-decoded capabilities advertised by the agent. */
  capabilities: string[];
}

export interface ScoredMachine {
  machineId: string;
  score: number;
  freeSlots: number;
  cpuPercent: number;
  memoryPercent: number;
  queueDepth: number;
}

/** Score a single machine snapshot. */
export function scoreMachine(snapshot: MachineSnapshot): ScoredMachine {
  const freeSlots = Math.max(0, snapshot.maxSessions - snapshot.activeSessions);
  const score =
    freeSlots * 10 +
    (100 - snapshot.cpuPercent) +
    (100 - snapshot.memoryPercent) -
    snapshot.queueDepth * 5;

  return {
    machineId: snapshot.machineId,
    score,
    freeSlots,
    cpuPercent: snapshot.cpuPercent,
    memoryPercent: snapshot.memoryPercent,
    queueDepth: snapshot.queueDepth,
  };
}

/**
 * Pick the best machine for a task with optional capability
 * requirements. Returns `null` if no candidate has the required
 * capabilities AND at least one free slot.
 *
 * Ties are broken deterministically by machineId so snapshots with
 * identical scores produce the same placement every time — important
 * for test reproducibility.
 */
export function selectBestMachine(
  snapshots: readonly MachineSnapshot[],
  requirements: readonly string[] = [],
): ScoredMachine | null {
  const eligible = snapshots.filter((s) => {
    if (requirements.length === 0) return true;
    // Every requirement must be satisfied by the machine's capabilities.
    return requirements.every((r) => s.capabilities.includes(r));
  });

  const scored = eligible
    .map(scoreMachine)
    .filter((s) => s.freeSlots > 0);

  if (scored.length === 0) return null;

  // Primary sort: score desc. Tiebreak: machineId asc for stability.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.machineId.localeCompare(b.machineId);
  });

  return scored[0] ?? null;
}

/**
 * Compute the exponential-backoff delay for a retry attempt.
 * Used by CAP-012 re-queue logic.
 *
 *   delay = baseBackoffSeconds * 2^retryCount
 *
 * Clamped to [0, capSeconds] so runaway retries don't schedule a
 * task years into the future.
 */
export function computeBackoffSeconds(
  retryCount: number,
  baseBackoffSeconds: number,
  capSeconds = 3600,
): number {
  if (retryCount < 0) return 0;
  const delay = baseBackoffSeconds * 2 ** retryCount;
  return Math.min(Math.max(0, delay), capSeconds);
}
