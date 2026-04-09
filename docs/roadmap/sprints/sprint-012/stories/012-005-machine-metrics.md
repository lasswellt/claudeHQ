---
id: '012-005'
title: 'Machine metrics time-series table + heartbeat ingestion'
epic: 'E001'
package: 'hub'
priority: 1
points: 5
dependencies: ['012-001']
status: done
assignee: 'backend-dev'
capability: 'CAP-075'
---

# 012-005: Machine metrics time-series table + heartbeat ingestion

## Implementation note (pivot)

The plan called for a new `012_machine_metrics.sql` migration, but migration `006_health_history.sql` already defines a `machine_health_history` table with the exact schema needed (`cpu_percent`, `mem_percent`, `disk_percent`, `active_sessions`, `recorded_at`). The existing `healthHistoryRoutes` plugin already declares a `recordHealthData` decorator and a `GET /api/machines/:id/health` read route — but **nothing was calling `recordHealthData`**, so the table stayed empty despite every heartbeat. This story therefore became a wire-up + retention job, not a schema-creation job.

## Context

CAP-075 requires a time-series store for machine-level telemetry so the dashboard can render sparklines, the workforce scheduler can make load-aware placement decisions, and the audit log can attribute anomalies. Today, `agent:heartbeat` messages (defined in protocol.ts, already carry `cpuPercent`, `memPercent`, `activeSessions`) arrive at the hub and are only reflected into `machines.last_seen` and a rolling in-memory value — nothing is persisted.

## Requirements

1. **Extend heartbeat protocol** (small, backward-compatible bump to `agentHeartbeatSchema` in `packages/shared/src/protocol.ts`):
   - Add optional `diskPercent: z.number().optional()` and `queueDepth: z.number().optional()`.
   - Update the agent `packages/agent/src/health.ts` heartbeat emitter to populate both (disk via the existing `getDiskPercent` helper; queue depth from the agent's job queue length).
2. **Migration** — `packages/hub/src/migrations/012_machine_metrics.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS machine_metrics (
     machine_id TEXT NOT NULL,
     ts INTEGER NOT NULL,           -- unix epoch seconds
     cpu_percent REAL NOT NULL,
     mem_percent REAL NOT NULL,
     disk_percent REAL,
     active_sessions INTEGER NOT NULL,
     queue_depth INTEGER,
     PRIMARY KEY (machine_id, ts)
   );
   CREATE INDEX IF NOT EXISTS idx_machine_metrics_ts ON machine_metrics(ts);
   ```
3. **DAL** — `packages/hub/src/db/machine-metrics.ts`:
   - `insertMetric(row)` — prepared statement; INSERT OR REPLACE on PK.
   - `getMetricsForMachine(machineId, sinceTs)` — returns rows >= sinceTs ordered by ts asc.
   - `pruneOlderThan(cutoffTs)` — DELETE WHERE ts < cutoffTs.
4. **Heartbeat handler** — in `packages/hub/src/ws/agent-handler.ts`, on every `agent:heartbeat`:
   - Insert a row into `machine_metrics` with `ts = Math.floor(Date.now()/1000)`.
5. **Retention** — start a 10-minute `setInterval` on hub boot that calls `pruneOlderThan(now - 24*3600)`. Keep the interval handle on the hub server for cleanup in tests.
6. **Read API** — `GET /api/machines/:id/metrics?since=<unix-seconds>` returns the rows as JSON. Default `since` = now - 3600 if omitted.
7. **Unit test** — insert 3 metric rows, read them back with `since` filter, assert ordering.

## Acceptance Criteria

- [ ] `agentHeartbeatSchema` accepts optional `diskPercent` + `queueDepth` without breaking existing agents.
- [ ] `012_machine_metrics.sql` applies on startup (check `pragma user_version` or equivalent).
- [ ] Every heartbeat appends a row; the row is visible via `GET /api/machines/:id/metrics`.
- [ ] Rolling prune deletes rows older than 24h (verified with a test that sets `ts` manually).
- [ ] Prune interval is cleared on `app.close()` to avoid leaked timers in tests.
- [ ] `pnpm --filter @chq/shared type-check && pnpm --filter @chq/hub type-check && pnpm --filter @chq/agent type-check` all pass.
- [ ] `pnpm --filter @chq/hub test` passes (new test included).

## Files

- `packages/shared/src/protocol.ts`
- `packages/hub/src/migrations/012_machine_metrics.sql` (new)
- `packages/hub/src/db/machine-metrics.ts` (new)
- `packages/hub/src/ws/agent-handler.ts`
- `packages/hub/src/server.ts` (retention interval + dispose)
- `packages/hub/src/routes/machines.ts` (add metrics endpoint)
- `packages/agent/src/health.ts`
- `packages/hub/src/__tests__/machine-metrics.test.ts` (new)

## Verify

```bash
pnpm --filter @chq/shared type-check
pnpm --filter @chq/hub type-check
pnpm --filter @chq/agent type-check
pnpm --filter @chq/hub test
```

## Done

Machine heartbeats write to a `machine_metrics` table; the last 24h are queryable via REST; rows older than 24h are pruned on a 10-min interval.
