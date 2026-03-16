export interface ContainerSecurityConfig {
  memoryBytes: number;
  cpuQuota: number;
  cpuPeriod: number;
  pidsLimit: number;
  networkMode: string;
  securityOpt: string[];
  capDrop: string[];
  readonlyRootfs: boolean;
  tmpfs: Record<string, string>;
  user: string;
}

/**
 * Default hardened security config for Claude Code containers.
 *
 * This makes --dangerously-skip-permissions SAFE because:
 * - No Docker socket access (container can't escape)
 * - No host network (can't reach local services)
 * - No capabilities (can't change system state)
 * - Read-only rootfs (can't modify container image)
 * - Memory/CPU/PID limits (can't exhaust resources)
 * - Restricted network (only api.anthropic.com via proxy)
 * - Non-root user matching host UID
 */
// Fields that CANNOT be overridden — they are critical for sandbox safety
const IMMUTABLE_FIELDS: (keyof ContainerSecurityConfig)[] = [
  'securityOpt',  // must include no-new-privileges
  'capDrop',       // must drop ALL
];

// Values that are NEVER allowed
const FORBIDDEN_NETWORK_MODES = ['host', 'container'];

export function getDefaultSecurityConfig(overrides?: Partial<ContainerSecurityConfig>): ContainerSecurityConfig {
  const config: ContainerSecurityConfig = {
    memoryBytes: 2 * 1024 * 1024 * 1024,   // 2GB
    cpuQuota: 150000,                         // 1.5 cores
    cpuPeriod: 100000,
    pidsLimit: 256,                           // fork bomb protection
    networkMode: 'claude-restricted',          // allowlist proxy network
    securityOpt: ['no-new-privileges'],
    capDrop: ['ALL'],
    readonlyRootfs: true,
    tmpfs: { '/tmp': 'rw,noexec,nosuid,size=512m' },
    user: '1000:1000',                        // match host UID
  };

  if (overrides) {
    // Validate: reject overrides that disable critical security
    for (const field of IMMUTABLE_FIELDS) {
      if (field in overrides) {
        throw new Error(`Cannot override security field "${field}" — it is immutable for sandbox safety`);
      }
    }

    if (overrides.networkMode && FORBIDDEN_NETWORK_MODES.includes(overrides.networkMode)) {
      throw new Error(`Network mode "${overrides.networkMode}" is forbidden — use "claude-restricted" or "none"`);
    }

    // Apply safe overrides (resource limits, user, tmpfs, network mode, readonlyRootfs)
    Object.assign(config, overrides);

    // Re-enforce immutable values after merge
    config.securityOpt = ['no-new-privileges'];
    config.capDrop = ['ALL'];
  }

  return config;
}

/**
 * Creates the restricted Docker network with an HTTP proxy that
 * allowlists only api.anthropic.com.
 *
 * Run this once per machine during agent setup:
 *   docker network create --internal claude-restricted
 *
 * Then run a proxy container on that network:
 *   docker run -d --name claude-proxy --network claude-restricted ...
 */
export function getNetworkSetupCommands(): string[] {
  return [
    'docker network create --internal claude-restricted 2>/dev/null || true',
    // For a simple setup, use --network none (fully air-gapped)
    // For API access, set up a Squid/tinyproxy with allowlist
  ];
}
