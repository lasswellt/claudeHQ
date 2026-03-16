import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';

export async function healthHistoryRoutes(app: FastifyInstance, db: Database.Database): Promise<void> {
  // Record health data (called internally from heartbeat handler)
  const insertStmt = db.prepare(`
    INSERT INTO machine_health_history (machine_id, cpu_percent, mem_percent, disk_percent, active_sessions)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Get health history for a machine
  app.get<{
    Params: { id: string };
    Querystring: { hours?: string };
  }>('/api/machines/:id/health', async (req) => {
    const hours = req.query.hours ? parseInt(req.query.hours, 10) : 24;
    const since = Math.floor(Date.now() / 1000) - hours * 3600;

    const rows = db
      .prepare(
        'SELECT * FROM machine_health_history WHERE machine_id = ? AND recorded_at >= ? ORDER BY recorded_at',
      )
      .all(req.params.id, since);

    return rows;
  });

  // Expose the insert function for the agent handler to use
  return Object.assign(app, {
    recordHealthData(
      machineId: string,
      cpuPercent: number,
      memPercent: number,
      diskPercent: number | null,
      activeSessions: number,
    ): void {
      insertStmt.run(machineId, cpuPercent, memPercent, diskPercent, activeSessions);
    },
  });
}
