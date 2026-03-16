import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  agentToHubSchema,
  hubToAgentSchema,
  hubToDashboardSchema,
  dashboardToHubSchema,
} from '../protocol.js';

describe('Agent → Hub protocol', () => {
  it('parses agent:register', () => {
    const msg = agentToHubSchema.parse({
      type: 'agent:register',
      machineId: 'studio-pc',
      version: '0.1.0',
      maxSessions: 2,
      os: 'linux',
    });
    expect(msg.type).toBe('agent:register');
    if (msg.type === 'agent:register') {
      expect(msg.machineId).toBe('studio-pc');
    }
  });

  it('parses agent:heartbeat', () => {
    const msg = agentToHubSchema.parse({
      type: 'agent:heartbeat',
      machineId: 'studio-pc',
      activeSessions: 1,
      cpuPercent: 45.2,
      memPercent: 62.1,
    });
    expect(msg.type).toBe('agent:heartbeat');
  });

  it('parses agent:session:output with chunks', () => {
    const msg = agentToHubSchema.parse({
      type: 'agent:session:output',
      sessionId: 'sess-001',
      chunks: [
        { ts: 0, data: 'Hello world' },
        { ts: 105, data: 'Processing...' },
      ],
    });
    expect(msg.type).toBe('agent:session:output');
    if (msg.type === 'agent:session:output') {
      expect(msg.chunks).toHaveLength(2);
    }
  });

  it('parses agent:session:ended with null claudeSessionId', () => {
    const msg = agentToHubSchema.parse({
      type: 'agent:session:ended',
      sessionId: 'sess-001',
      exitCode: 0,
      claudeSessionId: null,
    });
    if (msg.type === 'agent:session:ended') {
      expect(msg.claudeSessionId).toBeNull();
    }
  });

  it('rejects unknown message type', () => {
    expect(() =>
      agentToHubSchema.parse({ type: 'agent:unknown', data: 'test' }),
    ).toThrow(ZodError);
  });

  it('rejects message with missing required fields', () => {
    expect(() =>
      agentToHubSchema.parse({ type: 'agent:register' }),
    ).toThrow(ZodError);
  });
});

describe('Hub → Agent protocol', () => {
  it('parses hub:session:start with default flags', () => {
    const msg = hubToAgentSchema.parse({
      type: 'hub:session:start',
      sessionId: 'sess-001',
      prompt: 'Fix the bug',
      cwd: '/home/user/project',
    });
    if (msg.type === 'hub:session:start') {
      expect(msg.flags).toEqual([]); // default
    }
  });

  it('parses hub:session:input', () => {
    const msg = hubToAgentSchema.parse({
      type: 'hub:session:input',
      sessionId: 'sess-001',
      input: 'yes\n',
    });
    expect(msg.type).toBe('hub:session:input');
  });

  it('parses hub:queue:reorder', () => {
    const msg = hubToAgentSchema.parse({
      type: 'hub:queue:reorder',
      order: ['task-3', 'task-1', 'task-2'],
    });
    if (msg.type === 'hub:queue:reorder') {
      expect(msg.order).toHaveLength(3);
    }
  });
});

describe('Hub → Dashboard protocol', () => {
  it('parses session:output', () => {
    const msg = hubToDashboardSchema.parse({
      type: 'session:output',
      sessionId: 'sess-001',
      chunks: [{ ts: 0, data: 'output' }],
    });
    expect(msg.type).toBe('session:output');
  });

  it('parses session:updated with full session record', () => {
    const msg = hubToDashboardSchema.parse({
      type: 'session:updated',
      session: {
        id: 'sess-001',
        machine_id: 'studio-pc',
        prompt: 'Fix bug',
        cwd: '/project',
        status: 'running',
        created_at: 1710000000,
      },
    });
    expect(msg.type).toBe('session:updated');
  });

  it('parses machine:updated', () => {
    const msg = hubToDashboardSchema.parse({
      type: 'machine:updated',
      machine: {
        id: 'studio-pc',
        last_seen: 1710000000,
        status: 'online',
      },
    });
    expect(msg.type).toBe('machine:updated');
  });
});

describe('Dashboard → Hub protocol', () => {
  it('parses subscribe', () => {
    const msg = dashboardToHubSchema.parse({
      type: 'subscribe',
      resource: 'session',
      id: 'sess-001',
    });
    expect(msg.type).toBe('subscribe');
    if (msg.type === 'subscribe') {
      expect(msg.resource).toBe('session');
    }
  });

  it('parses subscribe without id (all resources)', () => {
    const msg = dashboardToHubSchema.parse({
      type: 'subscribe',
      resource: 'machine',
    });
    if (msg.type === 'subscribe') {
      expect(msg.id).toBeUndefined();
    }
  });

  it('rejects invalid resource type', () => {
    expect(() =>
      dashboardToHubSchema.parse({
        type: 'subscribe',
        resource: 'invalid',
      }),
    ).toThrow(ZodError);
  });
});
