---
title: "Remote Console Patterns: Portainer, Kubernetes & Beyond for Claude Code Instance Management"
date: 2026-03-15
tags: [architecture, ux, portainer, kubernetes, dashboard, queue, scheduling, templates]
status: complete
related: [docs-audit]
packages: [hub, dashboard, shared, agent]
---

# Remote Console Patterns: Portainer, Kubernetes & Beyond for Claude Code Instance Management

## Summary

Claude Code sessions are functionally identical to containers — they have a lifecycle (queued/running/completed/failed), produce stdout, accept stdin, consume measurable resources, and run on specific machines. Studying Portainer, Kubernetes, Cockpit, PM2, Rundeck/AWX, CI/CD pipelines, and web terminal tools reveals that Claude HQ's core architecture is sound but is missing critical features that every mature orchestration platform provides: **resource controls** (cost limits, timeouts, budgets), **organizational primitives** (tags, templates, capabilities), **scheduling intelligence** (auto-placement, retry policies), and **graduated detail views** (fleet overview → session detail → terminal). These additions are mostly additive schema columns and Hub-side logic — they don't require rethinking the three-component architecture.

## Research Questions

1. How do Portainer and Kubernetes handle remote terminal/console sessions?
2. What UX patterns do these tools use for managing many concurrent processes across multiple machines?
3. How do they handle real-time streaming, health monitoring, and resource visualization?
4. What queue/scheduling patterns from Kubernetes can inform our task queue design?
5. What specific UI components and interaction patterns should Claude HQ adopt?

## Findings

### 1. Terminal/Console Architecture Patterns

All researched tools converge on the same architecture for browser-based terminal access:

**The universal pattern:** PTY on host → WebSocket binary frames → xterm.js in browser

| Tool | Terminal Lib | Transport | Proxy Layer |
|------|-------------|-----------|-------------|
| Portainer | xterm.js | WebSocket (attach/exec endpoints) | Portainer Agent on each host |
| K8s Dashboard | xterm.js | WebSocket (channel.k8s.io subprotocol) | API Server → Kubelet → CRI |
| Lens | xterm.js + node-pty | WebSocket | Direct to kubelet |
| Cockpit | xterm.js | WebSocket (cockpit.channel) | cockpit-ws → SSH → cockpit-bridge |
| ttyd | xterm.js | WebSocket (binary frames) | Direct PTY |
| GoTTY | xterm.js | WebSocket | Direct PTY |

**Key architectural details:**

- **Kubernetes channel multiplexing:** Each WebSocket binary message is prefixed with a single byte indicating the channel (0=STDIN, 1=STDOUT, 2=STDERR, 3=error). In TTY mode, stdout and stderr merge to channel 1. K8s has fully transitioned from SPDY to WebSocket as of v1.31.

- **Portainer connection hijacking:** The agent creates a direct stream bridge between the client WebSocket and the Docker API — TCP connection with keep-alive to prevent timeouts. In multi-host environments, an `X-PortainerAgent-Target` header routes requests to the correct node.

- **ttyd binary protocol:** A single type byte followed by payload. Types distinguish output data, input data, and resize events. This avoids JSON overhead for high-throughput terminal streaming.

- **Cockpit hub-and-spoke:** A single `cockpit-ws` gateway SSH-tunnels to `cockpit-bridge` on each managed host. This is essentially what Claude HQ's hub-agent topology already mirrors.

**Recommendation for Claude HQ:** Use binary WebSocket frames for terminal I/O (keeping JSON for control messages). Consider the K8s channel multiplexing pattern if we ever need to separate stdout/stderr. The Hub should buffer recent terminal output per session so new viewers and reconnecting clients can catch up to current state (inspired by ttyd's `--reconnect` + xterm serialize).

### 2. Instance/Process Management UX

#### Container/Session List View

Every tool uses a data table with inline actions. The most effective pattern (from Portainer):

| Column Pattern | Portainer | Kubernetes | PM2 | Claude HQ Mapping |
|---------------|-----------|------------|-----|-------------------|
| Name/ID | Container name | Pod name | Process name | Session ID + prompt snippet |
| Status badge | Running/Stopped (color) | Phase (color + icon) | Online/Errored (color) | Queued/Running/Completed/Failed |
| Quick actions | Logs, Stats, Console, Inspect icons | Logs, Exec, Delete | Restart, Stop, Delete | Terminal, Logs, Kill, Clone |
| Host/Node | Stack name | Node | Cluster | Machine name |
| Resource usage | — (separate Stats page) | CPU/Mem inline | CPU%, Mem inline | Tokens, Cost, Duration |
| Age/Duration | Created timestamp | Age | Uptime | Duration since start |

**Portainer's "Quick Action" icons** in each table row are the standout pattern — one-click access to Logs, Stats, Console, and Inspect without navigating away from the list. Claude HQ should have inline icon buttons for: Open Terminal, View Logs, Kill, Clone.

**Bulk actions:** Checkbox selection per row with bulk action bar (Start, Stop, Kill, Remove). Portainer learned a UX lesson: "Select all" should only select the visible page, not all pages.

**Filtering:** Text search + status dropdown + machine filter. K8s adds namespace filtering; for us, tags/project filtering serves the same purpose.

#### Container/Session Detail View

The universal tab structure across Portainer, K8s, and Lens:

| Tab | Portainer | Kubernetes | Claude HQ Mapping |
|-----|-----------|------------|-------------------|
| Overview | Name, ID, status, image, ports, env | Metadata, labels, conditions, events | Prompt, machine, status, cwd, flags, claude session ID |
| Terminal | Console (exec into container) | Exec tab | Live xterm.js terminal (already planned) |
| Logs | Searchable log viewer with follow | Streaming logs with container selector | **NEW:** Searchable text log of session output |
| Events | — | Pod events timeline | **NEW:** Hook events timeline (tool use, sub-agents, permissions) |
| Stats | CPU/Mem/Net/IO charts | Resource usage | **NEW:** Token velocity, cost curve, context window fill |
| Inspect | Raw JSON | YAML manifest | Session metadata + recording info |

**Gap identified:** The current architecture has Terminal and Metadata but lacks dedicated Logs (searchable text), Events (hook timeline), and Stats (LLM-specific metrics) tabs.

#### Status Indicators

The [Carbon Design System status indicator pattern](https://carbondesignsystem.com/patterns/status-indicator-pattern/) is the gold standard: use color + icon + text (at least 3 elements for accessibility).

Recommended session states with visual treatment:

| State | Color | Icon | Notes |
|-------|-------|------|-------|
| Queued | Blue/Gray | Clock | Waiting for slot |
| Blocked | Orange | Lock | Depends on another task |
| Running | Green | Pulsing dot | Active processing |
| Waiting for Input | Amber | Hand/pause | Needs user attention |
| Completed | Green | Checkmark | Exited successfully |
| Failed | Red | X mark | Non-zero exit |
| Cancelled | Gray | Slash | User-cancelled |

### 3. Multi-Machine Management

#### Environment/Cluster Switching

| Tool | Pattern | UX |
|------|---------|-----|
| Portainer | Environment tiles on home page | Click tile to enter context; each tile shows name + status + vital stats |
| Lens | Catalog sidebar with status dots | Click cluster to enter scoped view; hotbar for favorites |
| Rancher | Top-level cluster list → click to enter | Full context switch with scoped navigation |
| Cockpit | Host switcher dropdown | Switch between servers without leaving current view |

**Recommendation:** Claude HQ should use **machine cards on the overview page** (Portainer-style) for the primary view, plus a **machine switcher in the sidebar** (Cockpit-style) for quick context changes without navigating home.

#### Machine Health (Node Analog)

Kubernetes nodes report conditions: Ready, MemoryPressure, DiskPressure, PIDPressure, NetworkUnavailable. Claude HQ should derive similar conditions from heartbeat data:

| Condition | Trigger | Display |
|-----------|---------|---------|
| Ready | Heartbeat received within 60s | Green dot |
| NotReady | Heartbeat missed > 60s | Red dot |
| MemoryPressure | memPercent > 90% | Yellow warning badge |
| DiskPressure | diskPercent > 90% | Yellow warning badge |
| SessionPressure | activeSessions == maxSessions | Orange "full" badge |

The machine card should show: name, status dot, session slots as a progress bar (2/3), CPU/mem sparklines (last 30 min), queue depth badge.

### 4. Queue & Scheduling Patterns

#### Kubernetes Job Model

| K8s Job Field | Purpose | Claude HQ Equivalent |
|---------------|---------|---------------------|
| `completions` | Required successful completions | 1 (always) |
| `parallelism` | Concurrent pod count | `maxConcurrentSessions` per machine |
| `backoffLimit` | Max retries before marking failed | **NEW:** `retryPolicy.maxRetries` |
| `activeDeadlineSeconds` | Time limit for entire job | **NEW:** `timeoutSeconds` |
| `ttlSecondsAfterFinished` | Auto-cleanup delay | **NEW:** Recording retention policy |

#### Kueue (K8s-native Job Queueing)

Kueue is the official Kubernetes SIG project for workload queueing — highly relevant:

- **ClusterQueue:** Defines resource quotas and fair sharing policies → Hub-level global budget
- **LocalQueue:** Namespace-scoped queues borrowing from ClusterQueues → Per-machine queues drawing from global budget
- **WorkloadPriority:** StrictFIFO or BestEffortFIFO ordering → Our priority field
- **Preemption:** Higher-priority workloads can evict lower-priority ones → Kill a low-priority session to make room for a high-priority queued task

#### CronJobs → Scheduled Tasks

Not in the current architecture but universally supported by orchestration tools. K8s CronJobs have: schedule, concurrencyPolicy (Allow/Forbid/Replace), history limits, suspend toggle.

#### Rundeck/AWX Patterns

- **AWX Workflow Visualizer:** DAG editor where each node is a job template with success/failure/always branching. Enables "run B after A succeeds."
- **AWX Surveys:** A form that collects parameters before job launch — maps to parameterized session templates.
- **Rundeck execution views:** Four graduated detail modes — Summary (counters), Monitor (node-by-step), Log (tail), Status Bar (minimal progress).

#### Recommended Queue Enhancements

```typescript
interface QueueTask {
  id: string;
  name?: string;                // human-readable label
  machineId?: string;           // optional if auto-scheduling
  prompt: string;
  cwd: string;
  flags?: string[];
  priority: number;
  position: number;
  requirements?: string[];      // machine capabilities required
  timeoutSeconds?: number;      // max duration
  maxCostUsd?: number;          // cost limit
  retryPolicy?: {
    maxRetries: number;         // default 0
    backoffSeconds: number;     // doubles each retry
    retryOnExitCodes?: number[];
  };
  dependsOn?: string[];         // task IDs that must complete first
  tags?: string[];
  createdAt: number;
}
```

#### Auto-Scheduling Algorithm

When `machineId` is omitted, the Hub selects a machine:

```
score = (maxSessions - activeSessions) * 10
      + (100 - cpuPercent)
      + (100 - memPercent)
      - (queueDepth * 5)
```

Filter by `requirements` matching machine `capabilities` first, then pick highest score.

### 5. Real-Time Update Patterns

#### Kubernetes Watch API

The gold standard for real-time updates: client subscribes with `?watch=true`, server sends newline-delimited JSON events with types (ADDED, MODIFIED, DELETED). `resourceVersion` enables resumable watches without missing updates.

#### GitLab WebSocket Watch Manager (Most Applicable)

Aggregates **multiple resource watches within a single persistent WebSocket connection**:
- Dynamic `watch`/`unwatch` subscribe messages
- Automatic fallback to HTTP polling if WebSocket fails
- Eliminates per-resource connection overhead

**This is directly applicable to Claude HQ.** The dashboard already uses a single WebSocket to the Hub. Adding explicit subscribe/unsubscribe semantics would let the dashboard watch only the resources currently in view:

```typescript
// Dashboard sends:
{ type: "subscribe", resource: "session", id: "abc-123" }
{ type: "subscribe", resource: "machine", id: "studio-pc" }
{ type: "unsubscribe", resource: "session", id: "abc-123" }

// Hub sends (only for subscribed resources):
{ type: "session:updated", session: SessionRecord }
{ type: "session:event", sessionId: string, event: HookEvent }
{ type: "machine:updated", machine: MachineRecord }
```

### 6. Dashboard Layout Patterns

#### Three Essential Views (Universal Convergence)

Every tool converges on three levels of detail:

1. **Fleet Overview:** All machines and sessions at a glance
2. **Entity Detail:** One session or machine with full context
3. **Terminal/Log:** Raw output with interaction capability

#### Recommended Overview Page

Inspired by Portainer dashboard + K8s dashboard + Grafana Z-pattern layout:

```
┌─────────────────────────────────────────────────────────┐
│ [Sessions: 5 running, 3 queued] [Machines: 3/3 online] │
│ [Cost today: $4.23]            [Tokens: 1.2M]          │
├─────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│ │studio-pc │ │ macbook  │ │ nuc-srv  │                  │
│ │ ● Online │ │ ● Online │ │ ● Online │                  │
│ │ ██░ 2/3  │ │ █░░ 1/2  │ │ ░░░ 0/2  │                  │
│ │ CPU: 45% │ │ CPU: 12% │ │ CPU: 3%  │                  │
│ │ Queue: 2 │ │ Queue: 0 │ │ Queue: 1 │                  │
│ └──────────┘ └──────────┘ └──────────┘                  │
├─────────────────────────────────────────────────────────┤
│ Recent Activity                                          │
│ ● Session "Fix auth bug" completed on studio-pc (3m42s)  │
│ ● Session "Review PR #42" started on macbook             │
│ ● Agent nuc-srv reconnected                              │
│ ● Session "Gen docs" failed on studio-pc (exit 1)        │
└─────────────────────────────────────────────────────────┘
```

#### Recommended Navigation (Left Sidebar)

```
[Claude HQ Logo]
─────────────────
Overview
Sessions
  Grid View
Machines
Queue
Templates          (Phase 3+)
Scheduled Tasks    (Phase 4+)
Recordings
─────────────────
Notifications
Settings
─────────────────
[● 3 machines online]
```

### 7. Session Templates (Inspired by Portainer App Templates + AWX Surveys)

Portainer's app template gallery (card layout with icons + 1-click deploy) and AWX's survey system (parameterized forms before launch) combine into a powerful pattern for Claude HQ:

```sql
CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,                   -- emoji or icon identifier
  prompt TEXT NOT NULL,        -- may contain {{variables}}
  cwd TEXT,
  flags TEXT,
  machine_id TEXT,
  requirements TEXT,           -- JSON: machine capabilities
  timeout_seconds INTEGER,
  max_cost_usd REAL,
  variables TEXT,              -- JSON: [{name, label, description, default, type}]
  tags TEXT,                   -- JSON array
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

The "New Session" modal would offer: (1) freeform prompt entry, or (2) pick from template gallery. Templates can have variables that generate form fields at launch time — e.g., a "Review PR" template with a `{{prNumber}}` variable that renders as a text input labeled "PR Number."

## Analysis

### The Core Analogy

| Orchestration Concept | Claude HQ Equivalent | Gap in Current Architecture |
|----------------------|---------------------|---------------------------|
| Container | Session | Session lacks tags, cost tracking, timeout, retry |
| Node | Machine | Machine lacks capabilities, conditions, health history |
| Job | Queued Task | Task lacks timeout, cost limit, retry policy, dependencies |
| CronJob | Scheduled Task | **Entirely missing** |
| PodTemplate | Session Template | **Entirely missing** |
| Namespace | Project grouping | **Entirely missing** |
| ResourceQuota | Cost/budget limits | **Entirely missing** |
| Labels & Selectors | Tags & filters | **Entirely missing** |
| Scheduler | Auto-placement | **Entirely missing** (machineId always required) |
| Health Checks | Stall detection | Basic (flat 5min threshold), needs conditions model |
| Audit Log | Admin action log | **Entirely missing** |

### What Makes Claude HQ Unique

While the container analogy holds for lifecycle management, Claude Code sessions have metrics containers don't:

- **Token consumption** (context window fill, tokens/minute)
- **Cost accumulation** (USD spent, budget remaining)
- **Tool invocation patterns** (which tools, how often, success rate)
- **Conversation context health** (compaction events signal degrading context)
- **Semantic output** (not just bytes — AI-generated code, analysis, decisions)

The Stats/Resources tab for sessions should prioritize these LLM-specific metrics over traditional CPU/memory (which are more relevant at the machine level).

### Priority Assessment

**Critical for Phase 1 schema design** (add columns now, implement later):
- `tags TEXT` on sessions and queue
- `timeout_seconds INTEGER` on sessions and queue
- `max_cost_usd REAL` on sessions and queue
- `created_by TEXT` on sessions, queue, templates
- `capabilities TEXT` on machines
- `requirements TEXT` on sessions and queue
- Expand status enum: `queued | blocked | running | completed | failed | cancelled`

**Critical for Phase 2 dashboard UX:**
- Quick action icons in session list rows
- Three-tab session detail (Terminal, Logs/Events, Stats)
- Machine cards with health conditions and capacity bars
- Subscribe/unsubscribe WebSocket semantics
- Bulk operations with checkbox selection

**Phase 3+ features:**
- Session templates with variables
- Auto-scheduling algorithm
- Retry policies
- Task dependencies (dependsOn)
- Scheduled tasks (cron)
- Recording annotations
- Audit log

## Recommendations

1. **Extend the database schema now** with `tags`, `timeout_seconds`, `max_cost_usd`, `created_by`, `capabilities`, and `requirements` columns before writing any implementation code. These are zero-cost additions that prevent painful migrations later.

2. **Add a `session:event` WebSocket message type** for pushing hook events (tool use, sub-agent activity, permission requests) to the dashboard. This enables the Events timeline tab.

3. **Implement subscribe/unsubscribe semantics** on the dashboard WebSocket connection so the Hub only sends updates for resources the client is viewing (GitLab Watch Manager pattern).

4. **Design the session list with inline quick-action icons** (Terminal, Logs, Kill, Clone) following Portainer's proven pattern.

5. **Add "Restart" and "Clone" session actions** to the API (`POST /api/sessions/:id/restart`, `POST /api/sessions/:id/clone`).

6. **Make `machineId` optional** on session creation and implement a simple scoring-based auto-scheduler for when it's omitted.

7. **Add session templates** as a Phase 3 feature with the variable/form generation pattern from AWX surveys and Portainer app templates.

8. **Add cost/budget controls** — per-session `maxCostUsd`, per-machine `dailyBudgetUsd`, global `globalDailyBudgetUsd`. Essential for fire-and-forget queued workloads.

9. **Adopt the three-view hierarchy** universally validated across tools: Fleet Overview → Entity Detail (with tabs) → Terminal/Log.

10. **Add a `scheduled_tasks` table** to the Phase 4 plan with K8s CronJob semantics (cron expression, concurrency policy, history limits).

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Feature creep from orchestration analogy | High | Strict phasing — schema columns now, features incrementally. Not everything K8s has is needed for a personal tool. |
| Auto-scheduling complexity | Medium | Start with simple scoring function. Don't build a full K8s scheduler. |
| Template variable system complexity | Low | Start with simple string substitution (`{{var}}`). No conditionals or loops. |
| Cost tracking accuracy | Medium | Token-based estimation is approximate. Use SDK results and hook data when available; accept estimates for real-time display. |
| Multi-viewer input conflicts | Low | Simple input-lock mutex. Personal tool usually means one user. |
| Schema additions bloating initial implementation | Low | Add columns with defaults/nullable. Don't build UI for all fields immediately. |

## Sources

### Portainer
- [Portainer Container Console Docs](https://docs.portainer.io/user/docker/containers/console) — exec flow, shell selection
- [Portainer Container List](https://docs.portainer.io/user/docker/containers) — table columns, quick actions, bulk operations
- [Portainer Container Logs](https://docs.portainer.io/user/docker/containers/logs) — log viewer features
- [Portainer Container Stats](https://docs.portainer.io/user/docker/containers/stats) — CPU/mem/net/IO charts
- [Portainer Home/Environments](https://docs.portainer.io/user/home) — environment tiles, multi-host management
- [Portainer Dashboard](https://docs.portainer.io/user/docker/dashboard) — per-environment summary
- [Portainer App Templates](https://docs.portainer.io/user/docker/templates) — template gallery, variable system
- [Portainer Custom Templates](https://docs.portainer.io/user/docker/templates/custom) — parameterized deployments
- [Portainer Agent WebSocket Endpoints](https://deepwiki.com/portainer/agent/5.2-websocket-endpoints) — attach/exec architecture

### Kubernetes
- [K8s WebSocket Transition (v1.31)](https://kubernetes.io/blog/2024/08/20/websockets-transition/) — SPDY to WebSocket migration
- [How kubectl exec Works](https://erkanerol.github.io/post/how-kubectl-exec-works/) — full exec chain architecture
- [K8s Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) — phase model, conditions
- [K8s Node Status](https://kubernetes.io/docs/reference/node/node-status/) — conditions, capacity, allocatable
- [K8s Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/) — completions, parallelism, backoff
- [K8s CronJobs](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/) — schedule, concurrency policy
- [K8s Priority and Preemption](https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/) — priority classes
- [Kueue Overview](https://kueue.sigs.k8s.io/docs/overview/) — K8s-native job queueing
- [Kueue Concepts](https://kueue.sigs.k8s.io/docs/concepts/) — ClusterQueue, LocalQueue, priorities
- [Headlamp Workload Management](https://deepwiki.com/kubernetes-sigs/headlamp/3.4-workload-management) — resource map visualization
- [Lens Kubernetes IDE](https://lenshq.io/blog/lens-kubernetes) — catalog view, contextual filtering
- [GitLab Watch API Frontend](https://about.gitlab.com/blog/kubernetes-overview-operate-cluster-data-on-the-frontend/) — WebSocket Watch Manager

### Other Tools
- [Cockpit Project](https://cockpit-project.org/) — multi-server management, host switcher
- [Cockpit Multi-Server Dashboard](https://cockpit-project.org/blog/cockpit-multi-server-dashboard.html) — correlated graphs across hosts
- [PM2 Home](https://pm2.io/) — process table, log aggregation
- [pm2.web](https://github.com/oxdev03/pm2.web) — card-based process dashboard
- [Multivisor](https://github.com/tiagocoutinho/multivisor) — centralized supervisord management, reactive grid
- [Rundeck Executions](https://docs.rundeck.com/docs/manual/07-executions.html) — graduated execution views
- [AWX Workflows](https://docs.ansible.com/projects/awx/en/24.6.1/userguide/workflows.html) — DAG editor, surveys
- [Grafana Dashboard Best Practices](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/) — Z-pattern layout, variable templating
- [ttyd](https://github.com/tsl0922/ttyd) — binary WebSocket terminal protocol
- [Jenkins Blue Ocean](https://www.jenkins.io/doc/book/blueocean/pipeline-run-details/) — pipeline stage visualization
- [GitHub Actions Workflow Visualization](https://docs.github.com/actions/managing-workflow-runs/using-the-visualization-graph) — real-time DAG
- [Carbon Design Status Indicators](https://carbondesignsystem.com/patterns/status-indicator-pattern/) — accessibility best practices

## Appendix

### Recommended Schema Additions (All Phases)

```sql
-- Phase 1: Add to existing tables
ALTER TABLE machines ADD COLUMN capabilities TEXT;  -- JSON: ["gpu", "repo:my-app"]
ALTER TABLE sessions ADD COLUMN tags TEXT;           -- JSON: ["project:my-app", "type:review"]
ALTER TABLE sessions ADD COLUMN timeout_seconds INTEGER;
ALTER TABLE sessions ADD COLUMN max_cost_usd REAL;
ALTER TABLE sessions ADD COLUMN created_by TEXT DEFAULT 'owner';
ALTER TABLE sessions ADD COLUMN cost_usd REAL;
ALTER TABLE sessions ADD COLUMN tokens_used INTEGER;
ALTER TABLE sessions ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE queue ADD COLUMN tags TEXT;
ALTER TABLE queue ADD COLUMN timeout_seconds INTEGER;
ALTER TABLE queue ADD COLUMN max_cost_usd REAL;
ALTER TABLE queue ADD COLUMN requirements TEXT;       -- JSON: machine capabilities needed
ALTER TABLE queue ADD COLUMN depends_on TEXT;          -- JSON: task IDs
ALTER TABLE queue ADD COLUMN name TEXT;
ALTER TABLE queue ADD COLUMN retry_policy TEXT;        -- JSON: {maxRetries, backoffSeconds}

-- Phase 3: Templates
CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  prompt TEXT NOT NULL,
  cwd TEXT,
  flags TEXT,
  machine_id TEXT,
  requirements TEXT,
  timeout_seconds INTEGER,
  max_cost_usd REAL,
  variables TEXT,              -- JSON: [{name, label, description, default, type}]
  tags TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Phase 4: Scheduled Tasks
CREATE TABLE scheduled_tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  prompt TEXT NOT NULL,
  cwd TEXT NOT NULL,
  machine_id TEXT,
  flags TEXT,
  requirements TEXT,
  timeout_seconds INTEGER,
  max_cost_usd REAL,
  concurrency_policy TEXT DEFAULT 'forbid',  -- allow, forbid, replace
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  next_run_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Phase 4: Audit Log
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Phase 4: Recording Annotations
CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  timestamp_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

### Recommended API Additions

```
POST   /api/sessions/:id/restart       Kill + start new with same spec
POST   /api/sessions/:id/clone         Start new with identical spec (optionally different machine)
POST   /api/sessions/bulk/kill         { sessionIds: string[] }
POST   /api/sessions/bulk/clone        { sessionIds: string[], targetMachineId?: string }
POST   /api/queues/bulk/clear          { machineIds: string[] }
GET    /api/templates                  List templates
POST   /api/templates                  Create template
POST   /api/templates/:id/launch       Launch session from template (with variable values)
GET    /api/scheduled-tasks            List scheduled tasks
POST   /api/scheduled-tasks            Create scheduled task
PATCH  /api/scheduled-tasks/:id        Update (enable/disable/modify)
DELETE /api/scheduled-tasks/:id        Remove scheduled task
```

### Recommended WebSocket Protocol Additions

```typescript
// Dashboard → Hub (subscribe/unsubscribe)
{ type: "subscribe", resource: "session" | "machine" | "queue", id?: string }
{ type: "unsubscribe", resource: "session" | "machine" | "queue", id?: string }

// Hub → Dashboard (new message types)
{ type: "session:event", sessionId: string, event: { type: string, payload: unknown, receivedAt: number } }
{ type: "activity", entry: { type: string, entityType: string, entityId: string, message: string, timestamp: number } }
```
