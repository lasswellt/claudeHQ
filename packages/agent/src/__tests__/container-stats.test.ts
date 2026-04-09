import { describe, it, expect } from 'vitest';
import {
  computeCpuPercent,
  computeMemoryMB,
  computePids,
  computeStats,
  createCpuSampler,
  type DockerStatsFrame,
} from '../container-stats.js';

// CAP-087 / story 018-005: container stats CPU math.

function frame(overrides: DockerStatsFrame): DockerStatsFrame {
  return {
    cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0, online_cpus: 1 },
    precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
    memory_stats: { usage: 0 },
    pids_stats: { current: 0 },
    ...overrides,
  };
}

describe('computeCpuPercent', () => {
  it('returns null on first-sample frames (precpu all zero)', () => {
    const f = frame({
      cpu_stats: { cpu_usage: { total_usage: 100_000 }, system_cpu_usage: 1_000_000, online_cpus: 1 },
      precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
    });
    expect(computeCpuPercent(f)).toBeNull();
  });

  it('returns null when cpu delta is zero (idle)', () => {
    const f = frame({
      cpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 2000, online_cpus: 1 },
      precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 },
    });
    expect(computeCpuPercent(f)).toBeNull();
  });

  it('returns null when system delta is zero', () => {
    const f = frame({
      cpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 1000, online_cpus: 1 },
      precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 },
    });
    expect(computeCpuPercent(f)).toBeNull();
  });

  it('computes cpuPercent using the documented formula', () => {
    // cpuDelta = 500, systemDelta = 1000, onlineCpus = 2
    // → 500/1000 * 2 * 100 = 100
    const f = frame({
      cpu_stats: {
        cpu_usage: { total_usage: 1500 },
        system_cpu_usage: 5000,
        online_cpus: 2,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 1000 },
        system_cpu_usage: 4000,
      },
    });
    expect(computeCpuPercent(f)).toBe(100);
  });

  it('scales by online_cpus (4-core machine, 25% each)', () => {
    // cpuDelta = 100, systemDelta = 1000, onlineCpus = 4
    // → 100/1000 * 4 * 100 = 40
    const f = frame({
      cpu_stats: {
        cpu_usage: { total_usage: 200 },
        system_cpu_usage: 2000,
        online_cpus: 4,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 100 },
        system_cpu_usage: 1000,
      },
    });
    expect(computeCpuPercent(f)).toBe(40);
  });

  it('falls back to percpu_usage.length when online_cpus is missing', () => {
    const f = frame({
      cpu_stats: {
        cpu_usage: { total_usage: 200, percpu_usage: [1, 2, 3, 4] },
        system_cpu_usage: 2000,
        // online_cpus omitted
      },
      precpu_stats: {
        cpu_usage: { total_usage: 100 },
        system_cpu_usage: 1000,
      },
    });
    expect(computeCpuPercent(f)).toBe(40);
  });

  it('defaults to 1 CPU when both online_cpus and percpu_usage are missing', () => {
    const f = frame({
      cpu_stats: {
        cpu_usage: { total_usage: 200 },
        system_cpu_usage: 2000,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 100 },
        system_cpu_usage: 1000,
      },
    });
    expect(computeCpuPercent(f)).toBe(10);
  });

  it('rounds to 2 decimal places', () => {
    const f = frame({
      cpu_stats: {
        cpu_usage: { total_usage: 131 },
        system_cpu_usage: 1000,
        online_cpus: 1,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 100 },
        system_cpu_usage: 900,
      },
    });
    // cpuDelta=31, systemDelta=100 → 31% → 31
    expect(computeCpuPercent(f)).toBe(31);
  });
});

describe('computeMemoryMB', () => {
  it('converts usage bytes to megabytes', () => {
    const f = frame({ memory_stats: { usage: 104_857_600 } }); // 100 MB
    expect(computeMemoryMB(f)).toBe(100);
  });

  it('subtracts cgroup v2 inactive_file (cache)', () => {
    const f = frame({
      memory_stats: {
        usage: 200 * 1024 * 1024,
        stats: { inactive_file: 50 * 1024 * 1024 },
      },
    });
    // 200 - 50 = 150 MB
    expect(computeMemoryMB(f)).toBe(150);
  });

  it('clamps at zero when inactive_file > usage', () => {
    const f = frame({
      memory_stats: {
        usage: 10 * 1024 * 1024,
        stats: { inactive_file: 20 * 1024 * 1024 },
      },
    });
    expect(computeMemoryMB(f)).toBe(0);
  });

  it('reports 0 when memory_stats is empty', () => {
    const f = frame({ memory_stats: {} });
    expect(computeMemoryMB(f)).toBe(0);
  });
});

describe('computePids', () => {
  it('returns current process count', () => {
    expect(computePids(frame({ pids_stats: { current: 42 } }))).toBe(42);
  });

  it('returns 0 when absent', () => {
    expect(computePids(frame({ pids_stats: {} }))).toBe(0);
  });
});

describe('computeStats', () => {
  it('combines all three metrics', () => {
    const f = frame({
      cpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 2000, online_cpus: 1 },
      precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 },
      memory_stats: { usage: 50 * 1024 * 1024 },
      pids_stats: { current: 5 },
    });
    expect(computeStats(f)).toEqual({ cpuPercent: 10, memoryMB: 50, pids: 5 });
  });
});

describe('createCpuSampler', () => {
  it('skips the first sample', () => {
    const sampler = createCpuSampler();
    const first = sampler.sample(
      frame({
        cpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000, online_cpus: 1 },
        precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
      }),
    );
    expect(first.cpuPercent).toBeNull();
    expect(sampler.hasBaseline()).toBe(false);
  });

  it('reports real values on subsequent samples', () => {
    const sampler = createCpuSampler();
    sampler.sample(
      frame({
        cpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000, online_cpus: 1 },
        precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
      }),
    );
    const second = sampler.sample(
      frame({
        cpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 2000, online_cpus: 1 },
        precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 },
      }),
    );
    expect(second.cpuPercent).toBe(10);
    expect(sampler.hasBaseline()).toBe(true);
  });

  it('reset() clears the baseline flag', () => {
    const sampler = createCpuSampler();
    sampler.sample(
      frame({
        cpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 2000, online_cpus: 1 },
        precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 },
      }),
    );
    expect(sampler.hasBaseline()).toBe(true);
    sampler.reset();
    expect(sampler.hasBaseline()).toBe(false);
  });
});
