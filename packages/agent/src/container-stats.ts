/**
 * CAP-087 / story 018-005: container stats CPU% math.
 *
 * Dockerode's `container.stats({stream: true})` emits raw CPU
 * counters that must be turned into a usable "CPU percent" metric.
 * The formula is the one Docker's `docker stats` CLI uses:
 *
 *   cpuDelta    = cpu_stats.cpu_usage.total_usage
 *               - precpu_stats.cpu_usage.total_usage
 *   systemDelta = cpu_stats.system_cpu_usage
 *               - precpu_stats.system_cpu_usage
 *   onlineCpus  = cpu_stats.online_cpus
 *               || cpu_stats.cpu_usage.percpu_usage.length
 *               || 1
 *
 *   cpuPercent  = (cpuDelta / systemDelta) * onlineCpus * 100
 *
 * First-sample semantics: the Docker daemon initializes
 * precpu_stats to zeros on the first stats frame, which means
 * cpuDelta equals total_usage and systemDelta equals
 * system_cpu_usage — usually producing an inflated "since boot"
 * percentage. We detect this by checking precpu_stats.system_cpu_usage
 * and skip reporting until the second sample.
 *
 * Pure module: exposes `computeCpuPercent(sample)` and a stateful
 * `createCpuSampler()` that tracks whether it has seen a real
 * baseline yet.
 */

export interface DockerStatsFrame {
  cpu_stats?: {
    cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: {
    cpu_usage?: { total_usage?: number };
    system_cpu_usage?: number;
  };
  memory_stats?: {
    usage?: number;
    limit?: number;
    stats?: Record<string, number>;
  };
  pids_stats?: {
    current?: number;
  };
}

export interface ComputedStats {
  /**
   * 0..(onlineCpus * 100) percent, rounded to 2 decimals. `null`
   * when the frame is the first one and no delta is available.
   */
  cpuPercent: number | null;
  /** Memory in MB used by the container (minus cache). */
  memoryMB: number;
  /** Current process count. */
  pids: number;
}

/**
 * Computes a single stats frame against the values embedded in
 * `precpu_stats`. Returns `cpuPercent: null` when the baseline is
 * all zeros (first sample) or the deltas are non-positive.
 */
export function computeCpuPercent(frame: DockerStatsFrame): number | null {
  const totalUsage = frame.cpu_stats?.cpu_usage?.total_usage ?? 0;
  const systemUsage = frame.cpu_stats?.system_cpu_usage ?? 0;
  const preTotalUsage = frame.precpu_stats?.cpu_usage?.total_usage ?? 0;
  const preSystemUsage = frame.precpu_stats?.system_cpu_usage ?? 0;

  // First sample — Docker sends all-zero precpu on the opening frame.
  if (preSystemUsage === 0) return null;

  const cpuDelta = totalUsage - preTotalUsage;
  const systemDelta = systemUsage - preSystemUsage;

  if (cpuDelta <= 0 || systemDelta <= 0) return null;

  const onlineCpus =
    frame.cpu_stats?.online_cpus ??
    frame.cpu_stats?.cpu_usage?.percpu_usage?.length ??
    1;

  const percent = (cpuDelta / systemDelta) * onlineCpus * 100;
  return Math.round(percent * 100) / 100;
}

export function computeMemoryMB(frame: DockerStatsFrame): number {
  const usage = frame.memory_stats?.usage ?? 0;
  // Cgroup v2 reports the working set under memory_stats.stats.inactive_file;
  // subtract it so the value lines up with what `docker stats` displays.
  const inactive = frame.memory_stats?.stats?.inactive_file ?? 0;
  const effective = Math.max(0, usage - inactive);
  return Math.round((effective / (1024 * 1024)) * 100) / 100;
}

export function computePids(frame: DockerStatsFrame): number {
  return frame.pids_stats?.current ?? 0;
}

export function computeStats(frame: DockerStatsFrame): ComputedStats {
  return {
    cpuPercent: computeCpuPercent(frame),
    memoryMB: computeMemoryMB(frame),
    pids: computePids(frame),
  };
}

/**
 * Stateful wrapper — tracks how many samples have been seen so
 * the first one can be skipped silently. Intended usage:
 *
 *   const sampler = createCpuSampler();
 *   for await (const frame of container.stats()) {
 *     const stats = sampler.sample(frame);
 *     if (stats.cpuPercent !== null) wsSend({ cpuPercent: stats.cpuPercent, ... });
 *   }
 */
export interface CpuSampler {
  sample(frame: DockerStatsFrame): ComputedStats;
  /** True once the sampler has produced a non-null cpuPercent. */
  hasBaseline(): boolean;
  /** Reset internal state (e.g. on container restart). */
  reset(): void;
}

export function createCpuSampler(): CpuSampler {
  let seenBaseline = false;

  return {
    sample(frame: DockerStatsFrame): ComputedStats {
      const stats = computeStats(frame);
      if (stats.cpuPercent !== null) seenBaseline = true;
      return stats;
    },
    hasBaseline(): boolean {
      return seenBaseline;
    },
    reset(): void {
      seenBaseline = false;
    },
  };
}
