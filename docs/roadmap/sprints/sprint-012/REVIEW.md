# Sprint 012 Review — COMPLETE

**Date**: 2026-04-08 (loop iterations 1–4)
**Epic**: E001 Stability & Foundations Finish
**Phase**: R1
**Status**: **8 of 8 stories complete — E001 done, R1 exit criteria met**

## Stories

| ID      | Title                                    | Points | Status | Notes                                                                 |
| ------- | ---------------------------------------- | ------ | ------ | --------------------------------------------------------------------- |
| 012-001 | Protocol discriminated-union cleanup     | 3      | ✓ done | HI-01, HI-03 fixed; 11 new protocol fixture tests                     |
| 012-002 | Dashboard replay + connection chip fixes | 2      | ✓ done | HI-04, HI-05 fixed                                                    |
| 012-003 | sessions.tags API + DAL                  | 3      | ✓ done | Column already in 005_enhanced_schema; DAL/route wired                |
| 012-004 | Session tags filter UI                   | 3      | ✓ done | Pinia store + chip row + NewSessionModal combobox                     |
| 012-005 | Machine metrics / heartbeat ingestion    | 5      | ✓ done | Wired existing `machine_health_history` + added retention interval    |
| 012-006 | audit_log table + DAL wiring             | 5      | ✓ done | New 011 migration, DAL module, routes/sessions/queues/approvals wired |
| 012-007 | Approvals risk classifier                | 3      | ✓ done | Module existed; 40 comprehensive unit tests added                     |
| 012-008 | R1 exit quality sweep                    | 2      | ✓ done | Full workspace gate passed                                            |

**Total points**: 26 (planned) / 26 (delivered)

## Review findings resolved

| Finding | Severity | Status  | Fix                                                              |
| ------- | -------- | ------- | ---------------------------------------------------------------- |
| HI-01   | high     | ✓ fixed | 18 approval + workforce/container schemas added to the 3 unions  |
| HI-03   | high     | ✓ fixed | Approval message schemas re-exported from browser.ts             |
| HI-04   | high     | ✓ fixed | replay.vue terminal container renders unconditionally via v-show |
| HI-05   | high     | ✓ fixed | Nav drawer chip binds to `useWebSocket().state`                  |

## Capabilities advanced

- **CAP-010** — session tags end-to-end (schema, DAL, API, filter UI, create modal)
- **CAP-015** — audit_log table + DAL helper + wired into sessions/queues/approvals routes
- **CAP-022** — risk classifier module with 40-test coverage, integrated into /hooks/permission-request
- **CAP-075** — machine health time-series populated from heartbeats; 24h rolling retention

## Quality gates (final pass, 2026-04-08)

| Command              | Result | Notes                                                         |
| -------------------- | ------ | ------------------------------------------------------------- |
| `pnpm -r type-check` | ✓ pass | shared, hub, agent, dashboard all clean                       |
| `pnpm -r test`       | ✓ pass | shared **36/36**, hub **67/67**, agent 0 (no tests), dash n/a |
| `pnpm -r build`      | ✓ pass | shared (tsup), agent (tsup), hub (tsup), dashboard (nuxt)     |
| `pnpm -r lint`       | n/a    | No packages define a lint script                              |

## Test delta across the sprint

| Package   | Start                                | End | Added                                                             |
| --------- | ------------------------------------ | --- | ----------------------------------------------------------------- |
| shared    | 25                                   | 36  | +11 HI-01 discriminated-union fixture tests                       |
| hub       | pre-existing broken workspace config | 67  | +4 tag DAL + 40 risk-classifier + 3 machine-health + 10 audit-log |
| agent     | 0                                    | 0   | —                                                                 |
| dashboard | n/a                                  | n/a | —                                                                 |

## Fixes made beyond story scope

- **Vitest workspace config bug** (iteration 1): root `vitest.config.ts` referenced `projects: ['packages/*']` but no per-package config existed. Added minimal `vitest.config.ts` to `packages/shared`, `packages/hub`, `packages/agent`. Without this fix, `pnpm -r test` would fail to discover any projects and the entire R1 phase could not run tests.
- **Agent empty-test handling** (iteration 1): `passWithNoTests: true` on agent's vitest config.

## Migrations added this sprint

- `011_audit_log.sql` — new CAP-015 table with indexes on (entity_type, entity_id), created_at, action.

## Files added/changed (non-exhaustive)

**New files:**

- `packages/hub/src/audit-log.ts` (DAL helper)
- `packages/hub/src/migrations/011_audit_log.sql`
- `packages/hub/src/routes/audit-log.ts`
- `packages/hub/src/__tests__/audit-log.test.ts` (10 tests)
- `packages/hub/src/__tests__/machine-health.test.ts` (3 tests)
- `packages/hub/src/approvals/__tests__/risk-classifier.test.ts` (40 tests)
- `packages/{shared,hub,agent}/vitest.config.ts` (3 per-package configs)

**Modified:**

- `packages/shared/src/protocol.ts` (discriminated union membership)
- `packages/shared/src/browser.ts` (re-exports)
- `packages/shared/src/types.ts` (SessionRecord.tags)
- `packages/shared/src/__tests__/protocol.test.ts` (+11 fixture tests)
- `packages/hub/src/dal.ts` (tags DAL)
- `packages/hub/src/server.ts` (auditLogger wiring)
- `packages/hub/src/routes/sessions.ts` (tags + audit)
- `packages/hub/src/routes/queues.ts` (audit)
- `packages/hub/src/routes/approvals.ts` (audit)
- `packages/hub/src/routes/health.ts` (retention interval)
- `packages/hub/src/ws/agent-handler.ts` (recordHealthData call + default branch)
- `packages/dashboard/app/stores/sessions.ts` (tag filter state)
- `packages/dashboard/app/pages/sessions/index.vue` (filter chip row)
- `packages/dashboard/app/pages/sessions/[id]/replay.vue` (v-show container fix)
- `packages/dashboard/app/layouts/default.vue` (live connection chip)
- `packages/dashboard/app/components/session/NewSessionModal.vue` (tags combobox)

## R1 → R2 handoff

E001 is done. R2 (Approvals & Notifications Completeness, epic E002) now has every foundation it needs:

- Risk classifier is pure, tested, and wired into approval-creation (CAP-022 ✓)
- Audit logger ready for E002 approval.\* events (CAP-015 ✓)
- Approval message schemas are members of the top-level discriminated unions (HI-01 ✓)
- Approval message schemas importable from `@chq/shared/browser` (HI-03 ✓)

Sprint-013 planning should target **E002**.
