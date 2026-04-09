---
id: '012-006'
title: 'Audit log table + DAL wiring for every mutation route'
epic: 'E001'
package: 'hub'
priority: 1
points: 5
dependencies: ['012-001']
status: done
assignee: 'backend-dev'
capability: 'CAP-015'
---

# 012-006: Audit log table + DAL wiring for every mutation route

## Context

CAP-015 requires a persistent audit trail of every state-changing operation: who did what, to which entity, when, and with what payload. Downstream epics (E002 approvals, E004 cost budgets, E009 compliance sweep) all depend on audit_log already existing.

## Requirements

1. **Migration** — `packages/hub/src/migrations/013_audit_log.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS audit_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     action TEXT NOT NULL,           -- e.g. 'session.create', 'approval.resolve'
     entity_type TEXT NOT NULL,      -- 'session', 'machine', 'approval', 'job', ...
     entity_id TEXT NOT NULL,
     actor TEXT,                     -- 'user', 'system', 'agent:<machine-id>'
     details TEXT,                   -- JSON blob of the change payload
     created_at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
   CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
   ```
2. **DAL helper** — `packages/hub/src/db/audit-log.ts`:
   - `appendAudit({ action, entityType, entityId, actor, details })` — prepared insert; `created_at = Math.floor(Date.now()/1000)`; `details` is `JSON.stringify(payload)` when object, else string.
   - `listAuditLog({ entityType?, entityId?, since?, limit? })` — filtered read.
3. **Wire into mutation routes** — audit every state-changing operation:
   - Session create / kill / update tags → action `session.create` / `session.kill` / `session.update_tags`
   - Approval resolve → action `approval.resolve`
   - Queue add / remove / reorder → action `queue.add` / `queue.remove` / `queue.reorder`
   - Workforce repo create + job create/cancel → action `repo.create`, `job.create`, `job.cancel`
   - Spawned-agent lifecycle (create/remove) → action `spawned_agent.create` / `spawned_agent.remove`
4. **Transactional atomicity** — audit writes must run inside the same `better-sqlite3` transaction as the primary mutation for routes that already use one. Use a `db.transaction(...)` wrapper where they don't.
5. **Read API** — `GET /api/audit-log?entityType=&entityId=&since=&limit=100` returns paginated rows.
6. **Tests** —
   - Unit test: create a session → assert an `audit_log` row exists with `action=session.create`.
   - Unit test: kill a non-existent session → expect 404 and NO audit row (failed mutations do not audit).

## Acceptance Criteria

- [ ] `013_audit_log.sql` applied; table + indexes exist.
- [ ] `appendAudit` used by every mutation handler listed above.
- [ ] Audit row count increments by exactly 1 per successful mutation in the integration tests.
- [ ] Failed mutations (404, 400, 500) do not append audit rows — verified by negative tests.
- [ ] Multi-statement transactions still commit atomically (audit + primary write succeed or fail together).
- [ ] `pnpm --filter @chq/hub type-check && pnpm --filter @chq/hub test` pass.

## Files

- `packages/hub/src/migrations/013_audit_log.sql` (new)
- `packages/hub/src/db/audit-log.ts` (new)
- `packages/hub/src/routes/sessions.ts`
- `packages/hub/src/routes/queues.ts`
- `packages/hub/src/routes/approvals.ts`
- `packages/hub/src/routes/agents.ts` (spawned agents)
- `packages/hub/src/routes/jobs.ts` (if exists)
- `packages/hub/src/routes/repos.ts` (if exists)
- `packages/hub/src/routes/audit-log.ts` (new read route)
- `packages/hub/src/__tests__/audit-log.test.ts` (new)

## Verify

```bash
pnpm --filter @chq/hub type-check
pnpm --filter @chq/hub test
```

## Done

Every hub mutation records an atomic audit row; failed mutations do not; the log is readable via REST with filters.
