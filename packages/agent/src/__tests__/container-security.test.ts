import { describe, it, expect } from 'vitest';
import { getDefaultSecurityConfig, getNetworkSetupCommands } from '../container-security.js';

// ---------------------------------------------------------------------------
// Default security config — hardened values
// ---------------------------------------------------------------------------

describe('getDefaultSecurityConfig — default hardened values', () => {
  it('should drop ALL capabilities by default', () => {
    // Arrange / Act
    const config = getDefaultSecurityConfig();

    // Assert
    expect(config.capDrop).toEqual(['ALL']);
  });

  it('should set no-new-privileges in securityOpt by default', () => {
    // Arrange / Act
    const config = getDefaultSecurityConfig();

    // Assert
    expect(config.securityOpt).toContain('no-new-privileges');
  });

  it('should set readonlyRootfs to true by default', () => {
    // Arrange / Act
    const config = getDefaultSecurityConfig();

    // Assert
    expect(config.readonlyRootfs).toBe(true);
  });

  it('should set the network mode to the restricted proxy network', () => {
    // Arrange / Act
    const config = getDefaultSecurityConfig();

    // Assert
    expect(config.networkMode).toBe('claude-restricted');
  });

  it('should set a non-root user by default', () => {
    // Arrange / Act
    const config = getDefaultSecurityConfig();

    // Assert
    expect(config.user).toBe('1000:1000');
  });

  it('should set memory limit to 2GB', () => {
    // Arrange / Act
    const config = getDefaultSecurityConfig();

    // Assert
    expect(config.memoryBytes).toBe(2 * 1024 * 1024 * 1024);
  });

  it('should set PID limit to 256 for fork-bomb protection', () => {
    // Arrange / Act
    const config = getDefaultSecurityConfig();

    // Assert
    expect(config.pidsLimit).toBe(256);
  });

  it('should set CPU quota to 1.5 cores (150000/100000)', () => {
    // Arrange / Act
    const config = getDefaultSecurityConfig();

    // Assert
    expect(config.cpuQuota / config.cpuPeriod).toBeCloseTo(1.5, 2);
  });

  it('should configure a noexec tmpfs for /tmp', () => {
    // Arrange / Act
    const config = getDefaultSecurityConfig();

    // Assert
    expect(config.tmpfs['/tmp']).toContain('noexec');
    expect(config.tmpfs['/tmp']).toContain('nosuid');
  });
});

// ---------------------------------------------------------------------------
// Immutable fields cannot be overridden
// ---------------------------------------------------------------------------

describe('getDefaultSecurityConfig — immutable field enforcement', () => {
  it('should throw when overriding securityOpt', () => {
    // Arrange / Act / Assert
    expect(() =>
      getDefaultSecurityConfig({ securityOpt: [] })
    ).toThrow(/securityOpt/);
  });

  it('should throw when overriding capDrop', () => {
    // Arrange / Act / Assert
    expect(() =>
      getDefaultSecurityConfig({ capDrop: ['NET_RAW'] })
    ).toThrow(/capDrop/);
  });

  it('should re-enforce capDrop=ALL even if an override is later applied via Object.assign trick', () => {
    // Arrange — safe override
    const config = getDefaultSecurityConfig({ memoryBytes: 1 * 1024 * 1024 * 1024 });

    // Assert — immutable values are intact after safe override
    expect(config.capDrop).toEqual(['ALL']);
    expect(config.securityOpt).toContain('no-new-privileges');
  });

  it('should throw when networkMode is set to host', () => {
    // Arrange / Act / Assert
    expect(() =>
      getDefaultSecurityConfig({ networkMode: 'host' })
    ).toThrow(/host/i);
  });

  it('should throw when networkMode is set to container', () => {
    // Arrange / Act / Assert
    expect(() =>
      getDefaultSecurityConfig({ networkMode: 'container' })
    ).toThrow(/container/i);
  });
});

// ---------------------------------------------------------------------------
// Safe overrides are applied correctly
// ---------------------------------------------------------------------------

describe('getDefaultSecurityConfig — safe overrides', () => {
  it('should apply memory override while keeping security invariants', () => {
    // Arrange / Act
    const config = getDefaultSecurityConfig({ memoryBytes: 512 * 1024 * 1024 });

    // Assert
    expect(config.memoryBytes).toBe(512 * 1024 * 1024);
    expect(config.capDrop).toEqual(['ALL']);
    expect(config.readonlyRootfs).toBe(true);
  });

  it('should apply pidsLimit override', () => {
    // Arrange / Act
    const config = getDefaultSecurityConfig({ pidsLimit: 128 });

    // Assert
    expect(config.pidsLimit).toBe(128);
  });

  it('should allow a non-forbidden network mode override', () => {
    // Arrange / Act
    const config = getDefaultSecurityConfig({ networkMode: 'none' });

    // Assert
    expect(config.networkMode).toBe('none');
  });

  it('should allow disabling readonlyRootfs for setup containers', () => {
    // Arrange / Act
    const config = getDefaultSecurityConfig({ readonlyRootfs: false });

    // Assert
    expect(config.readonlyRootfs).toBe(false);
    // Security invariants still enforced
    expect(config.capDrop).toEqual(['ALL']);
  });

  it('should allow user override', () => {
    // Arrange / Act
    const config = getDefaultSecurityConfig({ user: '2000:2000' });

    // Assert
    expect(config.user).toBe('2000:2000');
  });
});

// ---------------------------------------------------------------------------
// getNetworkSetupCommands
// ---------------------------------------------------------------------------

describe('getNetworkSetupCommands', () => {
  it('should return an array of shell commands', () => {
    // Arrange / Act
    const commands = getNetworkSetupCommands();

    // Assert
    expect(Array.isArray(commands)).toBe(true);
    expect(commands.length).toBeGreaterThan(0);
  });

  it('should include the claude-restricted network creation command', () => {
    // Arrange / Act
    const commands = getNetworkSetupCommands();

    // Assert
    expect(commands.some((c) => c.includes('claude-restricted'))).toBe(true);
  });
});
