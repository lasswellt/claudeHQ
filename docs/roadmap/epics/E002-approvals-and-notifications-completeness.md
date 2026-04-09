---
id: E002
title: 'Approvals & Notifications Completeness'
phase: R2
domain: 'hooks-and-approvals, notifications, dashboard-core'
capabilities:
  ['CAP-025', 'CAP-027', 'CAP-028', 'CAP-030', 'CAP-031', 'CAP-032', 'CAP-033', 'CAP-042']
status: planned
depends_on: ['E001']
estimated_stories: 12
---

# Approvals & Notifications Completeness

## Description

Ship the full approvals experience for headless, interactive, and sub-agent scenarios. Add the SDK long-poll bridge so queued jobs participate in approvals, the three-way approve/edit/reject decision, Approve-and-Remember, the AskUserQuestion and MCP elicitation dialogs, browser + ntfy notification channels, batching and risk-based escalation, and the in-session approval banner.

## Capabilities Addressed

| ID      | Coverage                                                                           |
| ------- | ---------------------------------------------------------------------------------- |
| CAP-025 | SDK canUseTool → hub long-poll bridge with reconnection/backoff                    |
| CAP-027 | Three-way decision (approve/edit/reject) with feedback → session as system message |
| CAP-028 | Approve-and-Remember: checkbox → rule preview → saved rule with provenance         |
| CAP-030 | AskUserQuestion chat-bubble dialog (multiple-choice or text)                       |
| CAP-031 | MCP elicitation JSON-Schema form renderer                                          |
| CAP-032 | Browser Notification API + ntfy.sh channels added to notification router           |
| CAP-033 | 5s batching window and risk-based escalation rules                                 |
| CAP-042 | Sticky in-session approval banner with bulk quick-actions                          |

## Acceptance Criteria

1. Headless SDK sessions route approvals to hub via the canUseTool bridge and wait up to 10 minutes; on disconnect the bridge reconnects with exponential backoff.
2. Approval detail drawer exposes Approve / Edit / Reject. Edit validates modified tool_input against the tool schema. Reject feedback appears in the session terminal as a system message.
3. The Approve action shows a "Remember for similar requests" checkbox; checking it reveals a rule preview the user can customize, then saves an `approval_policy_rules` row referencing `created_from_approval_id`.
4. AskUserQuestion dialog renders a chat bubble with either multiple-choice buttons or a text input depending on the question type, honoring `askUserQuestion.previewFormat: markdown | html`.
5. MCP elicitation dialog renders a form from the elicitation JSON Schema (text, select, checkbox, date). Response is validated before submission.
6. Browser Notification API channel uses a service worker with approve/deny action buttons. ntfy.sh channel POSTs to a configured topic with click URL to the approval.
7. Notifications arriving within 5 seconds of each other for the same session batch into a single payload per channel.
8. Risk-based escalation: critical → urgent immediately; high + age>30s → high; medium + age>60s → normal; low → badge-only.
9. In-session approval banner is sticky, shows pending approvals for the current session only, supports Approve All Safe / Deny All bulk, and is collapsible.
10. All new UI components follow Vuetify 3 / status-indicator patterns documented in `.claude/rules/nuxt-patterns.md`.

## Technical Approach

- SDK bridge lives in `packages/agent/src/approvals/canusetool-bridge.ts`. Wraps the SDK's canUseTool callback; POSTs to hub with `{ toolName, input, sessionId, toolUseID }`. Uses `toolUseID` as the idempotency key on hub. Hub long-polls (5-10 min) until the request has a decision or timeout.
- Approve-and-Remember UI uses the `options.suggestions` field from the canUseTool signature (confirmed in research-cache) to pre-fill the rule preview.
- Notification batcher is a pure module in `packages/hub/src/notifications/batcher.ts` with a 5s debounce buffer keyed by `(sessionId, channel)`.
- Browser Notification channel: service worker in `packages/dashboard/public/sw.js`; hub stores VAPID keypair and signs push payloads.
- ntfy.sh channel: plain HTTP POST with `Title`, `Priority`, `Click` headers.

## Stories (Outline)

1. **SDK canUseTool bridge** — client wrapper + long-poll, reconnect with backoff. (Points: 5)
2. **Hub long-poll handler** — hold connection until decision/timeout, idempotency via toolUseID. (Points: 3)
3. **Three-way decision UI + API** — drawer buttons, tool-input validation, API extension. (Points: 5)
4. **Feedback-to-session injection** — rejected feedback becomes a system message in the session stream. (Points: 2)
5. **Approve-and-Remember flow** — checkbox, rule preview, save with provenance. (Points: 3)
6. **AskUserQuestion dialog** — Vuetify chat bubble component with multi-choice + text modes. (Points: 3)
7. **MCP elicitation form renderer** — JSON Schema → Vuetify form. (Points: 5)
8. **Notification batcher module** — 5s debounce, per-channel keying. (Points: 3)
9. **Risk escalation rules** — wire batcher output to severity ladder. (Points: 2)
10. **Browser Notification channel** — service worker, VAPID keys, action buttons. (Points: 5)
11. **ntfy.sh channel** — POST + topic config. (Points: 2)
12. **In-session approval banner** — sticky banner, bulk actions, collapsible. (Points: 3)

## Dependencies

- **Requires**: E001 (risk classifier unblocks escalation ladder)
- **Enables**: E004 (notifications infrastructure used by budget thresholds)

## Risk Factors

- Service worker setup has several failure modes on first load; test in Safari + Firefox + Chrome.
- Long-poll reconnection is subtle — ensure idempotency via toolUseID so duplicate POSTs on reconnect don't create duplicate approval_requests rows.
- MCP elicitation JSON Schema may include keyword features (oneOf, anyOf) the form renderer doesn't support; restrict scope to a documented subset and reject unsupported schemas with a clear error.
