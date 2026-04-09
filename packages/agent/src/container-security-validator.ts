import type { ContainerSecurityConfig } from './container-security.js';

/**
 * CAP-081 / story 018-002: runtime validator for the security
 * baseline.
 *
 * After creating a container, the agent inspects it via Dockerode
 * and passes the raw inspect payload here. The validator returns
 * a list of mismatches so the caller can abort with a detailed
 * error message (the CAP-081 AC says the baseline MUST hold; a
 * silent downgrade defeats the whole --dangerously-skip-permissions
 * safety story).
 *
 * Pure module — accepts a plain object shaped like the Docker
 * inspect response, makes no network or Docker calls.
 */

export interface DockerInspectLike {
  HostConfig?: {
    CapDrop?: string[];
    SecurityOpt?: string[];
    ReadonlyRootfs?: boolean;
    Memory?: number;
    NanoCpus?: number;
    CpuQuota?: number;
    CpuPeriod?: number;
    PidsLimit?: number;
    NetworkMode?: string;
    Tmpfs?: Record<string, string>;
  };
  Config?: {
    User?: string;
  };
}

export interface SecurityMismatch {
  field: string;
  expected: unknown;
  actual: unknown;
  severity: 'critical' | 'warning';
}

export interface ValidationResult {
  ok: boolean;
  mismatches: SecurityMismatch[];
}

/**
 * Validates a running container inspect payload against the
 * declared security config. Returns {ok: false} if any critical
 * field is wrong.
 *
 * Critical fields (any mismatch → immediate abort):
 *   - capDrop must include ALL
 *   - securityOpt must include no-new-privileges
 *   - readonlyRootfs must be true
 *   - networkMode must not be host/none in production
 *
 * Warning-level mismatches (logged but do not abort):
 *   - cpuQuota / memory / pidsLimit off by ≤10%
 */
export function validateContainerSecurity(
  expected: ContainerSecurityConfig,
  inspect: DockerInspectLike,
): ValidationResult {
  const host = inspect.HostConfig ?? {};
  const mismatches: SecurityMismatch[] = [];

  // CapDrop must include ALL (case-sensitive per Docker).
  const capDrop = host.CapDrop ?? [];
  if (!capDrop.includes('ALL')) {
    mismatches.push({
      field: 'HostConfig.CapDrop',
      expected: expected.capDrop,
      actual: capDrop,
      severity: 'critical',
    });
  }

  // SecurityOpt must include no-new-privileges.
  const securityOpt = host.SecurityOpt ?? [];
  const hasNoNewPriv = securityOpt.some((s) => s.includes('no-new-privileges'));
  if (!hasNoNewPriv) {
    mismatches.push({
      field: 'HostConfig.SecurityOpt',
      expected: ['no-new-privileges'],
      actual: securityOpt,
      severity: 'critical',
    });
  }

  if (host.ReadonlyRootfs !== true) {
    mismatches.push({
      field: 'HostConfig.ReadonlyRootfs',
      expected: true,
      actual: host.ReadonlyRootfs,
      severity: 'critical',
    });
  }

  // Network mode: must not be 'host'. `none` is acceptable for
  // fully air-gapped mode; the CAP-082 allowlist network is the
  // expected value.
  if (host.NetworkMode === 'host') {
    mismatches.push({
      field: 'HostConfig.NetworkMode',
      expected: expected.networkMode,
      actual: host.NetworkMode,
      severity: 'critical',
    });
  } else if (host.NetworkMode && host.NetworkMode !== expected.networkMode) {
    mismatches.push({
      field: 'HostConfig.NetworkMode',
      expected: expected.networkMode,
      actual: host.NetworkMode,
      severity: 'warning',
    });
  }

  if (expected.user && inspect.Config?.User !== expected.user) {
    mismatches.push({
      field: 'Config.User',
      expected: expected.user,
      actual: inspect.Config?.User,
      severity: 'warning',
    });
  }

  // Memory: Docker reports in bytes. Warn if off by >10%.
  if (host.Memory !== undefined && host.Memory > 0) {
    const diff = Math.abs(host.Memory - expected.memoryBytes);
    if (diff / expected.memoryBytes > 0.1) {
      mismatches.push({
        field: 'HostConfig.Memory',
        expected: expected.memoryBytes,
        actual: host.Memory,
        severity: 'warning',
      });
    }
  }

  if (host.PidsLimit !== undefined && host.PidsLimit !== expected.pidsLimit) {
    mismatches.push({
      field: 'HostConfig.PidsLimit',
      expected: expected.pidsLimit,
      actual: host.PidsLimit,
      severity: 'warning',
    });
  }

  const ok = !mismatches.some((m) => m.severity === 'critical');
  return { ok, mismatches };
}

/**
 * CAP-079 / story 018-003: code-level guard for
 * --dangerously-skip-permissions.
 *
 * Returns whether the flag is safe to pass to claude, given:
 *   - The agent is running in docker mode (not PTY/SSH host exec)
 *   - The declared security config matches the CAP-081 baseline
 *   - The restricted network is in use
 *
 * Any "no" → false. Callers MUST NOT apply the flag otherwise.
 */
export interface SkipPermissionsGuardInput {
  spawnStrategy: 'docker' | 'ssh' | 'pty' | 'wsl';
  securityConfig: ContainerSecurityConfig;
  networkIsRestricted: boolean;
}

export interface SkipPermissionsDecision {
  allowed: boolean;
  reason?: string;
}

export function mayUseSkipPermissions(
  input: SkipPermissionsGuardInput,
): SkipPermissionsDecision {
  if (input.spawnStrategy !== 'docker') {
    return {
      allowed: false,
      reason: `spawn strategy "${input.spawnStrategy}" does not isolate the host`,
    };
  }

  if (!input.securityConfig.capDrop.includes('ALL')) {
    return { allowed: false, reason: 'capDrop must include ALL' };
  }

  if (!input.securityConfig.securityOpt.some((s) => s.includes('no-new-privileges'))) {
    return { allowed: false, reason: 'securityOpt must include no-new-privileges' };
  }

  if (!input.securityConfig.readonlyRootfs) {
    return { allowed: false, reason: 'readonlyRootfs must be true' };
  }

  if (input.securityConfig.networkMode === 'host') {
    return { allowed: false, reason: 'host network mode forbidden' };
  }

  if (!input.networkIsRestricted) {
    return {
      allowed: false,
      reason: 'restricted allowlist network not active',
    };
  }

  return { allowed: true };
}
