import type Database from 'better-sqlite3';
import {
  selectBestMachine,
  type MachineSnapshot,
  type ScoredMachine,
} from './score.js';

/**
 * CAP-014 / story 014-003: atomic scheduler placement.
 *
 * Reads the current machine telemetry, picks the best candidate via
 * the pure scoring module, and atomically claims a slot for the
 * queued session. All of this runs inside a single better-sqlite3
 * `db.transaction(...)` so two concurrent placements cannot both
 * see the same free slot and race.
 *
 * Atomicity mechanism:
 *   1. Snapshot every online machine inside the transaction.
 *   2. Score and pick the winner.
 *   3. `UPDATE sessions SET status='running', machine_id=?
 *       WHERE id = ? AND status = 'queued'` — conditional update
 *      returns `changes=0` if another placement already grabbed
 *      this session, which we treat as a lost race and retry-out.
 *
 * The caller is responsible for sending `hub:session:start` to the
 * selected agent; placement only claims the DB row.
 */

export interface PlacementResult {
  ok: true;
  machineId: string;
  score: number;
}

export type PlacementFailure =
  | { ok: false; reason: 'no_eligible_machines' }
  | { ok: false; reason: 'session_already_placed' }
  | { ok: false; reason: 'session_not_queued' };

export type PlacementOutcome = PlacementResult | PlacementFailure;

export interface PlacementInput {
  sessionId: string;
  /** Optional: if set, the session requires these agent capabilities. */
  requirements?: string[];
}

/**
 * Reads a snapshot of online machines from the DB. Exposed for
 * tests so they can assert the snapshot shape without reaching
 * into prepared-statement internals.
 */
export function snapshotMachines(db: Database.Database): MachineSnapshot[] {
  const rows = db
    .prepare("SELECT * FROM machines WHERE status = 'online'")
    .all() as Record<string, unknown>[];

  const snapshots: MachineSnapshot[] = [];
  for (const m of rows) {
    const machineId = m.id as string;
    const maxSessions = (m.max_sessions as number) ?? 1;

    let capabilities: string[] = [];
    try {
      capabilities = m.capabilities ? (JSON.parse(m.capabilities as string) as string[]) : [];
    } catch {
      // malformed JSON — treat as no capabilities
    }

    // meta blob carries heartbeat telemetry; fall back to neutral
    // 50% values when the agent hasn't reported yet.
    let meta: Record<string, unknown> = {};
    try {
      meta = m.meta ? (JSON.parse(m.meta as string) as Record<string, unknown>) : {};
    } catch {
      // ignore
    }
    const cpuPercent = typeof meta.cpuPercent === 'number' ? meta.cpuPercent : 50;
    const memPercent = typeof meta.memPercent === 'number' ? meta.memPercent : 50;

    const active = (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM sessions WHERE machine_id = ? AND status = 'running'",
        )
        .get(machineId) as { c: number }
    ).c;
    const queueDepth = (
      db.prepare('SELECT COUNT(*) AS c FROM queue WHERE machine_id = ?').get(machineId) as {
        c: number;
      }
    ).c;

    snapshots.push({
      machineId,
      maxSessions,
      activeSessions: active,
      cpuPercent,
      memoryPercent: memPercent,
      queueDepth,
      capabilities,
    });
  }

  return snapshots;
}

/**
 * Atomic placement. Inside a transaction:
 *   1. Load the session and verify it is still queued.
 *   2. Snapshot machines, score, and pick a winner.
 *   3. UPDATE the session row with the winning machine_id — only
 *      if the row is still status='queued' (guards against two
 *      concurrent placements both seeing the same free slot).
 *
 * Returns a tagged union describing the outcome so callers can
 * react to each failure mode without string-matching.
 */
export function placeSession(
  db: Database.Database,
  input: PlacementInput,
): PlacementOutcome {
  const tx = db.transaction((): PlacementOutcome => {
    const session = db
      .prepare('SELECT status FROM sessions WHERE id = ?')
      .get(input.sessionId) as { status: string } | undefined;
    if (!session) {
      return { ok: false, reason: 'session_not_queued' };
    }
    if (session.status !== 'queued') {
      return { ok: false, reason: 'session_already_placed' };
    }

    const snapshots = snapshotMachines(db);
    const winner: ScoredMachine | null = selectBestMachine(snapshots, input.requirements ?? []);
    if (!winner) {
      return { ok: false, reason: 'no_eligible_machines' };
    }

    // Conditional update — if a racing placement already moved this
    // session to running, `changes` will be 0 and we abort.
    const result = db
      .prepare(
        "UPDATE sessions SET status = 'running', machine_id = ?, started_at = ? WHERE id = ? AND status = 'queued'",
      )
      .run(winner.machineId, Math.floor(Date.now() / 1000), input.sessionId);

    if (result.changes === 0) {
      return { ok: false, reason: 'session_already_placed' };
    }

    return { ok: true, machineId: winner.machineId, score: winner.score };
  });

  return tx();
}
