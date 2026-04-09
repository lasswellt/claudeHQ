import { describe, it, expect } from 'vitest';
import {
  scoreMachine,
  selectBestMachine,
  computeBackoffSeconds,
  type MachineSnapshot,
} from '../score.js';

// E003 / story 014-002: scheduler scoring pure module.

const base: Omit<MachineSnapshot, 'machineId'> = {
  maxSessions: 4,
  activeSessions: 0,
  cpuPercent: 20,
  memoryPercent: 30,
  queueDepth: 0,
  capabilities: [],
};

describe('scoreMachine', () => {
  it('matches the epic formula exactly', () => {
    // score = (4 - 1) * 10 + (100 - 25) + (100 - 40) - (2 * 5)
    //       = 30 + 75 + 60 - 10 = 155
    const s = scoreMachine({
      machineId: 'a',
      maxSessions: 4,
      activeSessions: 1,
      cpuPercent: 25,
      memoryPercent: 40,
      queueDepth: 2,
      capabilities: [],
    });
    expect(s.score).toBe(155);
    expect(s.freeSlots).toBe(3);
  });

  it('clamps negative free slots to 0', () => {
    const s = scoreMachine({
      machineId: 'a',
      maxSessions: 2,
      activeSessions: 5, // overprovisioned (bug elsewhere)
      cpuPercent: 10,
      memoryPercent: 10,
      queueDepth: 0,
      capabilities: [],
    });
    expect(s.freeSlots).toBe(0);
    // score = 0 + 90 + 90 - 0 = 180
    expect(s.score).toBe(180);
  });

  it('penalizes queue depth', () => {
    const low = scoreMachine({ ...base, machineId: 'a', queueDepth: 0 });
    const high = scoreMachine({ ...base, machineId: 'a', queueDepth: 10 });
    expect(low.score - high.score).toBe(50); // 10 * 5
  });
});

describe('selectBestMachine', () => {
  it('picks the highest-scoring machine', () => {
    const snapshots: MachineSnapshot[] = [
      { ...base, machineId: 'slow', cpuPercent: 90 },
      { ...base, machineId: 'fast', cpuPercent: 10 },
      { ...base, machineId: 'medium', cpuPercent: 50 },
    ];
    const result = selectBestMachine(snapshots);
    expect(result?.machineId).toBe('fast');
  });

  it('returns null when no eligible machines', () => {
    expect(selectBestMachine([])).toBeNull();
  });

  it('returns null when every candidate is full', () => {
    const snapshots: MachineSnapshot[] = [
      { ...base, machineId: 'a', maxSessions: 2, activeSessions: 2 },
      { ...base, machineId: 'b', maxSessions: 1, activeSessions: 1 },
    ];
    expect(selectBestMachine(snapshots)).toBeNull();
  });

  it('filters by capability requirements', () => {
    const snapshots: MachineSnapshot[] = [
      { ...base, machineId: 'plain', capabilities: [] },
      { ...base, machineId: 'gpu', capabilities: ['gpu'] },
      { ...base, machineId: 'gpu-big', capabilities: ['gpu', 'cuda-12'] },
    ];
    // Requires gpu only
    const withGpu = selectBestMachine(snapshots, ['gpu']);
    expect(withGpu?.machineId === 'gpu' || withGpu?.machineId === 'gpu-big').toBe(true);

    // Requires gpu + cuda-12 → only gpu-big qualifies
    const withCuda = selectBestMachine(snapshots, ['gpu', 'cuda-12']);
    expect(withCuda?.machineId).toBe('gpu-big');

    // Requires missing capability
    expect(selectBestMachine(snapshots, ['tpu'])).toBeNull();
  });

  it('breaks ties deterministically by machineId asc', () => {
    const snapshots: MachineSnapshot[] = [
      { ...base, machineId: 'zebra' },
      { ...base, machineId: 'apple' },
      { ...base, machineId: 'mango' },
    ];
    expect(selectBestMachine(snapshots)?.machineId).toBe('apple');
  });
});

describe('computeBackoffSeconds', () => {
  it('follows base * 2^retryCount', () => {
    expect(computeBackoffSeconds(0, 30)).toBe(30);
    expect(computeBackoffSeconds(1, 30)).toBe(60);
    expect(computeBackoffSeconds(2, 30)).toBe(120);
    expect(computeBackoffSeconds(3, 30)).toBe(240);
  });

  it('caps at the configured ceiling', () => {
    expect(computeBackoffSeconds(10, 30, 3600)).toBe(3600);
  });

  it('treats negative retryCount as 0 delay', () => {
    expect(computeBackoffSeconds(-1, 30)).toBe(0);
  });
});
