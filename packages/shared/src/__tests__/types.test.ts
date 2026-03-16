import { describe, it, expect } from 'vitest';
import { sessionRecordSchema, machineRecordSchema, queueTaskSchema } from '../types.js';

describe('SessionRecord schema', () => {
  it('parses a valid session', () => {
    const result = sessionRecordSchema.parse({
      id: 'sess-001',
      machine_id: 'studio-pc',
      prompt: 'Fix the auth bug',
      cwd: '/home/user/project',
      status: 'running',
      created_at: 1710000000,
    });
    expect(result.id).toBe('sess-001');
    expect(result.status).toBe('running');
  });

  it('rejects invalid status', () => {
    expect(() =>
      sessionRecordSchema.parse({
        id: 'sess-001',
        machine_id: 'studio-pc',
        prompt: 'Fix bug',
        cwd: '/home',
        status: 'invalid-status',
        created_at: 1710000000,
      }),
    ).toThrow();
  });
});

describe('MachineRecord schema', () => {
  it('parses a valid machine', () => {
    const result = machineRecordSchema.parse({
      id: 'studio-pc',
      last_seen: 1710000000,
      status: 'online',
    });
    expect(result.max_sessions).toBe(2); // default
  });
});

describe('QueueTask schema', () => {
  it('parses a valid task with defaults', () => {
    const result = queueTaskSchema.parse({
      id: 'task-001',
      machine_id: 'studio-pc',
      prompt: 'Run tests',
      cwd: '/project',
      position: 0,
      created_at: 1710000000,
    });
    expect(result.priority).toBe(100); // default
  });
});
