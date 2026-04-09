import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../db.js';
import { createAuditLogger, type AuditLogger } from '../audit-log.js';

// CAP-015 / story 012-006: audit log DAL semantics.

let db: Database.Database;
let audit: AuditLogger;

beforeEach(() => {
  db = initDatabase(':memory:');
  audit = createAuditLogger(db);
});

afterEach(() => {
  db.close();
});

describe('createAuditLogger', () => {
  it('appends a row with all required fields', () => {
    audit.append({
      action: 'session.create',
      entityType: 'session',
      entityId: 'sess-1',
      actor: 'user',
      details: { cwd: '/tmp' },
    });

    const rows = audit.list({ entityType: 'session' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'session.create',
      entity_type: 'session',
      entity_id: 'sess-1',
      actor: 'user',
    });
    expect(rows[0]?.details).toBe(JSON.stringify({ cwd: '/tmp' }));
    expect(rows[0]?.created_at).toBeTypeOf('number');
  });

  it('accepts string details verbatim', () => {
    audit.append({
      action: 'test',
      entityType: 'thing',
      entityId: 'x',
      details: 'raw string',
    });
    const [row] = audit.list({ entityType: 'thing' });
    expect(row?.details).toBe('raw string');
  });

  it('allows null actor and details', () => {
    audit.append({ action: 'system.boot', entityType: 'system', entityId: 'hub' });
    const [row] = audit.list({ entityType: 'system' });
    expect(row?.actor).toBeNull();
    expect(row?.details).toBeNull();
  });

  it('filters by entityType', () => {
    audit.append({ action: 'session.create', entityType: 'session', entityId: 's1' });
    audit.append({ action: 'queue.add', entityType: 'queue_task', entityId: 'q1' });
    audit.append({ action: 'session.kill', entityType: 'session', entityId: 's1' });

    const sessions = audit.list({ entityType: 'session' });
    expect(sessions).toHaveLength(2);
    const queues = audit.list({ entityType: 'queue_task' });
    expect(queues).toHaveLength(1);
  });

  it('filters by entityId', () => {
    audit.append({ action: 'session.create', entityType: 'session', entityId: 's1' });
    audit.append({ action: 'session.create', entityType: 'session', entityId: 's2' });
    const s1 = audit.list({ entityType: 'session', entityId: 's1' });
    expect(s1).toHaveLength(1);
    expect(s1[0]?.entity_id).toBe('s1');
  });

  it('filters by action', () => {
    audit.append({ action: 'session.create', entityType: 'session', entityId: 's1' });
    audit.append({ action: 'session.kill', entityType: 'session', entityId: 's1' });
    const kills = audit.list({ action: 'session.kill' });
    expect(kills).toHaveLength(1);
    expect(kills[0]?.action).toBe('session.kill');
  });

  it('orders by created_at DESC, id DESC (newest first)', () => {
    audit.append({ action: 'first', entityType: 'x', entityId: '1' });
    audit.append({ action: 'second', entityType: 'x', entityId: '2' });
    audit.append({ action: 'third', entityType: 'x', entityId: '3' });
    const rows = audit.list({ entityType: 'x' });
    expect(rows.map((r) => r.action)).toEqual(['third', 'second', 'first']);
  });

  it('honors limit', () => {
    for (let i = 0; i < 5; i++) {
      audit.append({ action: 'a', entityType: 'x', entityId: String(i) });
    }
    expect(audit.list({ entityType: 'x', limit: 2 })).toHaveLength(2);
    expect(audit.list({ entityType: 'x' })).toHaveLength(5); // default 100 > 5
  });

  it('filters by since timestamp', () => {
    // Insert a few rows with an explicit old created_at by bypassing append.
    const oldTs = Math.floor(Date.now() / 1000) - 3600;
    db.prepare(
      `INSERT INTO audit_log (action, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?)`,
    ).run('old', 'x', 'o1', oldTs);
    audit.append({ action: 'new', entityType: 'x', entityId: 'n1' });

    const since = Math.floor(Date.now() / 1000) - 60; // last minute
    const recent = audit.list({ entityType: 'x', since });
    expect(recent).toHaveLength(1);
    expect(recent[0]?.action).toBe('new');
  });

  it('tolerates details that cannot be JSON.stringify-ed', () => {
    // Create an object with a circular reference.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() =>
      audit.append({
        action: 'x',
        entityType: 't',
        entityId: '1',
        details: circular,
      }),
    ).not.toThrow();
    const [row] = audit.list({ entityType: 't' });
    expect(row?.details).toBeNull();
  });
});
