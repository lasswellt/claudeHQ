import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';

declare module 'fastify' {
  interface FastifyInstance {
    recordHealthData: (
      machineId: string,
      cpuPercent: number,
      memPercent: number,
      diskPercent: number | null,
      activeSessions: number,
    ) => void;
    // CAP-075: expose the retention timer so the graceful-shutdown
    // handler can clear it. Declared here so the type augmentation
    // lives with the route that owns it.
    machineHealthRetentionTimer?: ReturnType<typeof setInterval>;
  }
}

/** Retention window for machine_health_history in seconds (24h). */
const MACHINE_HEALTH_RETENTION_SECONDS = 24 * 3600;
/** Prune cadence (10 minutes). */
const MACHINE_HEALTH_PRUNE_INTERVAL_MS = 10 * 60 * 1000;

export async function healthHistoryRoutes(app: FastifyInstance, db: Database.Database): Promise<void> {
  // Record health data (called internally from heartbeat handler)
  const insertStmt = db.prepare(`
    INSERT INTO machine_health_history (machine_id, cpu_percent, mem_percent, disk_percent, active_sessions)
    VALUES (?, ?, ?, ?, ?)
  `);

  const getHealthHistoryStmt = db.prepare(
    'SELECT * FROM machine_health_history WHERE machine_id = ? AND recorded_at >= ? ORDER BY recorded_at',
  );

  // CAP-075: rolling-window retention. Prepared once and reused.
  const pruneStmt = db.prepare(
    'DELETE FROM machine_health_history WHERE recorded_at < ?',
  );

  // Get health history for a machine
  app.get<{
    Params: { id: string };
    Querystring: { hours?: string };
  }>('/api/machines/:id/health', async (req) => {
    const hours = req.query.hours ? parseInt(req.query.hours, 10) : 24;
    const since = Math.floor(Date.now() / 1000) - hours * 3600;
    return getHealthHistoryStmt.all(req.params.id, since);
  });

  // Expose the insert function for the agent handler to use
  app.decorate('recordHealthData', function(
    machineId: string,
    cpuPercent: number,
    memPercent: number,
    diskPercent: number | null,
    activeSessions: number,
  ): void {
    insertStmt.run(machineId, cpuPercent, memPercent, diskPercent, activeSessions);
  });

  // CAP-075: start the prune interval. Runs once on boot then every
  // 10 minutes. Stored on the app instance so shutdown can clear it.
  const prune = (): void => {
    const cutoff = Math.floor(Date.now() / 1000) - MACHINE_HEALTH_RETENTION_SECONDS;
    try {
      const result = pruneStmt.run(cutoff);
      if (result.changes > 0) {
        app.log.debug({ deleted: result.changes }, 'machine_health_history pruned');
      }
    } catch (err) {
      app.log.warn({ err }, 'machine_health_history prune failed');
    }
  };
  prune();
  app.machineHealthRetentionTimer = setInterval(prune, MACHINE_HEALTH_PRUNE_INTERVAL_MS);
  // Ref-counting the interval keeps Node alive — this is a background
  // task; let Node exit cleanly when the server closes.
  app.machineHealthRetentionTimer.unref();

  app.addHook('onClose', async () => {
    if (app.machineHealthRetentionTimer) {
      clearInterval(app.machineHealthRetentionTimer);
      app.machineHealthRetentionTimer = undefined;
    }
  });
}
