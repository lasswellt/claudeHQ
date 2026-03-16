import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type Database from 'better-sqlite3';

export async function notificationRoutes(app: FastifyInstance, db: Database.Database): Promise<void> {
  const getNotificationConfigStmt = db.prepare("SELECT * FROM notification_config WHERE id = 'default'");
  const upsertNotificationConfigStmt = db.prepare(`
    INSERT INTO notification_config (id, webhooks, events, enabled)
    VALUES ('default', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      webhooks = excluded.webhooks,
      events = excluded.events,
      enabled = excluded.enabled
  `);
  const listNotificationHistoryStmt = db.prepare(
    'SELECT * FROM notifications ORDER BY sent_at DESC LIMIT ?',
  );

  // Get notification config
  app.get('/api/notifications/config', async () => {
    const config = getNotificationConfigStmt.get();
    if (!config) {
      return { id: 'default', webhooks: '[]', events: '["session_completed","session_failed"]', enabled: 1 };
    }
    return config;
  });

  // Update notification config
  const updateBody = z.object({
    webhooks: z.array(
      z.object({
        url: z.string().url(),
        label: z.string().optional(),
        events: z.array(z.string()).optional(),
        format: z.enum(['json', 'discord', 'slack']).optional(),
      }),
    ),
    events: z.array(z.string()),
    enabled: z.boolean(),
  });

  app.put('/api/notifications/config', async (req) => {
    const body = updateBody.parse(req.body);
    upsertNotificationConfigStmt.run(
      JSON.stringify(body.webhooks), JSON.stringify(body.events), body.enabled ? 1 : 0,
    );

    return { updated: true };
  });

  // Notification history
  app.get<{ Querystring: { limit?: string } }>('/api/notifications/history', async (req) => {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    return listNotificationHistoryStmt.all(limit);
  });
}
