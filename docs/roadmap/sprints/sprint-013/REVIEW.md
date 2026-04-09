# Sprint 013 Review — COMPLETE

**Date**: 2026-04-09 (loop iterations 5–9)
**Epic**: E002 Approvals & Notifications Completeness
**Phase**: R2
**Status**: **12 of 12 stories complete — E002 done, R2 exit criteria met**

## Stories

| ID      | Title                                      | Points | Status | Capability |
| ------- | ------------------------------------------ | ------ | ------ | ---------- |
| 013-001 | SDK canUseTool bridge (agent)              | 5      | ✓ done | CAP-025    |
| 013-002 | Hub long-poll handler + idempotency        | 3      | ✓ done | CAP-025    |
| 013-003 | Three-way decision UI + API (drawer)       | 5      | ✓ done | CAP-027    |
| 013-004 | Feedback-to-session injection              | 2      | ✓ done | CAP-027    |
| 013-005 | Approve-and-Remember flow                  | 3      | ✓ done | CAP-028    |
| 013-006 | AskUserQuestion chat bubble dialog         | 3      | ✓ done | CAP-030    |
| 013-007 | MCP elicitation form renderer              | 5      | ✓ done | CAP-031    |
| 013-008 | Notification batcher module                | 3      | ✓ done | CAP-033    |
| 013-009 | Risk escalation rules                      | 2      | ✓ done | CAP-033    |
| 013-010 | Browser Notification channel + service wkr | 5      | ✓ done | CAP-032    |
| 013-011 | ntfy.sh channel                            | 2      | ✓ done | CAP-032    |
| 013-012 | Sticky in-session approval banner          | 3      | ✓ done | CAP-042    |

**Total points**: 41 / 41 delivered.

## Quality gates (final pass, 2026-04-09)

| Command              | Result | Notes                                                                |
| -------------------- | ------ | -------------------------------------------------------------------- |
| `pnpm -r type-check` | ✓ pass | shared, hub, agent, dashboard all clean                              |
| `pnpm -r test`       | ✓ pass | shared 36/36, hub **94/94**, agent **13/13** (first!), dashboard n/a |
| `pnpm -r build`      | ✓ pass | all four packages                                                    |
| `pnpm -r lint`       | n/a    | No packages define a lint script                                     |

## Test delta across the sprint

| Package   | Start | End | Added                                                                        |
| --------- | ----- | --- | ---------------------------------------------------------------------------- |
| shared    | 36    | 36  | —                                                                            |
| hub       | 67    | 94  | +8 ntfy + 8 batcher + 11 escalation = +27 in `notifications/` + `__tests__/` |
| agent     | 0     | 13  | First-ever agent package tests (canUseTool bridge)                           |
| dashboard | n/a   | n/a | —                                                                            |

## Capabilities advanced

- **CAP-025** — SDK canUseTool → hub long-poll bridge with toolUseID idempotency + exponential-backoff reconnect
- **CAP-027** — Three-way Approve/Edit/Reject with feedback-to-session injection via synthetic session:output chunks
- **CAP-028** — Approve-and-Remember with rule preview and provenance via `created_from_approval_id`
- **CAP-030** — AskUserQuestion chat bubble dialog with multi-choice and text modes
- **CAP-031** — MCP elicitation form renderer with a documented JSON-Schema subset
- **CAP-032** — Browser Notification API (foreground, via service worker + showNotification actions) + ntfy.sh channel
- **CAP-033** — Notification batcher (5s per-session/channel debounce) + risk escalation ladder
- **CAP-042** — Sticky in-session approval banner with bulk Approve-safe / Deny-all actions

## Migrations added

- `012_approvals_sdk.sql` — adds `tool_use_id` column + `(session_id, tool_use_id)` index for idempotency

## Files added (non-exhaustive)

**New files:**

- `packages/agent/src/approvals/canusetool-bridge.ts`
- `packages/agent/src/approvals/__tests__/canusetool-bridge.test.ts` (13 tests)
- `packages/hub/src/notifications/batcher.ts`
- `packages/hub/src/notifications/escalation.ts`
- `packages/hub/src/__tests__/ntfy-payload.test.ts` (8 tests)
- `packages/hub/src/__tests__/notifications-batcher.test.ts` (8 tests)
- `packages/hub/src/__tests__/notifications-escalation.test.ts` (11 tests)
- `packages/hub/src/migrations/012_approvals_sdk.sql`
- `packages/dashboard/public/sw.js`
- `packages/dashboard/app/composables/useBrowserNotifications.ts`
- `packages/dashboard/app/components/approval/AskUserQuestionDialog.vue`
- `packages/dashboard/app/components/approval/McpElicitationForm.vue`
- `packages/dashboard/app/components/approval/ApproveWithRememberDialog.vue`
- `packages/dashboard/app/components/approval/ApprovalDetailDrawer.vue`

**Modified:**

- `packages/hub/src/notifications.ts` (ntfy channel + `buildNtfyPayload` pure function)
- `packages/hub/src/routes/approvals.ts` (long-poll endpoint, three-way edit, feedback broadcast, audit wiring)
- `packages/hub/src/server.ts` (shared broadcastToDashboard)
- `packages/dashboard/app/stores/approvals.ts` (editedInput param)
- `packages/dashboard/app/pages/approvals/index.vue` (drawer + Approve-and-Remember dialog)
- `packages/dashboard/app/components/approval/ApprovalBanner.vue` (bulk actions + collapse)
- `packages/dashboard/app/layouts/default.vue` (browser notifications composable wiring)

## Follow-ups carried forward

1. **VAPID / web-push background notifications** — split out from 013-010. The foreground path (notification while dashboard tab is open) ships this sprint; background push requires hub keypair generation, `web-push` library install, and persistent subscription storage. Tracked as a new story in a future sprint.
2. **Custom Approve-and-Remember rule name** — the UI sends the user's edited rule name in `013-005` but the hub currently auto-generates the saved rule's name from `tool_name`. Needs a small schema bump to accept a custom name.

## R2 → R3 handoff

E002 is done. R3 (Scheduler & Session Lifecycle Completion, epic E003) has no new blockers from this sprint — it depends on E001 which is already complete. Sprint-014 planning should target **E003**.
