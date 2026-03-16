import type Database from 'better-sqlite3';
import type { FastifyBaseLogger } from 'fastify';

export function startTimeoutSweeper(
  db: Database.Database,
  logger: FastifyBaseLogger,
  intervalMs: number = 10000,
  onTimeout?: (approvalId: string, action: string) => void,
): ReturnType<typeof setInterval> {
  const sweepStmt = db.prepare(`
    SELECT id, timeout_action FROM approval_requests
    WHERE status = 'pending' AND timeout_at <= unixepoch()
  `);

  const resolveStmt = db.prepare(`
    UPDATE approval_requests
    SET status = 'timed_out', resolved_by = ?, resolved_at = unixepoch()
    WHERE id = ? AND status = 'pending'
  `);

  return setInterval(() => {
    const expired = sweepStmt.all() as Array<{ id: string; timeout_action: string }>;

    for (const { id, timeout_action } of expired) {
      const resolvedBy = `timeout:${timeout_action}`;
      const result = resolveStmt.run(resolvedBy, id);

      if (result.changes > 0) {
        logger.info({ approvalId: id, action: timeout_action }, 'Approval timed out');
        onTimeout?.(id, timeout_action);
      }
    }
  }, intervalMs);
}
