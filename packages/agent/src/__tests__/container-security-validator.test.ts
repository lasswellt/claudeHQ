import { describe, it, expect } from 'vitest';
import { getDefaultSecurityConfig } from '../container-security.js';
import {
  validateContainerSecurity,
  mayUseSkipPermissions,
} from '../container-security-validator.js';

// CAP-081 + CAP-079 / stories 018-002 + 018-003.

function baselineInspect(): {
  HostConfig: {
    CapDrop: string[];
    SecurityOpt: string[];
    ReadonlyRootfs: boolean;
    Memory: number;
    PidsLimit: number;
    NetworkMode: string;
  };
  Config: { User: string };
} {
  return {
    HostConfig: {
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      ReadonlyRootfs: true,
      Memory: 2 * 1024 * 1024 * 1024,
      PidsLimit: 256,
      NetworkMode: 'claude-restricted',
    },
    Config: { User: '1000:1000' },
  };
}

describe('validateContainerSecurity', () => {
  it('passes a container matching the baseline', () => {
    const result = validateContainerSecurity(getDefaultSecurityConfig(), baselineInspect());
    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it('flags missing CapDrop=ALL as critical', () => {
    const inspect = baselineInspect();
    inspect.HostConfig.CapDrop = ['NET_RAW'];
    const result = validateContainerSecurity(getDefaultSecurityConfig(), inspect);
    expect(result.ok).toBe(false);
    const critical = result.mismatches.find((m) => m.severity === 'critical');
    expect(critical?.field).toBe('HostConfig.CapDrop');
  });

  it('flags missing no-new-privileges as critical', () => {
    const inspect = baselineInspect();
    inspect.HostConfig.SecurityOpt = [];
    const result = validateContainerSecurity(getDefaultSecurityConfig(), inspect);
    expect(result.ok).toBe(false);
    expect(result.mismatches.some((m) => m.field === 'HostConfig.SecurityOpt')).toBe(true);
  });

  it('flags ReadonlyRootfs=false as critical', () => {
    const inspect = baselineInspect();
    inspect.HostConfig.ReadonlyRootfs = false;
    const result = validateContainerSecurity(getDefaultSecurityConfig(), inspect);
    expect(result.ok).toBe(false);
  });

  it('flags host network as critical', () => {
    const inspect = baselineInspect();
    inspect.HostConfig.NetworkMode = 'host';
    const result = validateContainerSecurity(getDefaultSecurityConfig(), inspect);
    expect(result.ok).toBe(false);
  });

  it('treats off-by-10% memory as warning, not critical', () => {
    const inspect = baselineInspect();
    inspect.HostConfig.Memory = 1_500_000_000; // noticeably less than 2GB
    const result = validateContainerSecurity(getDefaultSecurityConfig(), inspect);
    expect(result.ok).toBe(true); // still critical-clean
    expect(result.mismatches.some((m) => m.field === 'HostConfig.Memory' && m.severity === 'warning')).toBe(true);
  });

  it('reports a wrong non-host network as warning', () => {
    const inspect = baselineInspect();
    inspect.HostConfig.NetworkMode = 'bridge';
    const result = validateContainerSecurity(getDefaultSecurityConfig(), inspect);
    expect(result.ok).toBe(true);
    expect(result.mismatches.some((m) => m.field === 'HostConfig.NetworkMode' && m.severity === 'warning')).toBe(true);
  });
});

describe('mayUseSkipPermissions', () => {
  const safeConfig = getDefaultSecurityConfig();

  it('allows the flag when every invariant holds', () => {
    expect(
      mayUseSkipPermissions({
        spawnStrategy: 'docker',
        securityConfig: safeConfig,
        networkIsRestricted: true,
      }).allowed,
    ).toBe(true);
  });

  it('rejects non-docker strategies', () => {
    for (const strat of ['ssh', 'pty', 'wsl'] as const) {
      const decision = mayUseSkipPermissions({
        spawnStrategy: strat,
        securityConfig: safeConfig,
        networkIsRestricted: true,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain(strat);
    }
  });

  it('rejects when capDrop is missing ALL', () => {
    const bad = { ...safeConfig, capDrop: ['NET_RAW'] };
    const decision = mayUseSkipPermissions({
      spawnStrategy: 'docker',
      securityConfig: bad,
      networkIsRestricted: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('capDrop');
  });

  it('rejects when no-new-privileges is missing', () => {
    const bad = { ...safeConfig, securityOpt: [] };
    expect(
      mayUseSkipPermissions({
        spawnStrategy: 'docker',
        securityConfig: bad,
        networkIsRestricted: true,
      }).allowed,
    ).toBe(false);
  });

  it('rejects when readonlyRootfs is false', () => {
    const bad = { ...safeConfig, readonlyRootfs: false };
    expect(
      mayUseSkipPermissions({
        spawnStrategy: 'docker',
        securityConfig: bad,
        networkIsRestricted: true,
      }).allowed,
    ).toBe(false);
  });

  it('rejects when network is host', () => {
    // Bypass the getDefaultSecurityConfig guard by constructing directly.
    const bad = { ...safeConfig, networkMode: 'host' };
    expect(
      mayUseSkipPermissions({
        spawnStrategy: 'docker',
        securityConfig: bad,
        networkIsRestricted: true,
      }).allowed,
    ).toBe(false);
  });

  it('rejects when restricted network is not active', () => {
    expect(
      mayUseSkipPermissions({
        spawnStrategy: 'docker',
        securityConfig: safeConfig,
        networkIsRestricted: false,
      }).allowed,
    ).toBe(false);
  });
});
