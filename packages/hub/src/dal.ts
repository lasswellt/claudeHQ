import type Database from 'better-sqlite3';
import type { SessionRecord, MachineRecord, QueueTask } from '@chq/shared';

export interface SessionFilters {
  machineId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface SessionEventRecord {
  id: number;
  session_id: string;
  event_type: string;
  payload: string;
  received_at: number;
}

export function createDAL(db: Database.Database) {
  // ── Machines ────────────────────────────────────────────────

  const upsertMachineStmt = db.prepare(`
    INSERT INTO machines (id, display_name, last_seen, status, max_sessions, meta)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name = COALESCE(excluded.display_name, machines.display_name),
      last_seen = excluded.last_seen,
      status = excluded.status,
      max_sessions = excluded.max_sessions,
      meta = COALESCE(excluded.meta, machines.meta)
  `);

  const getMachineStmt = db.prepare('SELECT * FROM machines WHERE id = ?');
  const listMachinesStmt = db.prepare('SELECT * FROM machines ORDER BY display_name');
  const updateMachineStatusStmt = db.prepare(
    'UPDATE machines SET status = ?, last_seen = ? WHERE id = ?',
  );
  const updateMachineHeartbeatStmt = db.prepare(
    'UPDATE machines SET last_seen = ?, meta = ? WHERE id = ?',
  );

  // ── Sessions ────────────────────────────────────────────────

  const insertSessionStmt = db.prepare(`
    INSERT INTO sessions (id, machine_id, prompt, cwd, flags, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const getSessionStmt = db.prepare('SELECT * FROM sessions WHERE id = ?');

  const updateSessionStmt = db.prepare(`
    UPDATE sessions SET
      status = COALESCE(?, status),
      pid = COALESCE(?, pid),
      exit_code = COALESCE(?, exit_code),
      claude_session_id = COALESCE(?, claude_session_id),
      started_at = COALESCE(?, started_at),
      ended_at = COALESCE(?, ended_at),
      last_activity_at = COALESCE(?, last_activity_at),
      recording_path = COALESCE(?, recording_path),
      recording_size_bytes = COALESCE(?, recording_size_bytes),
      recording_chunk_count = COALESCE(?, recording_chunk_count)
    WHERE id = ?
  `);

  const updateSessionStatusStmt = db.prepare(
    'UPDATE sessions SET status = ?, last_activity_at = ? WHERE id = ?',
  );

  // ── Queue ───────────────────────────────────────────────────

  const insertQueueTaskStmt = db.prepare(`
    INSERT INTO queue (id, machine_id, prompt, cwd, flags, priority, position, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const removeQueueTaskStmt = db.prepare('DELETE FROM queue WHERE id = ?');
  const listQueueTasksStmt = db.prepare(
    'SELECT * FROM queue WHERE machine_id = ? ORDER BY position',
  );
  const getMaxPositionStmt = db.prepare(
    'SELECT COALESCE(MAX(position), -1) as maxPos FROM queue WHERE machine_id = ?',
  );

  // ── Notifications ───────────────────────────────────────────

  const insertNotificationStmt = db.prepare(`
    INSERT INTO notifications (id, session_id, type, channel, payload, sent_at, delivered)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const listNotificationsStmt = db.prepare(
    'SELECT * FROM notifications ORDER BY sent_at DESC LIMIT ?',
  );

  const getNotificationConfigStmt = db.prepare(
    "SELECT * FROM notification_config WHERE id = 'default'",
  );

  const upsertNotificationConfigStmt = db.prepare(`
    INSERT INTO notification_config (id, webhooks, events, enabled)
    VALUES ('default', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      webhooks = excluded.webhooks,
      events = excluded.events,
      enabled = excluded.enabled
  `);

  // ── Session Events ──────────────────────────────────────────

  const insertSessionEventStmt = db.prepare(`
    INSERT INTO session_events (session_id, event_type, payload)
    VALUES (?, ?, ?)
  `);

  const listSessionEventsStmt = db.prepare(
    'SELECT * FROM session_events WHERE session_id = ? ORDER BY received_at',
  );

  // ── DAL object ──────────────────────────────────────────────

  return {
    // Machines
    upsertMachine(machine: {
      id: string;
      displayName?: string;
      lastSeen: number;
      status: string;
      maxSessions: number;
      meta?: string;
    }): void {
      upsertMachineStmt.run(
        machine.id,
        machine.displayName ?? null,
        machine.lastSeen,
        machine.status,
        machine.maxSessions,
        machine.meta ?? null,
      );
    },

    getMachine(id: string): MachineRecord | undefined {
      const row = getMachineStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return parseMachineRow(row);
    },

    listMachines(): MachineRecord[] {
      const rows = listMachinesStmt.all() as Record<string, unknown>[];
      return rows.map(parseMachineRow);
    },

    updateMachineStatus(id: string, status: string, lastSeen: number): void {
      updateMachineStatusStmt.run(status, lastSeen, id);
    },

    updateMachineHeartbeat(id: string, lastSeen: number, meta: string): void {
      updateMachineHeartbeatStmt.run(lastSeen, meta, id);
    },

    // Sessions
    insertSession(session: {
      id: string;
      machineId: string;
      prompt: string;
      cwd: string;
      flags?: string[];
      status?: string;
    }): void {
      insertSessionStmt.run(
        session.id,
        session.machineId,
        session.prompt,
        session.cwd,
        session.flags ? JSON.stringify(session.flags) : null,
        session.status ?? 'queued',
        Math.floor(Date.now() / 1000),
      );
    },

    getSession(id: string): SessionRecord | undefined {
      const row = getSessionStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return parseSessionRow(row);
    },

    listSessions(filters?: SessionFilters): SessionRecord[] {
      let sql = 'SELECT * FROM sessions WHERE 1=1';
      const params: unknown[] = [];

      if (filters?.machineId) {
        sql += ' AND machine_id = ?';
        params.push(filters.machineId);
      }
      if (filters?.status) {
        sql += ' AND status = ?';
        params.push(filters.status);
      }
      sql += ' ORDER BY created_at DESC';
      if (filters?.limit) {
        sql += ' LIMIT ?';
        params.push(filters.limit);
      }
      if (filters?.offset) {
        sql += ' OFFSET ?';
        params.push(filters.offset);
      }

      const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
      return rows.map(parseSessionRow);
    },

    updateSession(
      id: string,
      updates: {
        status?: string;
        pid?: number;
        exitCode?: number;
        claudeSessionId?: string;
        startedAt?: number;
        endedAt?: number;
        lastActivityAt?: number;
        recordingPath?: string;
        recordingSizeBytes?: number;
        recordingChunkCount?: number;
      },
    ): void {
      updateSessionStmt.run(
        updates.status ?? null,
        updates.pid ?? null,
        updates.exitCode ?? null,
        updates.claudeSessionId ?? null,
        updates.startedAt ?? null,
        updates.endedAt ?? null,
        updates.lastActivityAt ?? null,
        updates.recordingPath ?? null,
        updates.recordingSizeBytes ?? null,
        updates.recordingChunkCount ?? null,
        id,
      );
    },

    updateSessionStatus(id: string, status: string): void {
      updateSessionStatusStmt.run(status, Math.floor(Date.now() / 1000), id);
    },

    // Queue
    insertQueueTask(task: {
      id: string;
      machineId: string;
      prompt: string;
      cwd: string;
      flags?: string[];
      priority?: number;
    }): void {
      const maxPos = getMaxPositionStmt.get(task.machineId) as { maxPos: number };
      insertQueueTaskStmt.run(
        task.id,
        task.machineId,
        task.prompt,
        task.cwd,
        task.flags ? JSON.stringify(task.flags) : null,
        task.priority ?? 100,
        maxPos.maxPos + 1,
        Math.floor(Date.now() / 1000),
      );
    },

    removeQueueTask(id: string): void {
      removeQueueTaskStmt.run(id);
    },

    listQueueTasks(machineId: string): QueueTask[] {
      const rows = listQueueTasksStmt.all(machineId) as Record<string, unknown>[];
      return rows.map(parseQueueRow);
    },

    reorderQueue(machineId: string, order: string[]): void {
      const reorder = db.transaction(() => {
        const stmt = db.prepare('UPDATE queue SET position = ? WHERE id = ? AND machine_id = ?');
        for (let i = 0; i < order.length; i++) {
          stmt.run(i, order[i], machineId);
        }
      });
      reorder();
    },

    // Notifications
    insertNotification(notification: {
      id: string;
      sessionId?: string;
      type: string;
      channel: string;
      payload: string;
    }): void {
      insertNotificationStmt.run(
        notification.id,
        notification.sessionId ?? null,
        notification.type,
        notification.channel,
        notification.payload,
        Math.floor(Date.now() / 1000),
        0,
      );
    },

    listNotifications(limit: number = 50): Record<string, unknown>[] {
      return listNotificationsStmt.all(limit) as Record<string, unknown>[];
    },

    getNotificationConfig(): Record<string, unknown> | undefined {
      return getNotificationConfigStmt.get() as Record<string, unknown> | undefined;
    },

    updateNotificationConfig(webhooks: string, events: string, enabled: boolean): void {
      upsertNotificationConfigStmt.run(webhooks, events, enabled ? 1 : 0);
    },

    // Session Events
    insertSessionEvent(sessionId: string, eventType: string, payload: string): void {
      insertSessionEventStmt.run(sessionId, eventType, payload);
    },

    listSessionEvents(sessionId: string): SessionEventRecord[] {
      return listSessionEventsStmt.all(sessionId) as SessionEventRecord[];
    },
  };
}

export type DAL = ReturnType<typeof createDAL>;

// ── Row parsers ─────────────────────────────────────────────────

function parseMachineRow(row: Record<string, unknown>): MachineRecord {
  return {
    id: row.id as string,
    display_name: (row.display_name as string) ?? undefined,
    last_seen: row.last_seen as number,
    status: row.status as 'online' | 'offline',
    max_sessions: row.max_sessions as number,
    meta: row.meta ? (JSON.parse(row.meta as string) as { version: string; os: string; arch: string }) : undefined,
  };
}

function parseSessionRow(row: Record<string, unknown>): SessionRecord {
  return {
    id: row.id as string,
    machine_id: row.machine_id as string,
    prompt: row.prompt as string,
    cwd: row.cwd as string,
    flags: row.flags ? (JSON.parse(row.flags as string) as string[]) : undefined,
    status: row.status as 'queued' | 'running' | 'completed' | 'failed',
    pid: (row.pid as number) ?? undefined,
    exit_code: (row.exit_code as number) ?? undefined,
    claude_session_id: (row.claude_session_id as string) ?? undefined,
    parent_session_id: (row.parent_session_id as string) ?? undefined,
    started_at: (row.started_at as number) ?? undefined,
    ended_at: (row.ended_at as number) ?? undefined,
    last_activity_at: (row.last_activity_at as number) ?? undefined,
    recording_path: (row.recording_path as string) ?? undefined,
    recording_size_bytes: (row.recording_size_bytes as number) ?? undefined,
    recording_chunk_count: (row.recording_chunk_count as number) ?? undefined,
    created_at: row.created_at as number,
  };
}

function parseQueueRow(row: Record<string, unknown>): QueueTask {
  return {
    id: row.id as string,
    machine_id: row.machine_id as string,
    prompt: row.prompt as string,
    cwd: row.cwd as string,
    flags: row.flags ? (JSON.parse(row.flags as string) as string[]) : undefined,
    priority: row.priority as number,
    position: row.position as number,
    created_at: row.created_at as number,
  };
}
