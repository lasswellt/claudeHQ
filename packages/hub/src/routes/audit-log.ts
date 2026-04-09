import type { FastifyInstance } from 'fastify';
import type { AuditLogger } from '../audit-log.js';

export async function auditLogRoutes(
  app: FastifyInstance,
  auditLogger: AuditLogger,
): Promise<void> {
  app.get<{
    Querystring: {
      entityType?: string;
      entityId?: string;
      action?: string;
      since?: string;
      limit?: string;
    };
  }>('/api/audit-log', async (req) => {
    const limit = req.query.limit ? Math.min(parseInt(req.query.limit, 10), 500) : 100;
    const since = req.query.since ? parseInt(req.query.since, 10) : undefined;
    return auditLogger.list({
      entityType: req.query.entityType,
      entityId: req.query.entityId,
      action: req.query.action,
      since,
      limit,
    });
  });
}
