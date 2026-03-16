import { describe, it, expect } from 'vitest';
import { agentConfigSchema, hubConfigSchema } from '../config.js';

describe('HubConfig schema', () => {
  it('applies defaults for all optional fields', () => {
    const config = hubConfigSchema.parse({});
    expect(config.port).toBe(7700);
    expect(config.host).toBe('0.0.0.0');
    expect(config.logLevel).toBe('info');
    expect(config.databasePath).toBe('./data/db/chq.db');
    expect(config.recordingsPath).toBe('./data/recordings');
  });

  it('overrides defaults with provided values', () => {
    const config = hubConfigSchema.parse({ port: 8080, logLevel: 'debug' });
    expect(config.port).toBe(8080);
    expect(config.logLevel).toBe('debug');
  });

  it('rejects invalid log level', () => {
    expect(() => hubConfigSchema.parse({ logLevel: 'verbose' })).toThrow();
  });
});

describe('AgentConfig schema', () => {
  it('requires machineId and hubUrl', () => {
    expect(() => agentConfigSchema.parse({})).toThrow();
    expect(() => agentConfigSchema.parse({ machineId: 'pc' })).toThrow();
  });

  it('parses valid config with defaults', () => {
    const config = agentConfigSchema.parse({
      machineId: 'studio-pc',
      hubUrl: 'ws://100.64.0.1:7700',
    });
    expect(config.maxConcurrentSessions).toBe(2);
    expect(config.claudeBinary).toBe('claude');
    expect(config.defaultFlags).toEqual(['--dangerously-skip-permissions']);
  });

  it('rejects invalid hubUrl', () => {
    expect(() =>
      agentConfigSchema.parse({ machineId: 'pc', hubUrl: 'not-a-url' }),
    ).toThrow();
  });

  it('rejects maxConcurrentSessions out of range', () => {
    expect(() =>
      agentConfigSchema.parse({
        machineId: 'pc',
        hubUrl: 'ws://host:7700',
        maxConcurrentSessions: 0,
      }),
    ).toThrow();
  });
});
