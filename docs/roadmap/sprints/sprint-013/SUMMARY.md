# Sprint 013 — E002 Approvals & Notifications Completeness

- **Phase**: R2
- **Epic**: E002 — Approvals & Notifications Completeness
- **Status**: in-progress
- **Created**: 2026-04-08
- **Stories**: 12 / **Points**: 41

## Story Index

Story specs live inline in this summary until the implementation phase touches them; at that point a full spec file is written to `stories/013-NNN-*.md`. This avoids bloat for stories that get absorbed into smaller ones during implementation.

| ID      | Title                                      | Points | Assignee     | Capability | Blocks  |
| ------- | ------------------------------------------ | ------ | ------------ | ---------- | ------- |
| 013-001 | SDK canUseTool bridge (agent)              | 5      | agent-dev    | CAP-025    | 013-002 |
| 013-002 | Hub long-poll handler + idempotency        | 3      | backend-dev  | CAP-025    | 013-003 |
| 013-003 | Three-way decision UI + API                | 5      | frontend-dev | CAP-027    | 013-004 |
| 013-004 | Feedback-to-session injection              | 2      | backend-dev  | CAP-027    |         |
| 013-005 | Approve-and-Remember flow                  | 3      | frontend-dev | CAP-028    |         |
| 013-006 | AskUserQuestion chat bubble dialog         | 3      | frontend-dev | CAP-030    |         |
| 013-007 | MCP elicitation form renderer              | 5      | frontend-dev | CAP-031    |         |
| 013-008 | Notification batcher module                | 3      | backend-dev  | CAP-033    | 013-009 |
| 013-009 | Risk escalation rules                      | 2      | backend-dev  | CAP-033    |         |
| 013-010 | Browser Notification channel + service wkr | 5      | frontend-dev | CAP-032    |         |
| 013-011 | ntfy.sh channel                            | 2      | backend-dev  | CAP-032    |         |
| 013-012 | Sticky in-session approval banner          | 3      | frontend-dev | CAP-042    |         |

## Dependency Graph

```
013-001 (bridge)  ──▶ 013-002 (long-poll) ──▶ 013-003 (3-way UI) ──▶ 013-004 (feedback injection)
                                                      │
                                                      ├─▶ 013-005 (remember)
013-006 (AskUserQuestion)   — independent
013-007 (MCP elicitation)   — independent
013-008 (batcher) ──▶ 013-009 (escalation)
013-010 (browser notif)     — independent
013-011 (ntfy)              — independent
013-012 (banner enhancement) — independent (banner already exists)
```

## Implementation order within the sprint

Prioritize by (a) unblock downstream, (b) low-risk wins, (c) pre-existing scaffolding.

Round 1 (this loop): 013-012 banner enhancement (existing component, small), 013-011 ntfy channel (pure module, small)
Round 2: 013-008 batcher module + 013-009 escalation rules
Round 3: 013-001 SDK bridge + 013-002 long-poll handler (needs shared toolUseID idempotency)
Round 4: 013-003 three-way UI + 013-004 feedback injection + 013-005 remember
Round 5: 013-006 AskUserQuestion dialog + 013-007 MCP elicitation form
Round 6: 013-010 browser notification + service worker (hardest to test)

## Notes

- `ApprovalBanner.vue` exists but is basic. Story 013-012 adds bulk actions + collapse.
- `NotificationEngine` exists in `packages/hub/src/notifications.ts`. Story 013-008 adds a batcher layer on top; do not rewrite.
- Risk classifier from 012-007 is the source of truth for the escalation ladder (story 013-009).
- Audit logger from 012-006 should be called for every approval resolution and policy rule save in this sprint's stories.
