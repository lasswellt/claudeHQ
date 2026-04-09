/**
 * CAP-035 / story 020-003: derive K8s-style health conditions from
 * a machine's most recent telemetry. Pure function — no IO.
 *
 * Conditions are modeled on Kubernetes node conditions so ops
 * folks already have a mental model:
 *   - Ready           — agent heartbeats are recent (< 60s old)
 *   - NotReady        — heartbeat older than 60s
 *   - MemoryPressure  — memPercent >= 85
 *   - DiskPressure    — diskPercent >= 85
 *   - SessionPressure — activeSessions / maxSessions >= 0.9
 *
 * Any NOT-ok condition ("Pressure" or NotReady) surfaces as a
 * warning chip on the machine card. Ready + no pressure = green.
 */

export type ConditionKind =
  | 'Ready'
  | 'NotReady'
  | 'MemoryPressure'
  | 'DiskPressure'
  | 'SessionPressure';

export interface MachineCondition {
  kind: ConditionKind;
  /** ok = green, warning = amber, error = red */
  severity: 'ok' | 'warning' | 'error';
  reason: string;
}

export interface MachineConditionsInput {
  /** Last heartbeat timestamp (unix seconds). */
  lastSeen: number;
  /** CPU utilization percent, 0-100. */
  cpuPercent?: number;
  /** Memory utilization percent, 0-100. */
  memPercent?: number;
  /** Disk utilization percent, 0-100. */
  diskPercent?: number;
  /** Currently running sessions. */
  activeSessions: number;
  /** Max concurrent sessions configured for the machine. */
  maxSessions: number;
  /** Injectable clock in seconds for tests. */
  now?: () => number;
}

const HEARTBEAT_STALE_SECONDS = 60;
const MEMORY_PRESSURE_THRESHOLD = 85;
const DISK_PRESSURE_THRESHOLD = 85;
const SESSION_PRESSURE_RATIO = 0.9;

export function deriveConditions(input: MachineConditionsInput): MachineCondition[] {
  const now = (input.now ?? (() => Math.floor(Date.now() / 1000)))();
  const conditions: MachineCondition[] = [];

  const heartbeatAge = now - input.lastSeen;
  if (heartbeatAge > HEARTBEAT_STALE_SECONDS) {
    conditions.push({
      kind: 'NotReady',
      severity: 'error',
      reason: `Last heartbeat ${heartbeatAge}s ago`,
    });
  } else {
    conditions.push({
      kind: 'Ready',
      severity: 'ok',
      reason: `Heartbeat ${heartbeatAge}s ago`,
    });
  }

  if (input.memPercent !== undefined && input.memPercent >= MEMORY_PRESSURE_THRESHOLD) {
    conditions.push({
      kind: 'MemoryPressure',
      severity: 'warning',
      reason: `Memory at ${Math.round(input.memPercent)}%`,
    });
  }

  if (input.diskPercent !== undefined && input.diskPercent >= DISK_PRESSURE_THRESHOLD) {
    conditions.push({
      kind: 'DiskPressure',
      severity: 'warning',
      reason: `Disk at ${Math.round(input.diskPercent)}%`,
    });
  }

  if (
    input.maxSessions > 0 &&
    input.activeSessions / input.maxSessions >= SESSION_PRESSURE_RATIO
  ) {
    conditions.push({
      kind: 'SessionPressure',
      severity: 'warning',
      reason: `${input.activeSessions}/${input.maxSessions} slots in use`,
    });
  }

  return conditions;
}

/**
 * Returns the single "headline" condition a card should display
 * when space is tight. Priority: NotReady > any Pressure > Ready.
 */
export function headlineCondition(
  conditions: readonly MachineCondition[],
): MachineCondition | null {
  if (conditions.length === 0) return null;
  const notReady = conditions.find((c) => c.kind === 'NotReady');
  if (notReady) return notReady;
  const pressure = conditions.find((c) => c.severity === 'warning');
  if (pressure) return pressure;
  return conditions.find((c) => c.kind === 'Ready') ?? conditions[0] ?? null;
}

/**
 * Composable-style wrapper. For now it's synchronous because all
 * callers have the machine row + the latest metric locally, but
 * keeping a hook lets us swap in a reactive store subscription
 * without touching component code.
 */
export function useMachineConditions(): {
  derive: typeof deriveConditions;
  headline: typeof headlineCondition;
} {
  return { derive: deriveConditions, headline: headlineCondition };
}
