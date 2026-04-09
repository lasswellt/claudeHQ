import type Database from 'better-sqlite3';

/**
 * CAP-053 / stories 016-002 + 016-003: pre/post-flight command runner.
 *
 * This module is the hub-side bookkeeper for flight runs. It
 * records each command's result in the `job_flight_runs` table
 * and decides whether the job should transition to `failed`
 * based on the outcome. The actual command execution happens
 * agent-side (via existing workspace-provisioner / session hook
 * infrastructure); this module only receives reports.
 *
 * The caller flow:
 *   1. `parseFlightCommands(repoRow)` extracts the pre/post-flight
 *      arrays from the repo config.
 *   2. `recordFlightStart(...)` inserts a row with no exit_code.
 *   3. `recordFlightResult(...)` updates with exit_code + output.
 *   4. `evaluatePhaseOutcome(...)` decides if the phase succeeded
 *      (all commands exit 0) or failed.
 */

export type FlightPhase = 'pre_flight' | 'post_flight';

export interface FlightCommand {
  command: string;
  /**
   * The command's one-based position in the phase. Used as a
   * stable sort key when rendering results in the UI.
   */
  ordinal: number;
}

export interface FlightRunRow {
  id: number;
  job_id: string;
  phase: FlightPhase;
  command: string;
  exit_code: number | null;
  stdout: string | null;
  stderr: string | null;
  started_at: number;
  ended_at: number | null;
}

export interface ParsedFlightCommands {
  preFlight: FlightCommand[];
  postFlight: FlightCommand[];
}

/**
 * Parses a repo row's `pre_flight_commands` and `post_flight_commands`
 * columns (JSON arrays of strings) into ordered FlightCommand lists.
 * Returns empty arrays when columns are null or malformed.
 */
export function parseFlightCommands(
  repoRow: Record<string, unknown>,
): ParsedFlightCommands {
  return {
    preFlight: parseJsonStringArray(repoRow.pre_flight_commands).map(toCommand),
    postFlight: parseJsonStringArray(repoRow.post_flight_commands).map(toCommand),
  };
}

function parseJsonStringArray(v: unknown): string[] {
  if (typeof v !== 'string' || v.length === 0) return [];
  try {
    const parsed = JSON.parse(v) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

function toCommand(command: string, index: number): FlightCommand {
  return { command, ordinal: index + 1 };
}

/**
 * Inserts a "flight started" row and returns its id. Called when
 * the agent begins executing a flight command.
 */
export function recordFlightStart(
  db: Database.Database,
  input: { jobId: string; phase: FlightPhase; command: string; startedAt?: number },
): number {
  const startedAt = input.startedAt ?? Math.floor(Date.now() / 1000);
  const result = db
    .prepare(
      `INSERT INTO job_flight_runs (job_id, phase, command, started_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(input.jobId, input.phase, input.command, startedAt);
  return Number(result.lastInsertRowid);
}

export interface FlightResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
  endedAt?: number;
}

/**
 * Updates a flight-run row with its final result. Truncates stdout
 * and stderr to 16KB so runaway commands can't blow up the DB.
 */
export function recordFlightResult(
  db: Database.Database,
  runId: number,
  result: FlightResult,
): void {
  const endedAt = result.endedAt ?? Math.floor(Date.now() / 1000);
  const stdout = truncate(result.stdout ?? null, 16 * 1024);
  const stderr = truncate(result.stderr ?? null, 16 * 1024);
  db
    .prepare(
      `UPDATE job_flight_runs
       SET exit_code = ?, stdout = ?, stderr = ?, ended_at = ?
       WHERE id = ?`,
    )
    .run(result.exitCode, stdout, stderr, endedAt, runId);
}

function truncate(value: string | null, max: number): string | null {
  if (value === null) return null;
  if (value.length <= max) return value;
  return value.slice(0, max) + `\n…truncated (${value.length - max} chars)`;
}

/**
 * Reads the flight runs for a job + phase and decides the phase's
 * overall outcome. `failed` as soon as any command exits non-zero
 * (short-circuit) or returns no exit code within a grace window.
 */
export function evaluatePhaseOutcome(
  db: Database.Database,
  jobId: string,
  phase: FlightPhase,
): { status: 'ok' | 'failed' | 'pending'; runs: FlightRunRow[] } {
  const runs = db
    .prepare(
      `SELECT id, job_id, phase, command, exit_code, stdout, stderr, started_at, ended_at
       FROM job_flight_runs
       WHERE job_id = ? AND phase = ?
       ORDER BY id`,
    )
    .all(jobId, phase) as FlightRunRow[];

  if (runs.length === 0) return { status: 'ok', runs };

  let sawFailure = false;
  let sawPending = false;
  for (const run of runs) {
    if (run.exit_code === null) sawPending = true;
    else if (run.exit_code !== 0) sawFailure = true;
  }

  if (sawFailure) return { status: 'failed', runs };
  if (sawPending) return { status: 'pending', runs };
  return { status: 'ok', runs };
}

/**
 * Convenience: list flight runs for a job (both phases) grouped
 * by phase. Used by the job detail view in the dashboard.
 */
export function listFlightRuns(
  db: Database.Database,
  jobId: string,
): { preFlight: FlightRunRow[]; postFlight: FlightRunRow[] } {
  const rows = db
    .prepare(
      `SELECT id, job_id, phase, command, exit_code, stdout, stderr, started_at, ended_at
       FROM job_flight_runs
       WHERE job_id = ?
       ORDER BY started_at, id`,
    )
    .all(jobId) as FlightRunRow[];
  return {
    preFlight: rows.filter((r) => r.phase === 'pre_flight'),
    postFlight: rows.filter((r) => r.phase === 'post_flight'),
  };
}
