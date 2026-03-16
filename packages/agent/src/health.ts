import os from 'node:os';
import { execSync } from 'node:child_process';

export interface SystemHealth {
  cpuPercent: number;
  memPercent: number;
  diskPercent: number;
  uptime: number;
}

export function getSystemHealth(diskPath?: string): SystemHealth {
  return {
    cpuPercent: getCpuPercent(),
    memPercent: getMemPercent(),
    diskPercent: getDiskPercent(diskPath),
    uptime: os.uptime(),
  };
}

function getCpuPercent(): number {
  const cpus = os.cpus();
  if (cpus.length === 0) return 0;

  let totalIdle = 0;
  let totalTick = 0;

  for (const cpu of cpus) {
    const { user, nice, sys, idle, irq } = cpu.times;
    totalTick += user + nice + sys + idle + irq;
    totalIdle += idle;
  }

  return Math.round(((totalTick - totalIdle) / totalTick) * 100);
}

function getMemPercent(): number {
  const total = os.totalmem();
  const free = os.freemem();
  if (total === 0) return 0;
  return Math.round(((total - free) / total) * 100);
}

function getDiskPercent(targetPath?: string): number {
  try {
    const path = targetPath ?? '/';
    const output = execSync(`df -P "${path}" | tail -1`, { encoding: 'utf-8' });
    const parts = output.trim().split(/\s+/);
    const usePercent = parts[4]; // e.g., "42%"
    if (usePercent) {
      return parseInt(usePercent.replace('%', ''), 10);
    }
  } catch {
    // Fall back to 0 if df fails
  }
  return 0;
}
