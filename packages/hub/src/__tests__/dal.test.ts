import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase } from '../db.js';
import { createDAL } from '../dal.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
let dal: ReturnType<typeof createDAL>;

beforeEach(() => {
  db = initDatabase(':memory:');
  dal = createDAL(db);
});

afterEach(() => {
  db.close();
});

describe('Machine DAL', () => {
  it('upserts and retrieves a machine', () => {
    dal.upsertMachine({
      id: 'studio-pc',
      displayName: 'Studio PC',
      lastSeen: 1710000000,
      status: 'online',
      maxSessions: 3,
    });

    const machine = dal.getMachine('studio-pc');
    expect(machine).toBeDefined();
    expect(machine!.id).toBe('studio-pc');
    expect(machine!.display_name).toBe('Studio PC');
    expect(machine!.max_sessions).toBe(3);
  });

  it('lists machines', () => {
    dal.upsertMachine({ id: 'pc-1', lastSeen: 1710000000, status: 'online', maxSessions: 2 });
    dal.upsertMachine({ id: 'pc-2', lastSeen: 1710000000, status: 'offline', maxSessions: 1 });

    const machines = dal.listMachines();
    expect(machines).toHaveLength(2);
  });

  it('updates machine status', () => {
    dal.upsertMachine({ id: 'pc-1', lastSeen: 1710000000, status: 'online', maxSessions: 2 });
    dal.updateMachineStatus('pc-1', 'offline', 1710001000);

    const machine = dal.getMachine('pc-1');
    expect(machine!.status).toBe('offline');
    expect(machine!.last_seen).toBe(1710001000);
  });
});

describe('Session DAL', () => {
  beforeEach(() => {
    dal.upsertMachine({ id: 'pc-1', lastSeen: 1710000000, status: 'online', maxSessions: 2 });
  });

  it('inserts and retrieves a session', () => {
    dal.insertSession({
      id: 'sess-001',
      machineId: 'pc-1',
      prompt: 'Fix the bug',
      cwd: '/project',
    });

    const session = dal.getSession('sess-001');
    expect(session).toBeDefined();
    expect(session!.prompt).toBe('Fix the bug');
    expect(session!.status).toBe('queued');
  });

  it('lists sessions with filters', () => {
    dal.insertSession({ id: 'sess-001', machineId: 'pc-1', prompt: 'Task 1', cwd: '/a' });
    dal.insertSession({ id: 'sess-002', machineId: 'pc-1', prompt: 'Task 2', cwd: '/b' });
    dal.updateSessionStatus('sess-001', 'running');

    const running = dal.listSessions({ status: 'running' });
    expect(running).toHaveLength(1);
    expect(running[0]!.id).toBe('sess-001');

    const all = dal.listSessions({ machineId: 'pc-1' });
    expect(all).toHaveLength(2);
  });

  it('updates session fields', () => {
    dal.insertSession({ id: 'sess-001', machineId: 'pc-1', prompt: 'Task', cwd: '/a' });
    dal.updateSession('sess-001', {
      status: 'running',
      pid: 12345,
      startedAt: 1710000100,
    });

    const session = dal.getSession('sess-001');
    expect(session!.status).toBe('running');
    expect(session!.pid).toBe(12345);
    expect(session!.started_at).toBe(1710000100);
  });

  // CAP-010 / story 012-003
  it('persists and reads back tags', () => {
    dal.insertSession({
      id: 'sess-tag-1',
      machineId: 'pc-1',
      prompt: 'Tagged',
      cwd: '/a',
      tags: ['foo', 'bar'],
    });
    const s = dal.getSession('sess-tag-1');
    expect(s?.tags).toEqual(['foo', 'bar']);
  });

  it('stores null tags when none provided and returns undefined on read', () => {
    dal.insertSession({ id: 'sess-notag', machineId: 'pc-1', prompt: 'T', cwd: '/a' });
    const s = dal.getSession('sess-notag');
    expect(s?.tags).toBeUndefined();
  });

  it('filters sessions by tag', () => {
    dal.insertSession({
      id: 'sess-a',
      machineId: 'pc-1',
      prompt: 'A',
      cwd: '/a',
      tags: ['production', 'critical'],
    });
    dal.insertSession({
      id: 'sess-b',
      machineId: 'pc-1',
      prompt: 'B',
      cwd: '/b',
      tags: ['staging'],
    });
    dal.insertSession({
      id: 'sess-c',
      machineId: 'pc-1',
      prompt: 'C',
      cwd: '/c',
    });

    const prod = dal.listSessions({ tag: 'production' });
    expect(prod.map((s) => s.id)).toEqual(['sess-a']);

    const staging = dal.listSessions({ tag: 'staging' });
    expect(staging.map((s) => s.id)).toEqual(['sess-b']);

    const missing = dal.listSessions({ tag: 'nonexistent' });
    expect(missing).toHaveLength(0);
  });

  it('tag filter is unambiguous (does not match substrings of other tag names)', () => {
    dal.insertSession({
      id: 'sess-x',
      machineId: 'pc-1',
      prompt: 'X',
      cwd: '/x',
      tags: ['prod-us-east'],
    });
    // "prod" should NOT match "prod-us-east" — the LIKE matches the
    // full JSON-encoded token "prod-us-east".
    const prod = dal.listSessions({ tag: 'prod' });
    expect(prod).toHaveLength(0);
    const full = dal.listSessions({ tag: 'prod-us-east' });
    expect(full).toHaveLength(1);
  });
});

describe('Queue DAL', () => {
  beforeEach(() => {
    dal.upsertMachine({ id: 'pc-1', lastSeen: 1710000000, status: 'online', maxSessions: 2 });
  });

  it('inserts tasks with auto-incrementing position', () => {
    dal.insertQueueTask({ id: 'task-1', machineId: 'pc-1', prompt: 'Task 1', cwd: '/a' });
    dal.insertQueueTask({ id: 'task-2', machineId: 'pc-1', prompt: 'Task 2', cwd: '/b' });

    const tasks = dal.listQueueTasks('pc-1');
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.position).toBe(0);
    expect(tasks[1]!.position).toBe(1);
  });

  it('removes tasks', () => {
    dal.insertQueueTask({ id: 'task-1', machineId: 'pc-1', prompt: 'Task 1', cwd: '/a' });
    dal.removeQueueTask('task-1');

    const tasks = dal.listQueueTasks('pc-1');
    expect(tasks).toHaveLength(0);
  });

  it('reorders tasks', () => {
    dal.insertQueueTask({ id: 'task-1', machineId: 'pc-1', prompt: 'A', cwd: '/a' });
    dal.insertQueueTask({ id: 'task-2', machineId: 'pc-1', prompt: 'B', cwd: '/b' });
    dal.insertQueueTask({ id: 'task-3', machineId: 'pc-1', prompt: 'C', cwd: '/c' });

    dal.reorderQueue('pc-1', ['task-3', 'task-1', 'task-2']);

    const tasks = dal.listQueueTasks('pc-1');
    expect(tasks[0]!.id).toBe('task-3');
    expect(tasks[1]!.id).toBe('task-1');
    expect(tasks[2]!.id).toBe('task-2');
  });
});

describe('Session Events DAL', () => {
  beforeEach(() => {
    dal.upsertMachine({ id: 'pc-1', lastSeen: 1710000000, status: 'online', maxSessions: 2 });
    dal.insertSession({ id: 'sess-001', machineId: 'pc-1', prompt: 'Task', cwd: '/a' });
  });

  it('inserts and lists session events', () => {
    dal.insertSessionEvent('sess-001', 'pre_tool_use', '{"tool": "Bash"}');
    dal.insertSessionEvent('sess-001', 'post_tool_use', '{"tool": "Bash", "result": "ok"}');

    const events = dal.listSessionEvents('sess-001');
    expect(events).toHaveLength(2);
    expect(events[0]!.event_type).toBe('pre_tool_use');
    expect(events[1]!.event_type).toBe('post_tool_use');
  });
});
