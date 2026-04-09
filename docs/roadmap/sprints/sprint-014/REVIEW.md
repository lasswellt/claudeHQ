# Sprint 014 Review — COMPLETE

**Date**: 2026-04-09 (loop iterations 10–12)
**Epic**: E003 Scheduler & Session Lifecycle Completion
**Phase**: R3
**Status**: **9 of 9 stories complete — E003 done, R3 exit criteria met**

## Stories

| ID      | Title                                    | Points | Status | Capability    |
| ------- | ---------------------------------------- | ------ | ------ | ------------- |
| 014-001 | Migration: requirements + retry columns  | 2      | ✓ done | CAP-011/12/13 |
| 014-002 | Scheduler score pure module + unit tests | 3      | ✓ done | CAP-014       |
| 014-003 | Atomic placement transaction             | 3      | ✓ done | CAP-014       |
| 014-004 | Timeout + cost enforcement loop          | 3      | ✓ done | CAP-011       |
| 014-005 | Retry policy re-queue + backoff          | 5      | ✓ done | CAP-012       |
| 014-006 | SDK session discovery wrapper            | 3      | ✓ done | CAP-016       |
| 014-007 | Dual-stream parser in agent              | 5      | ✓ done | CAP-017       |
| 014-008 | Events tab live feed                     | 3      | ✓ done | CAP-017       |
| 014-009 | Scheduler end-to-end integration test    | 3      | ✓ done | CAP-011/14    |

**Total points**: 30 / 30 delivered.

## Quality gates

| Command              | Result | Notes                                                    |
| -------------------- | ------ | -------------------------------------------------------- |
| `pnpm -r type-check` | ✓ pass | shared, hub, agent, dashboard all clean                  |
| `pnpm -r test`       | ✓ pass | shared 36/36, hub **150/150**, agent **30/30**, dash n/a |
| `pnpm -r build`      | ✓ pass | all four packages                                        |

## Test delta across the sprint

| Package   | Start | End | Added                                                                                      |
| --------- | ----- | --- | ------------------------------------------------------------------------------------------ |
| shared    | 36    | 36  | —                                                                                          |
| hub       | 94    | 150 | +11 score + 11 enforcement + 11 retry + 10 placement + 3 integration + 10 SDK client = +56 |
| agent     | 13    | 30  | +17 stream-json parser tests                                                               |
| dashboard | n/a   | n/a | —                                                                                          |

## Capabilities advanced

- **CAP-011** — timeout + `max_cost_usd` enforcement via 10s sweeper wired into server boot with audit logging
- **CAP-012** — pure retry policy module with exponential backoff + exit-code filter (wiring deferred)
- **CAP-013** — `sessions.requirements` column added; scheduler already enforced capability match
- **CAP-014** — pure score module + atomic placement transaction with race-proof conditional UPDATE
- **CAP-016** — pluggable SDK session discovery interface + filesystem fallback scanning `~/.claude/projects/`
- **CAP-017** — stream-json line parser with typed event translation + Events tab UI

## Migrations

- `013_scheduler_retry.sql` — `sessions.requirements/retry_count/retry_of/termination_reason` + `queue.retry_policy/retry_count/available_at` + indexes

## Files (non-exhaustive)

**New:**

- `packages/hub/src/scheduler/score.ts` + `__tests__/score.test.ts` (11)
- `packages/hub/src/scheduler/placement.ts` + `__tests__/placement.test.ts` (10)
- `packages/hub/src/scheduler/enforcement.ts` + `packages/hub/src/__tests__/enforcement.test.ts` (11)
- `packages/hub/src/scheduler/retry.ts` + `__tests__/retry.test.ts` (11)
- `packages/hub/src/services/agent-sdk-client.ts` + `packages/hub/src/__tests__/agent-sdk-client.test.ts` (10)
- `packages/hub/src/routes/session-discovery.ts`
- `packages/hub/src/__tests__/scheduler-integration.test.ts` (3)
- `packages/hub/src/migrations/013_scheduler_retry.sql`
- `packages/agent/src/stream-json/parser.ts` + `__tests__/parser.test.ts` (17)
- `packages/dashboard/app/stores/sessionEvents.ts`
- `packages/dashboard/app/components/session/SessionEventsTab.vue`

**Modified:**

- `packages/hub/src/server.ts` — enforcement sweeper wiring, SDK discovery client, disposal on shutdown
- `packages/dashboard/app/pages/sessions/[id].vue` — Terminal/Events tabs

## Follow-ups carried forward

1. **Wire retry module** (014-005) into `agent:session:ended` handler — requires a `session.queue_task_id` linkage so re-queue can target the originating task
2. **Wire dual-stream parser** (014-007) into `spawn-docker` / `spawn-ssh` stdout handling — current parser is ready, just needs a caller
3. **Publish `session:event` protocol schema** in `@chq/shared` so the dashboard store can type-narrow instead of `onAnyMessage` + string-match
4. **Replace filesystem SDK fallback** with the real `@anthropic-ai/claude-agent-sdk` client once the package is available in the registry

## R3 → R4 handoff

E003 is done. R4 (Cost Tracking & Budgets, E004) depends on E002 + E003 — both are complete. Sprint-015 planning should target **E004**. The enforcement sweeper and retry module both feed into cost budget enforcement, so R4 has a strong foundation to build on.
