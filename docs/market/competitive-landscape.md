# Competitive landscape

_Last updated: 2026-04-09. This document compares Claude HQ against adjacent
tools for running Claude Code workflows._

## TL;DR

**Claude HQ** is a self-hosted control plane for running Claude Code as an
autonomous, multi-repo workforce. It sits between the Claude CLI / SDK and
the humans who need to supervise, budget, and audit what the agents do.

| Audience                     | Alternative(s)                                      | Why Claude HQ                                                           |
| ---------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| Solo developer on one repo   | `claude` CLI in a terminal                          | You probably don't need Claude HQ yet — the CLI is great                |
| Team running 3-20 repos      | OpenClaw, runCLAUDErun, manual `claude` invocations | Multi-machine scheduler, cost budgets, approvals, full audit trail      |
| Regulated / audit-heavy team | DIY scripting                                       | Session recording, audit log, hard-stop budgets, Docker sandbox isolate |
| Platform team                | Build it yourself                                   | Batteries-included deploy (Tailscale, secrets, SQLite backup)           |

## Detailed comparison

### Core capabilities

| Capability                         | Claude HQ | [OpenClaw][openclaw] | [runCLAUDErun][runclauderun] | `claude` CLI (manual) | Standalone Claude.ai |
| ---------------------------------- | :-------: | :------------------: | :--------------------------: | :-------------------: | :------------------: |
| **Multi-session orchestration**    | ✓ native  |       partial        |              ✓               |           ✗           |          ✗           |
| **Multi-repo batch jobs**          |     ✓     |          ✗           |           partial            |           ✗           |          ✗           |
| **Multi-machine scheduling**       | ✓ (score) |          ✗           |              ✗               |           ✗           |          ✗           |
| **Approvals / human-in-the-loop**  | ✓ (3-way) |          ✗           |              ✗               |         basic         |        basic         |
| **Per-session cost budgets**       | ✓ (hard)  |          ✗           |              ✗               |           ✗           |          ✗           |
| **Session recording + replay**     | ✓ (JSONL) |          ✗           |              ✗               |           ✗           |          ✗           |
| **Audit log of every mutation**    |     ✓     |          ✗           |              ✗               |           ✗           |          ✗           |
| **Docker sandbox (safe auto-run)** |     ✓     |       partial        |              ✓               |        manual         |         n/a          |
| **GitHub App + webhooks**          |     ✓     |          ✗           |           partial            |        manual         |          ✗           |
| **Pre-flight / setup containers**  |  ✓ async  |          ✗           |              ✗               |        manual         |          ✗           |
| **Self-hosted**                    |     ✓     |          ✓           |              ✓               |           ✓           |       ✗ (SaaS)       |
| **OTel / Langfuse export**         |     ✓     |          ✗           |              ✗               |           ✗           |          ✗           |

Legend: ✓ = first-class, partial = works with extra wiring, ✗ = not supported.

### Deployment

| Story            | Claude HQ                                     | OpenClaw            | runCLAUDErun        |
| ---------------- | --------------------------------------------- | ------------------- | ------------------- |
| Deployment model | Docker Compose + Tailscale sidecar            | Python process      | Docker Compose      |
| TLS termination  | Tailscale Serve (auto-cert)                   | Reverse proxy (BYO) | Reverse proxy (BYO) |
| Secrets mgmt     | Docker secrets + `loadSecret` fallback        | env vars            | env vars            |
| Backup           | `sqlite3 .backup` + optional Litestream       | ad-hoc              | ad-hoc              |
| Egress hardening | `claude-restricted` net + tinyproxy allowlist | ✗                   | ✗                   |

### UX + observability

| Story                       | Claude HQ                                | OpenClaw | runCLAUDErun |
| --------------------------- | ---------------------------------------- | -------- | ------------ |
| Dashboard                   | Nuxt 3 + Vuetify, WebSocket live         | CLI      | Minimal      |
| Live terminal view          | xterm.js streaming                       | ✗        | ✗            |
| Replay scrub bar            | ✓ (speed 0.5× to 8×)                     | ✗        | ✗            |
| Cost dashboard + CSV export | ✓                                        | ✗        | ✗            |
| Status vocabulary           | 7-state Carbon design (Queued/Running/…) | ad-hoc   | ad-hoc       |
| Browser notifications       | ✓ (foreground; VAPID push planned)       | ✗        | ✗            |
| ntfy.sh integration         | ✓                                        | ✗        | ✗            |

## Claude HQ differentiators

Three things we do that none of the alternatives do:

### 1. Sessions are a first-class, recorded, auditable artifact

Every Claude Code invocation through Claude HQ writes a JSONL recording of
its PTY stream + a row in `sessions` + cost telemetry in `session_costs`. You
can scrub back through any session at any speed, see what the model saw, and
prove to an auditor exactly what happened.

OpenClaw and runCLAUDErun treat sessions as ephemeral — once the terminal
closes, the history is gone.

### 2. Human-in-the-loop with teeth

The approvals flow isn't a pop-up. It's a persisted `approval_requests` row
with a risk classifier, policy rules for auto-approve, three-way decision
(Approve / Edit / Reject), Approve-and-Remember, MCP elicitation form
rendering, and a notification router that batches + escalates. Standalone
Claude Code has a single Y/N prompt.

### 3. Budget enforcement that can actually stop a runaway

Per-session `max_cost_usd` is enforced by a 10-second sweeper that hits
the agent's `hub:session:kill` channel when a session exceeds its budget.
Global monthly budgets gate new session creation via HTTP 402 when
`hard_stop` is enabled. Most alternatives surface costs _after_ the fact;
Claude HQ stops the bleed.

## Where Claude HQ is weaker

We're deliberate about what we're not:

- **Not a SaaS**. If you want someone else to run the infrastructure,
  Standalone Claude.ai is still the better answer.
- **Not a one-shot CLI**. For a single developer editing a single repo,
  `claude` in a terminal is faster to set up and has fewer moving parts.
- **Not a coding agent replacement**. Claude HQ hosts Claude Code; the
  intelligence still comes from the Claude model.

## Next steps

- **Try Claude HQ**: `docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.tailscale.yml up -d`
- **Browse the roadmap**: `docs/roadmap/tracker.md`
- **File an issue** if a capability you need is missing — the epic registry
  (`docs/roadmap/_EPIC_REGISTRY.json`) shows what's planned and what's shipped.

[openclaw]: https://github.com/anthropics/claude-code/discussions
[runclauderun]: https://github.com/anthropics/claude-code/discussions
