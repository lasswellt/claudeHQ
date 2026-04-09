---
id: E001
title: 'Stability & Foundations Finish'
phase: R1
domain: 'multi (session-lifecycle, observability, hooks-and-approvals)'
capabilities: ['CAP-010', 'CAP-015', 'CAP-022', 'CAP-075']
review_findings_resolved: ['HI-01', 'HI-03', 'HI-04', 'HI-05']
status: planned
depends_on: []
estimated_stories: 8
---

# Stability & Foundations Finish

## Description

Unblock every downstream workstream by resolving the four blocking findings from the 2026-03-16 codebase review and shipping foundations that other phases need: the audit log, the machine-metrics store, the session-tags column, and the risk classifier.

## Capabilities Addressed

| ID      | Coverage                                                                           |
| ------- | ---------------------------------------------------------------------------------- |
| CAP-010 | Ship sessions.tags column migration, API support, and session list filter UI       |
| CAP-015 | Create audit_log table and wire it to every mutation route                         |
| CAP-022 | Build approvals/risk-classifier.ts with low/medium/high/critical assignment        |
| CAP-075 | Create machine_metrics time-series table with rolling window + heartbeat ingestion |

## Acceptance Criteria

1. Review finding HI-01 resolved: all 5 approval and 13 workforce message schemas are members of the correct discriminated union in `packages/shared/src/protocol.ts`.
2. Review finding HI-03 resolved: approval message schemas re-exported from `packages/shared/src/browser.ts`.
3. Review finding HI-04 resolved: `replay.vue` renders its terminal container unconditionally (use v-show for loader overlay).
4. Review finding HI-05 resolved: dashboard connection chip binds to the real WebSocket state.
5. `audit_log` table created and every mutation route appends a row with `{ action, entity_type, entity_id, details, created_at }`.
6. `machine_metrics` table created; agent heartbeat writes CPU%, memory%, disk%, active sessions, queue depth. Rolling window retains last 24 hours.
7. `sessions.tags` TEXT column added; API accepts `tags[]` on create; session list view has a tag filter pill.
8. `approvals/risk-classifier.ts` assigns low/medium/high/critical based on tool + pattern. Unit test fixtures cover Read/Glob/Grep → low, Edit → medium, Bash → high, `rm -rf`/`sudo`/`curl | bash` → critical.

## Technical Approach

- Start with protocol cleanup (HI-01, HI-03) in `packages/shared` — every other R-phase depends on this. Single commit.
- Dashboard bugs (HI-04, HI-05) are small independent fixes — batch into a second commit.
- Three migrations: `0NN_session_tags.sql`, `0NN_audit_log.sql`, `0NN_machine_metrics.sql`. Apply in the existing `packages/hub/src/migrations/` runner.
- Audit log wiring: wrap existing DAL mutation methods with a helper that appends to audit_log atomically (same transaction).
- Risk classifier: pure module in `packages/hub/src/approvals/risk-classifier.ts`, no hub dependencies. Easy to unit-test in isolation.

## Stories (Outline)

1. **Protocol cleanup** — add approval/workforce schemas to discriminated unions + browser.ts re-exports. (Points: 3)
2. **Dashboard lifecycle fixes** — fix replay v-else and hardcoded connection chip. (Points: 2)
3. **Session tags migration + API** — column, tests, route support. (Points: 3)
4. **Session tags filter UI** — tag pill component + filter state in list view. (Points: 3)
5. **Machine metrics migration + ingestion** — table, rolling window, heartbeat writer. (Points: 5)
6. **Audit log migration + DAL wiring** — table, helper, mutation route coverage. (Points: 5)
7. **Risk classifier module** — pure module + unit tests + integration into request-creation path. (Points: 3)
8. **R1 exit test pass** — full type-check/lint/test/build sweep + regression check. (Points: 2)

## Dependencies

- **Requires**: None — entry phase
- **Enables**: E002 (risk classifier), E003 (metrics + tags), E005 (protocol cleanup unblocks workforce WS wiring)

## Risk Factors

- Protocol cleanup may surface additional hidden message-type drift — budget an extra point for discovery.
- Audit log wiring across many routes is error-prone; a single test harness that hits every mutation endpoint is worth writing.
