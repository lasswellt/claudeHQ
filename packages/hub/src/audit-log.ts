import type Database from 'better-sqlite3';

/**
 * CAP-015: audit log DAL. Every state-changing operation in hub
 * should append a row via {@link AuditLogger.append} inside the
 * same transaction as the primary write, so audit and mutation
 * either both commit or both roll back.
 */
export interface AuditAppendInput {
  action: string;
  entityType: string;
  entityId: string;
  actor?: string;
  details?: Record<string, unknown> | string;
}

export interface AuditLogRow {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string;
  actor: string | null;
  details: string | null;
  created_at: number;
}

export interface AuditListFilter {
  entityType?: string;
  entityId?: string;
  action?: string;
  since?: number;
  limit?: number;
}

export interface AuditLogger {
  append(input: AuditAppendInput): void;
  list(filter?: AuditListFilter): AuditLogRow[];
}

export function createAuditLogger(db: Database.Database): AuditLogger {
  const insertStmt = db.prepare(`
    INSERT INTO audit_log (action, entity_type, entity_id, actor, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  function serializeDetails(details: AuditAppendInput['details']): string | null {
    if (details === undefined) return null;
    if (typeof details === 'string') return details;
    try {
      return JSON.stringify(details);
    } catch {
      return null;
    }
  }

  return {
    append(input: AuditAppendInput): void {
      insertStmt.run(
        input.action,
        input.entityType,
        input.entityId,
        input.actor ?? null,
        serializeDetails(input.details),
        Math.floor(Date.now() / 1000),
      );
    },

    list(filter?: AuditListFilter): AuditLogRow[] {
      let sql = 'SELECT * FROM audit_log WHERE 1=1';
      const params: unknown[] = [];
      if (filter?.entityType) {
        sql += ' AND entity_type = ?';
        params.push(filter.entityType);
      }
      if (filter?.entityId) {
        sql += ' AND entity_id = ?';
        params.push(filter.entityId);
      }
      if (filter?.action) {
        sql += ' AND action = ?';
        params.push(filter.action);
      }
      if (filter?.since !== undefined) {
        sql += ' AND created_at >= ?';
        params.push(filter.since);
      }
      sql += ' ORDER BY created_at DESC, id DESC';
      const limit = filter?.limit ?? 100;
      sql += ' LIMIT ?';
      params.push(limit);
      return db.prepare(sql).all(...params) as AuditLogRow[];
    },
  };
}
