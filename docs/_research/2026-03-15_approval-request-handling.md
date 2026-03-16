---
title: "Approval Request Handling: Permission, Input & Policy Architecture"
date: 2026-03-15
tags: [architecture, permissions, approvals, hooks, policy, notifications, ux, dashboard]
status: complete
related: [docs-audit, workforce-management-platform]
packages: [agent, hub, dashboard, shared]
---

# Approval Request Handling: Permission, Input & Policy Architecture

## Summary

Claude Code generates five types of approval/input requests: tool permission prompts, `AskUserQuestion` free-text questions, plan approvals, MCP elicitation dialogs, and MCP auth flows. The recommended interception strategy uses `PermissionRequest` HTTP hooks (for PTY sessions) and the Agent SDK's `canUseTool` callback (for headless sessions), both routing through the Hub to a policy engine that auto-resolves safe actions and queues risky ones for human decision via the Dashboard. The architecture adds an `approval_requests` table, a rule-based policy engine, a timeout sweeper, an approval queue page with bulk actions, and layered notifications (dashboard toast + browser notifications + Slack/Discord/ntfy.sh push). The key design principles: default-deny on timeout, three-way decisions (approve/edit/reject), and "Approve & Remember" to build policy rules from real decisions.

## Research Questions

1. What types of approval/permission/input requests does Claude Code generate, and what hooks intercept them?
2. How should the architecture route requests through Hub → Dashboard → user and back?
3. What policy/rules system can auto-approve safe actions and escalate risky ones?
4. What UX patterns from other systems work for remote approval?
5. How do we handle timeouts, queuing, and notification for pending approvals?

## Findings

### 1. Claude Code Permission Modes & Interception Points

#### Five Permission Modes

| Mode | Auto-Approves | Prompts For | Key Behavior |
|------|--------------|-------------|--------------|
| `default` | Read-only tools (Read, Grep, Glob) | Bash, file modifications | Standard interactive |
| `acceptEdits` | File ops (Edit, Write, mkdir, rm, mv, cp) | Non-filesystem Bash | Good for prototyping |
| `plan` | Nothing executes | N/A | Read-only analysis + AskUserQuestion |
| `dontAsk` | Only tools in allowedTools rules | Nothing — unapproved auto-**denied** | SDK-only; `canUseTool` never called |
| `bypassPermissions` | Everything | Nothing | Deny rules + hooks still execute first |

`--dangerously-skip-permissions` activates `bypassPermissions` but **cannot skip**: deny rules (`disallowedTools`), hooks (`PreToolUse`), managed policy `disableBypassPermissionsMode`, or explicit `ask` rules in settings.

Permission mode can be changed mid-session: `Shift+Tab` in interactive, `setPermissionMode()` in SDK.

#### Permission Evaluation Order

```
1. Hooks (PreToolUse) → can allow, deny, or pass through
2. Deny rules (disallowedTools + settings.deny) → always block, even in bypass mode
3. Permission mode → bypass approves all; acceptEdits approves file ops
4. Allow rules (allowedTools + settings.allow) → auto-approve matching tools
5. canUseTool callback → if nothing resolved above (skipped in dontAsk mode)
6. Interactive prompt → shown to user in terminal (PTY only)
```

#### Three Interception Points for Claude HQ

| Mechanism | Fires In | Can Block? | Payload | Response |
|-----------|----------|------------|---------|----------|
| **`PreToolUse` HTTP hook** | All modes | Yes | tool_name, tool_input, session_id | `permissionDecision: "allow"/"deny"/"ask"`, can modify input |
| **`PermissionRequest` HTTP hook** | Interactive only (NOT `-p` mode) | Yes | tool_name, tool_input, decision context | `decision.behavior: "allow"/"deny"`, can add always-allow rules |
| **SDK `canUseTool` callback** | SDK `query()` only | Yes | toolName, input | `{ behavior: "allow"/"deny", updatedInput?, message? }` |

**Critical finding:** `PermissionRequest` hook does NOT fire in headless (`-p`) mode. For headless sessions, use `PreToolUse` hooks or SDK `canUseTool`.

#### Five Types of Input Requests

| Type | Mechanism | Interactive Appearance | Headless Handling |
|------|-----------|----------------------|-------------------|
| **Tool permission** | "Allow Bash: rm -rf ./dist?" | Y/n dialog with always-allow option | Auto-denied unless hooks/rules/bypass |
| **AskUserQuestion** | Claude asks free-text question | Multiple-choice or text in terminal | Routes through `canUseTool` in SDK |
| **Plan approval** | Claude presents multi-step plan | Plan text + proceed? prompt | Team lead reviews in agent teams |
| **MCP Elicitation** | MCP server requests structured input | Form fields or URL auth dialog | `Elicitation` command hook |
| **MCP Auth** | MCP OAuth flow | Browser opens for auth | `Elicitation` hook with URL mode |

#### The `Notification` Hook (Observation Only)

Fires for: `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`. **Cannot block or respond** — it is observability-only. Use it for push notifications to external systems; use `PreToolUse`/`PermissionRequest`/`canUseTool` for actual approval logic.

#### Permission Rules Syntax

```
Bash(npm run *)              — glob pattern on command
Bash(git log *)              — prefix match
Read(./.env)                 — relative path
Edit(/src/**/*.ts)           — gitignore-style glob
WebFetch(domain:example.com) — domain match
mcp__server__tool            — MCP tool match
Agent(Explore)               — subagent match
```

Evaluation: deny → ask → allow. First match wins. Bash patterns fragile for complex argument matching — use `PreToolUse` hooks for reliable validation.

#### Agent Teams & Permissions

Teammates inherit the lead's permission settings. Permission requests from teammates bubble up to the lead. Pre-approve common operations before spawning teammates.

### 2. Approval Routing Architecture

#### Two Primary Paths

**Path A: SDK/Headless (Recommended for background jobs)**

```
Claude Code (SDK) needs permission
  → canUseTool(toolName, toolInput) fires
  → Agent callback POSTs to Hub: POST /api/approvals
  → Hub creates record, evaluates policy engine
    → Auto-resolve? Return immediately
    → Require human? Hold request (long-poll), notify dashboard
  → User responds in dashboard
  → Hub returns decision to Agent's waiting HTTP request
  → canUseTool callback resolves → Claude proceeds or skips
```

**Path B: PTY with PermissionRequest Hook (For interactive sessions)**

```
Claude Code (PTY) hits permission boundary
  → PermissionRequest HTTP hook fires
  → POST to Hub: /hooks/permission-request
  → Hub creates record, evaluates policy, waits for decision
  → Hub responds to hook HTTP request with decision JSON
  → Claude Code accepts and proceeds
```

**Path C: PTY Fallback (No hooks configured — last resort)**

```
Claude Code shows "Allow Write? (Y/n)" in terminal
  → Agent regex-detects the prompt in PTY output
  → Agent sends to Hub via WebSocket
  → Same flow → User responds
  → Agent writes "y\n" or "n\n" to PTY stdin
```

**Recommended strategy:** Configure `PermissionRequest` + `PreToolUse` HTTP hooks in `~/.claude/settings.json` before spawning any session (the Agent daemon does this on startup). Use SDK `canUseTool` for headless sessions. Path C is the fragile fallback.

| Session Type | Permission Mode | Interception | Response |
|---|---|---|---|
| User watching (interactive) | Hooks enabled | PermissionRequest HTTP hook | Hook HTTP response |
| Background job (headless) | SDK `canUseTool` | SDK callback | Callback return |
| Trusted fire-and-forget | `bypassPermissions` | None | N/A |
| Legacy fallback PTY | Default, no hooks | Regex detection | PTY stdin write |

### 3. Policy Engine

#### Rule-Based Auto-Resolution

Inspired by AWS IAM (default-deny, explicit-deny-always-wins) and OPA (policy-as-code):

```sql
CREATE TABLE approval_policy_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,      -- lower = evaluated first

  -- Matching conditions (AND logic: all non-null must match)
  match_request_type TEXT,                     -- JSON: ['permission'] or null
  match_tool_name TEXT,                        -- JSON: ['Read', 'Glob'] or null
  match_bash_command_pattern TEXT,             -- regex on Bash command
  match_file_path_pattern TEXT,               -- glob on file paths
  match_session_tags TEXT,                     -- JSON: session must have ALL
  match_machine_id TEXT,                      -- specific machine or null
  match_risk_level TEXT,                       -- JSON: ['low', 'medium'] or null

  -- Action
  action TEXT NOT NULL,                        -- auto_approve, auto_deny, require_approval
  timeout_override_seconds INTEGER,

  -- Metadata
  created_from_approval_id TEXT,               -- if from "Approve & Remember"
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

#### Default Rules (Shipped Out of Box)

| Priority | Rule | Action |
|----------|------|--------|
| 10 | Read, Glob, Grep, LS, View | auto_approve |
| 20 | Bash matching `rm -rf /, sudo, curl\|bash, chmod 777, mkfs, dd if=, shutdown` | auto_deny |
| 30 | Bash matching `ls, cat, head, tail, git status/log/diff, npm test, pnpm test, tsc, eslint` | auto_approve |
| 40 | Edit/Write for `**/*.{ts,tsx,js,jsx,vue,css,scss,html,json,yaml,md}` | auto_approve |
| 50 | All other Bash | require_approval |
| 60 | MCP elicitation/auth | require_approval |
| 1000 | Default catch-all | require_approval |

#### Evaluation Algorithm

```
1. If session.permissionMode === 'bypassPermissions' → auto_approve
2. Fetch enabled rules ordered by priority ASC
3. First matching rule wins → return its action
4. No match → require_approval (default-deny)
```

#### Three Configuration Channels

1. **Dashboard UI** (`/settings/approval-policies`) — full CRUD, drag-to-reorder, regex test widget
2. **"Approve & Remember"** — user approves and checks "Remember this" → auto-creates rule from the specific tool + input pattern
3. **REST API** (`/api/approval-policies`) — programmatic configuration

Rules are global to the Hub but session tags provide scoping: a rule with `match_session_tags: ["trusted"]` only fires for trusted sessions.

### 4. Data Model

```sql
CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  job_id TEXT REFERENCES jobs(id),
  machine_id TEXT NOT NULL REFERENCES machines(id),

  -- Classification
  request_type TEXT NOT NULL,
    -- permission, ask_user, plan_approval, mcp_elicitation, mcp_auth
  source TEXT NOT NULL DEFAULT 'hook',
    -- hook, sdk_callback, pty_detected

  -- Tool details (permission requests)
  tool_name TEXT,
  tool_input TEXT,                      -- JSON

  -- Prompt details (ask_user / mcp_elicitation)
  prompt_text TEXT,
  prompt_options TEXT,                  -- JSON: multiple choice options
  elicitation_schema TEXT,              -- JSON Schema for MCP elicitation

  -- Context
  terminal_context TEXT,                -- last N lines of output
  hook_payload TEXT,                    -- raw hook JSON
  risk_level TEXT NOT NULL DEFAULT 'medium',
    -- low, medium, high, critical

  -- Resolution
  status TEXT NOT NULL DEFAULT 'pending',
    -- pending, approved, denied, timed_out, cancelled, error
  resolved_by TEXT,
    -- user, policy:<rule_id>, timeout:<action>, session_end
  policy_rule_id TEXT REFERENCES approval_policy_rules(id),
  response_text TEXT,                   -- for ask_user replies
  response_data TEXT,                   -- JSON: for mcp_elicitation

  -- Timing
  timeout_seconds INTEGER NOT NULL DEFAULT 300,
  timeout_action TEXT NOT NULL DEFAULT 'deny',
    -- deny (safe default), approve (trusted only), cancel_session
  timeout_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at INTEGER
);
```

#### Automatic Risk Classification

```
Read, Glob, Grep, LS                        → low
Write, Edit (code files)                    → medium
Bash (safe patterns: ls, git log, npm test) → medium
Bash (general)                              → high
Bash (dangerous: rm -rf, sudo, curl|bash)   → critical
MCP tools                                   → high
AskUserQuestion                             → low
```

### 5. Dashboard Approval UX

#### Approval Queue Page (`/approvals`)

Table with columns: Risk (color badge), Session, Tool, Input summary, Age (with countdown), Actions (Approve/Deny).

Bulk actions toolbar: "Approve All Low-Risk", "Deny All", "Approve Selected".

Sorted by: oldest first (prevent starvation) or risk level (highest first).

#### In-Session Approval Banner

Sticky banner above terminal when session has pending approvals:

```
┌──────────────────────────────────────────────────────────┐
│ ! 3 Approvals Pending                       [Expand All] │
│ 1. Bash: npm install lodash       Low  [Approve] [Deny] │
│ 2. Write: /src/utils.ts           Med  [Approve] [Deny] │
│ 3. Bash: git push origin main     Crit [Approve] [Deny] │
│                         [Approve All Safe] [Deny All]    │
└──────────────────────────────────────────────────────────┘
```

#### Approval Detail Drawer

Shows: risk badge, session info, tool name + full input, terminal context (last 20 lines), policy match info, countdown timer. Actions: Approve, Deny, **Approve & Remember** (creates policy rule).

#### Three-Way Decision Model

Inspired by FlowHunt HITL middleware and AWX workflows:
- **Approve** — execute as-is
- **Edit** — modify parameters then execute (e.g., change file path, tweak command)
- **Reject with feedback** — deny + send text feedback to Claude ("Try a different approach")

#### AskUserQuestion UI

Chat-like interface instead of approve/deny buttons:

```
┌─────────────────────────────────────────┐
│ Claude is asking:                       │
│ "Which database: Postgres or SQLite?"   │
│ ┌─────────────────────────────┐         │
│ │ Use SQLite, simpler for this│ [Send]  │
│ └─────────────────────────────┘         │
└─────────────────────────────────────────┘
```

#### MCP Elicitation UI

Dynamic form rendered from JSON Schema:

```
┌─────────────────────────────────────────┐
│ MCP Server "github" needs input:        │
│ Repository: [________________]          │
│ Branch:     [main_________ ▼]          │
│ Force push: [ ] Yes                     │
│                [Submit]  [Cancel]        │
└─────────────────────────────────────────┘
```

#### Mobile Layout

Cards instead of table, full-screen modal for detail, collapsed terminal context by default, minimum 44px touch targets. "Approve & Remember" hidden on mobile (too complex).

### 6. Notification Strategy

#### Layered Notifications

| Channel | Latency | Context | Actionable? | Best For |
|---------|---------|---------|-------------|----------|
| Dashboard toast + sound | Instant | Full (in-app) | Yes (buttons) | User at desk |
| Browser Notification API | Instant | ~2 lines + 2 action buttons | Yes (service worker) | Different tab |
| Slack/Discord webhook | 1-3s | Rich (Block Kit / embeds) | Link to dashboard | Away from desk |
| ntfy.sh / Pushover | 1-5s | Title + body + click URL | Click opens dashboard | Mobile push |
| Email magic links | 10-60s | Unlimited body | Yes (one-click links) | Non-urgent |

#### ntfy.sh Integration (Recommended for Mobile Push)

```
POST https://ntfy.sh/{topic}
Title: CHQ: Approval Needed (CRITICAL)
Body: Bash: git push --force origin main
  Session: "Fix login bug" (studio-pc)
  Timeout: 5m
Priority: 5
Click: https://100.x.x.x:3000/approvals/apr-abc123
```

Self-hostable, Android/iOS/web support, zero auth setup for a Tailscale network.

#### Urgency Model

| Condition | Urgency | Behavior |
|-----------|---------|----------|
| risk = critical | Urgent | Sound + vibrate + push immediately |
| risk = high, age > 30s | High | Sound + push |
| risk = medium, age > 60s | Normal | Push (no sound) |
| risk = low | Low | Badge count only |
| ask_user | Normal | Push (Claude is blocked) |

#### Notification Grouping

5-second batching window per session: approvals arriving within 5s are grouped into one notification ("5 approvals pending for session X").

### 7. Timeout Handling

#### Default Timeouts by Context

| Context | Default | Timeout Action |
|---------|---------|----------------|
| risk = low | 60s | auto-deny |
| risk = medium | 300s (5m) | auto-deny |
| risk = high | 600s (10m) | auto-deny |
| risk = critical | 600s (10m) | auto-deny (never auto-approve) |
| ask_user | 1800s (30m) | auto-deny |
| Session tagged `trusted` | 120s | auto-approve |
| Session tagged `unattended` | 60s | auto-deny |

#### Timeout Sweeper

Hub runs `setInterval` every 10 seconds:
```sql
SELECT * FROM approval_requests
WHERE status = 'pending' AND timeout_at <= unixepoch()
```
Executes configured timeout action for each expired request.

#### Phased Escalation

1. **0-5 min**: Initial notification sent
2. **5-15 min**: Reminder notification with escalating urgency
3. **15-30 min**: Escalate to higher-urgency channel (e.g., SMS)
4. **30 min+**: Auto-deny and pause session

#### Queue Drain (User Returns to 20 Pending)

Summary banner: "You have 17 pending approvals across 3 sessions (oldest: 2 hours ago)."
Grouped by session, sorted by age.
Bulk actions: "Approve all read-only (8)", "Deny all expired (4)", "Review remaining (5)."

#### Session Behavior While Waiting

- **SDK mode**: Claude Code process blocked in `canUseTool` — consumes no API tokens
- **PTY + hook**: Claude Code blocked waiting for HTTP response — terminal shows prompt
- **PTY + regex**: Claude Code waiting for stdin input — PTY is idle

Dashboard session state indicator shows: **"Awaiting Approval"** (amber, lock icon, pulsing).

### 8. Edge Cases

| Edge Case | Handling |
|-----------|----------|
| Multiple pending from same session | Independent records; dashboard groups visually; bulk approve available |
| User approves after timeout | Hub returns HTTP 409 Conflict; dashboard shows "already resolved" toast |
| Network disconnect during pending | SDK: Agent retries with backoff; PTY hook: Claude falls back to terminal prompt; Reconnect sync protocol |
| Agent crash during pending | Hub detects via missed heartbeat; marks all pending as `cancelled` |
| Rapid-fire requests (10 in 5s) | Policy auto-resolves most; dashboard groups remaining; notifications batched |
| Plan approval | Variant of ask_user with Approve Plan / Modify Plan / Reject buttons |
| Hub restart during pending | SQLite persists state; timeout sweeper processes expired; long-poll reconnects |

### Reconnection Sync Protocol

```typescript
// Agent → Hub (on reconnect)
{ type: "agent:approval:sync", pendingApprovalIds: ["apr-123", "apr-456"] }

// Hub → Agent
{ type: "hub:approval:sync_result", resolved: [
  { approvalId: "apr-123", decision: "approve" },
  { approvalId: "apr-456", decision: "deny" }
]}
```

## Analysis

### The Interception Decision Tree

The architecture must support four distinct interception mechanisms because no single one works in all modes:

```
Session Type?
├── SDK/headless → canUseTool callback (100% reliable, structured)
├── PTY + hooks configured → PermissionRequest HTTP hook (reliable, structured)
├── PTY, no hooks → Regex detection + PTY stdin write (fragile, last resort)
└── bypassPermissions → No interception needed (all auto-approved)
```

The Agent daemon should **always configure hooks** before spawning sessions, making Path C (regex) a fallback for edge cases only.

### Policy Engine vs. Claude Code's Built-In Rules

Claude Code already has `allowedTools`/`disallowedTools` with glob patterns. Why build a separate policy engine?

1. **Centralized**: One set of rules for all agents/sessions, managed from the dashboard
2. **Richer matching**: Session tags, machine ID, risk level — context Claude Code's built-in rules don't have
3. **"Approve & Remember"**: Users build rules organically from real decisions
4. **Audit trail**: Every auto-resolution is logged with the rule that matched
5. **Three-way decisions**: Claude Code only supports allow/deny; our engine supports edit (modify input)

The two systems complement each other: Claude Code's built-in rules handle the fast path (agent-side, no network hop), and the Hub's policy engine handles the centralized governance layer.

### Why Default-Deny on Timeout

Auto-approving on timeout creates an attack surface: a malicious prompt could generate dangerous tool calls and rely on the user not being present to approve them. Default-deny is safe: the worst case is the session pauses and the user resumes later. The exception is sessions explicitly tagged `trusted` by the user, which can opt into auto-approve on timeout.

## Recommendations

1. **Configure `PermissionRequest` + `PreToolUse` HTTP hooks automatically.** The Agent daemon should write hook configuration to `~/.claude/settings.json` before spawning any session, pointing to the Hub's Tailscale IP.

2. **Use SDK `canUseTool` for all headless/queued jobs.** This is the cleanest path — structured, typed, no regex parsing.

3. **Ship sensible default policy rules.** Auto-approve reads, auto-deny dangerous patterns, require approval for everything else. Users refine via "Approve & Remember."

4. **Build the approval queue page in Phase 2.** It's the first feature users need when watching unattended sessions — without it, the system is unusable for remote management.

5. **Implement three-way decisions (approve/edit/reject-with-feedback).** Binary approve/deny is insufficient — users often want to say "yes, but change X" or "no, try Y instead."

6. **Use long-polling for SDK approval routing.** The Agent's `canUseTool` callback makes an HTTP request to the Hub, which holds the connection open until a decision is made. Sub-second response time, no polling overhead.

7. **Implement ntfy.sh integration for mobile push.** Self-hosted, no vendor dependency, click-to-open links. Add Slack/Discord webhook support as a secondary channel.

8. **Default-deny on timeout, always.** Allow per-session override to auto-approve only for sessions explicitly tagged `trusted`.

9. **Add "Approve & Remember" as a first-class action.** This is how the policy engine learns — every approval becomes a potential rule. The best policy engines are built from real decisions, not hypothetical rules.

10. **Group rapid-fire approvals.** 5-second batching window prevents notification spam and enables bulk actions in the dashboard.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| PermissionRequest hook doesn't fire in headless mode | High | Use PreToolUse hooks + SDK canUseTool for headless; documented clearly |
| Hook HTTP timeout too short for human approval | High | Set hook timeout to match approval timeout (5-10 min); Hub holds connection |
| Regex PTY detection is fragile | Medium | Make it the last resort; always configure hooks; don't rely on it for critical decisions |
| Policy rules become complex/conflicting | Medium | Priority ordering with first-match-wins; test widget in dashboard; deny-overrides-allow |
| Timeout sweeper misses edge cases | Low | 10s interval is fine; use database timestamps (unixepoch) not in-memory timers |
| User fatigue from too many approvals | High | Strong default policy rules that auto-resolve 90%+ of requests; bulk approve |
| Mobile notification content too limited | Medium | Show just enough to identify the action; full context in dashboard on tap-through |
| Network latency delays approval delivery | Low | Long-polling gives sub-second response; Tailscale mesh is typically <10ms |

## Sources

### Claude Code Permissions
- [Permissions Reference](https://code.claude.com/docs/en/permissions) — modes, rules syntax, evaluation order
- [Settings Reference](https://code.claude.com/docs/en/settings) — settings.json schema, hierarchy
- [Hooks Reference](https://code.claude.com/docs/en/hooks) — all 21+ events, handler types, payloads
- [Agent SDK Permissions](https://platform.claude.com/docs/en/agent-sdk/permissions) — canUseTool, permission modes
- [Agent SDK Hooks](https://platform.claude.com/docs/en/agent-sdk/hooks) — in-process hook callbacks
- [Agent Teams](https://code.claude.com/docs/en/agent-teams) — teammate permissions, plan mode
- [Remote Control](https://code.claude.com/docs/en/remote-control) — server mode, multi-session

### Approval UX Patterns
- [GitHub Actions - Reviewing Deployments](https://docs.github.com/en/actions/managing-workflow-runs/reviewing-deployments) — environment approval gates
- [GitLab - Deployment Approvals](https://docs.gitlab.com/ci/environments/deployment_approvals/) — multi-role approvals
- [Jenkins - Input Step](https://www.jenkins.io/doc/pipeline/steps/pipeline-input-step/) — REST API for approvals, timeout handling
- [Slack Block Kit](https://docs.slack.dev/block-kit/) — interactive approval messages
- [Discord.js - Buttons](https://discordjs.guide/interactive-components/buttons) — approve/deny components
- [ntfy.sh](https://ntfy.sh/) — self-hosted push notifications with action buttons
- [Browser Notification API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API) — service worker actions
- [Carbon Design - Status Indicators](https://carbondesignsystem.com/patterns/status-indicator-pattern/) — accessibility patterns

### Policy & Architecture
- [OPA - Open Policy Agent](https://www.openpolicyagent.org/docs) — policy-as-code patterns
- [AWS IAM - Policy Evaluation Logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html) — default-deny, explicit-deny-overrides
- [FlowHunt - HITL Middleware](https://www.flowhunt.io/blog/human-in-the-loop-middleware-python-safe-ai-agents/) — three-way decisions, checkpointing
- [Permit.io - HITL Best Practices](https://www.permit.io/blog/human-in-the-loop-for-ai-agents-best-practices-frameworks-use-cases-and-demo) — "would I be comfortable if autonomous?"
- [LangChain - Human-in-the-Loop](https://docs.langchain.com/oss/python/langchain/human-in-the-loop) — interrupt and resume patterns
- [Duo Push](https://duo.com/product/multi-factor-authentication-mfa/authentication-methods/duo-push) — mobile approval UX
- [Cflow - Escalation Rules](https://www.cflowapps.com/how-automated-escalation-rules-reduce-approval-bottlenecks/) — phased timeout escalation

## Appendix

### API Routes

```
# Approvals
GET    /api/approvals                     List (filterable: ?status=pending&sessionId=X)
GET    /api/approvals/:id                 Detail
POST   /api/approvals/:id/respond         Decision { decision, responseText?, rememberAsRule? }
POST   /api/approvals/bulk/respond        Bulk { approvalIds[], decision }

# Policy Rules
GET    /api/approval-policies             List rules (ordered by priority)
POST   /api/approval-policies             Create rule
PUT    /api/approval-policies/:id         Update rule
DELETE /api/approval-policies/:id         Delete rule
PATCH  /api/approval-policies/reorder     Reorder { order: string[] }
POST   /api/approval-policies/test        Test rule against sample request

# Hook Receiver
POST   /hooks/permission-request          PermissionRequest hook from Claude Code
POST   /hooks/pre-tool-use                PreToolUse hook from Claude Code
```

### WebSocket Protocol Additions

```typescript
// Agent → Hub
{ type: "agent:approval:request", approvalId, sessionId, requestType, toolName?,
  toolInput?, promptText?, terminalContext?, source }
{ type: "agent:approval:sync", pendingApprovalIds: string[] }

// Hub → Agent
{ type: "hub:approval:decision", approvalId, sessionId, decision, responseText?, responseData? }
{ type: "hub:approval:sync_result", resolved: Array<{ approvalId, decision }> }

// Hub → Dashboard
{ type: "approval:requested", approval: ApprovalRequest }
{ type: "approval:resolved", approvalId, status, resolvedBy }
{ type: "approval:count", pending: number, byMachine: Record<string, number> }
```

### New Files Required

```
packages/shared/
  src/approvals.ts          — Zod schemas, types for ApprovalRequest, PolicyRule, enums
  src/protocol.ts           — extend with approval message types

packages/hub/
  src/routes/approvals.ts        — approval CRUD + respond + bulk
  src/routes/approval-policies.ts — policy rule CRUD
  src/routes/hooks.ts             — /hooks/permission-request handler
  src/approvals/engine.ts         — policy evaluation
  src/approvals/timeout-sweeper.ts — periodic timeout checker
  src/approvals/risk-classifier.ts — automatic risk level assignment
  src/db.ts                       — extend with approval tables + migrations

packages/agent/
  src/approval-bridge.ts           — bridges SDK callback + hook to Hub API
  src/pty-approval-detector.ts     — regex fallback for PTY prompts

packages/dashboard/
  app/pages/approvals/index.vue              — approval queue page
  app/components/approval/ApprovalBanner.vue — session view sticky banner
  app/components/approval/ApprovalCard.vue   — single approval card
  app/components/approval/ApprovalDetail.vue — detail drawer
  app/components/approval/AskUserReply.vue   — chat-like reply UI
  app/components/approval/PolicyRuleEditor.vue — rule form
  app/stores/approvals.ts                    — Pinia store
  app/composables/useApprovalNotifications.ts — sound, browser notifs, badge
  app/pages/settings/approval-policies.vue   — policy config page
```

### Phase Integration

**Phase 2a (MVP):** Shared types, Hub approval table + policy engine + timeout sweeper, Agent hook configuration + approval bridge, Dashboard approval banner in session view.

**Phase 2b (Full UX):** Approval queue page, detail drawer, AskUser reply, bulk actions, policy editor, "Approve & Remember", webhook notifications for `approval_needed`.

**Phase 2c (Polish):** Mobile cards, ntfy.sh integration, notification grouping, approval history/analytics.
