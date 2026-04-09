import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../db.js';

// CAP-075 / story 012-005: verify the machine_health_history time-series
// and its retention semantics.

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(':memory:');
  // Register a machine so the FK is satisfied.
  db.prepare(
    `INSERT INTO machines (id, display_name, last_seen, status, max_sessions)
     VALUES ('pc-1', 'PC 1', ?, 'online', 2)`,
  ).run(Math.floor(Date.now() / 1000));
});

afterEach(() => {
  db.close();
});

describe('machine_health_history', () => {
  it('persists heartbeat samples', () => {
    const insert = db.prepare(
      `INSERT INTO machine_health_history (machine_id, cpu_percent, mem_percent, disk_percent, active_sessions)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insert.run('pc-1', 45, 60, null, 2);
    insert.run('pc-1', 50, 62, 70, 3);
    insert.run('pc-1', 48, 61, 71, 2);

    const rows = db
      .prepare(
        'SELECT cpu_percent, mem_percent, disk_percent, active_sessions FROM machine_health_history WHERE machine_id = ? ORDER BY id',
      )
      .all('pc-1') as Array<{
      cpu_percent: number;
      mem_percent: number;
      disk_percent: number | null;
      active_sessions: number;
    }>;

    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      cpu_percent: 45,
      mem_percent: 60,
      disk_percent: null,
      active_sessions: 2,
    });
    expect(rows[2]?.disk_percent).toBe(71);
  });

  it('read filter by since returns only recent rows', () => {
    const now = Math.floor(Date.now() / 1000);
    const insertExplicit = db.prepare(
      `INSERT INTO machine_health_history (machine_id, cpu_percent, mem_percent, disk_percent, active_sessions, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertExplicit.run('pc-1', 10, 20, null, 1, now - 7200); // 2h ago
    insertExplicit.run('pc-1', 20, 30, null, 1, now - 1800); // 30m ago
    insertExplicit.run('pc-1', 30, 40, null, 1, now - 60); //   1m ago

    const since = now - 3600; // last hour
    const recent = db
      .prepare(
        'SELECT * FROM machine_health_history WHERE machine_id = ? AND recorded_at >= ? ORDER BY recorded_at',
      )
      .all('pc-1', since) as Array<{ cpu_percent: number }>;

    expect(recent).toHaveLength(2);
    expect(recent.map((r) => r.cpu_percent)).toEqual([20, 30]);
  });

  it('prune deletes rows older than the retention window', () => {
    const now = Math.floor(Date.now() / 1000);
    const insertExplicit = db.prepare(
      `INSERT INTO machine_health_history (machine_id, cpu_percent, mem_percent, disk_percent, active_sessions, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertExplicit.run('pc-1', 1, 2, null, 0, now - 48 * 3600); // 48h old — prune
    insertExplicit.run('pc-1', 3, 4, null, 0, now - 25 * 3600); // 25h old — prune
    insertExplicit.run('pc-1', 5, 6, null, 0, now - 23 * 3600); // 23h — keep
    insertExplicit.run('pc-1', 7, 8, null, 0, now - 1 * 3600); //  1h — keep

    const cutoff = now - 24 * 3600;
    const result = db
      .prepare('DELETE FROM machine_health_history WHERE recorded_at < ?')
      .run(cutoff);
    expect(result.changes).toBe(2);

    const remaining = db
      .prepare('SELECT COUNT(*) AS n FROM machine_health_history WHERE machine_id = ?')
      .get('pc-1') as { n: number };
    expect(remaining.n).toBe(2);
  });
});
