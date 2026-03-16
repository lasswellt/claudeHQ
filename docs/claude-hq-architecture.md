---
title: Claude HQ - Architecture Design
version: 0.2.0
status: approved-draft
author: DC BLOX IT
date: 2026-03-15
---

# Claude HQ: Claude Code Remote Console

A self-hosted system for managing, monitoring, and controlling Claude Code sessions across multiple machines from a single web dashboard.

## Problem

Running 3-4 concurrent Claude Code sessions across personal machines, each executing skills with multi-agent orchestration and sub-agent teams, requires constant terminal switching, SSH-ing around, and manual tracking of what each session is doing. There's no unified view, no way to queue work, and no remote control without opening a terminal on each machine.

Anthropic's built-in `claude remote-control` (Feb 2026) solves "continue one session from your phone" but lacks multi-session overview, queue management, terminal replay, remote session start, and notifications.

## Solution

Three-component system connected over Tailscale:

```
┌──────────────────────────────────────────────────────────┐
│                    Claude HQ Dashboard                    │
│                   (Nuxt 3 + xterm.js)                    │
│                                                          │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐              │
│  │ Session 1 │ │ Session 2 │ │ Session 3 │  + Queue     │
│  │ studio-pc │ │ macbook   │ │ studio-pc │  + Notify    │
│  │ skill:dev │ │ skill:rev │ │ skill:doc │  Manager     │
│  └───────────┘ └───────────┘ └───────────┘              │
└───────────────────────┬──────────────────────────────────┘
                        │ WebSocket (Tailscale)
                 ┌──────┴──────┐
                 │   Hub API   │
                 │  (Fastify)  │
                 │  + SQLite   │
                 │  + Notify   │
                 └──────┬──────┘
                        │ WebSocket (Tailscale)
          ┌─────────────┼─────────────┐
          │             │             │
     ┌────┴────┐  ┌────┴────┐  ┌────┴────┐
     │  Agent  │  │  Agent  │  │  Agent  │
     │studio-pc│  │ macbook │  │ nuc-srv │
     │ PTY x2  │  │ PTY x1  │  │ PTY x2  │
     └─────────┘  └─────────┘  └─────────┘
```

## Design Decisions (Resolved)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Session input | Hybrid: PTY stdin (active) + `--resume` (follow-up) | Multi-agent skills need live PTY; `--resume` for clean follow-ups after completion |
| Recording storage | Centralized on Hub | Simpler replay, Hub has disk |
| Concurrent sessions | Yes, configurable per machine | Skills + agent teams benefit from parallelism |
| Notifications | Yes, Phase 2 (promoted from Phase 4) | Critical for fire-and-forget queued work |
| Auth model | Tailscale ACL only | Personal tool, Tailscale network boundary is sufficient |

## Components

### 1. Agent (`chq-agent`)

Lightweight Node.js daemon running on each machine. Manages multiple concurrent PTY sessions wrapping Claude Code.

#### Hybrid Input Strategy

Sessions run in two modes depending on state:

```
┌─────────────────────────────────────────────────────────┐
│                    Session Lifecycle                      │
│                                                          │
│  ┌──────────┐    ┌─────────┐    ┌───────────────────┐   │
│  │  QUEUED  │───▶│ RUNNING │───▶│ COMPLETED/FAILED  │   │
│  └──────────┘    └────┬────┘    └────────┬──────────┘   │
│                       │                  │               │
│                  PTY Mode            Resume Mode          │
│               (interactive)       (conversation continues)│
│                       │                  │               │
│                  Input via           Input via            │
│                  PTY stdin       claude -p --resume       │
│                  (keystrokes)    (new PTY, same convo)    │
│                       │                  │               │
│              Sub-agents active     Clean follow-up        │
│              Skills running        New prompt to same     │
│              AskUser prompts       session context        │
│              Full ANSI stream                             │
└─────────────────────────────────────────────────────────┘
```

**PTY Mode (active session):** All input goes through `pty.write()`. This is essential for multi-agent skills because sub-agents, `AskUserQuestion` prompts, and interactive skill flows all read from the same terminal stdin. The dashboard sends keystrokes exactly as if you were typing at the keyboard.

**Resume Mode (completed session):** When a session finishes (exit code received), follow-up prompts from the dashboard spawn a new PTY process with `claude -p "follow-up prompt" --resume {claudeSessionId}`. This continues the conversation history cleanly without conflicting with any running process.

**Claude Session ID extraction:** The agent parses Claude Code's internal session ID from either:
- The `stream-json` output (if available in the PTY stream)
- The `~/.claude/projects/` directory (most recent session file matching the cwd)
- Stored as `claudeSessionId` on the session record for later `--resume` use

#### Multi-Session Management

Each agent manages a pool of PTY sessions up to `maxConcurrentSessions`. Each PTY is independent with its own:
- `node-pty` instance
- Recording stream
- WebSocket output channel
- Working directory context

```
Agent Process
├── Daemon (long-running)
│   ├── WebSocket client → Hub
│   ├── Heartbeat reporter
│   └── Queue watcher
├── PTY Pool
│   ├── Session A (skill:dev-agent running, 3 sub-agents active)
│   │   ├── node-pty instance
│   │   ├── Recording writer → JSONL
│   │   └── Output → WS stream
│   └── Session B (skill:review running)
│       ├── node-pty instance
│       ├── Recording writer → JSONL
│       └── Output → WS stream
└── Queue (persisted to disk)
    ├── Task 1: "Run migration skill on /app/db"
    └── Task 2: "Generate API docs for /app/src"
```

Queue auto-advance: When a PTY slot frees up (session completes/fails), the agent pops the next task from the queue and spawns it.

#### CLI Interface

```bash
# Start sessions
chq run "Fix the auth middleware bug"                    # immediate start
chq run "Fix the auth middleware bug" --cwd /path/to/repo  # specify working dir
chq run --queue "Refactor the database layer"            # add to queue
chq run --queue --priority 1 "Hotfix: login broken"      # queue with priority
chq run --flags "--allowedTools Read,Write" "Review code"  # custom Claude flags

# Follow up on completed session
chq resume <sessionId> "Now add tests for the fix"       # --resume mode

# Daemon management
chq agent start          # start the agent daemon
chq agent stop           # stop gracefully, waits for active sessions
chq agent stop --force   # kill immediately
chq agent status         # show running sessions + queue

# Session management
chq sessions             # list active sessions
chq sessions --all       # include completed
chq kill <sessionId>     # kill specific session
chq input <sessionId> "yes"  # send PTY input to active session
```

#### Agent Config (`~/.chq/config.json`)

```json
{
  "machineId": "studio-pc",
  "displayName": "Studio PC",
  "hubUrl": "ws://100.x.x.x:7700",
  "claudeBinary": "claude",
  "defaultFlags": ["--dangerously-skip-permissions"],
  "defaultCwd": "/home/user/projects",
  "maxConcurrentSessions": 2,
  "recordingChunkIntervalMs": 100,
  "recordingUploadIntervalMs": 5000,
  "recordingRetentionDays": 7
}
```

#### PTY Input Safety

For multi-agent sessions, the dashboard input must be handled carefully:

| Scenario | Input Method | Notes |
|----------|-------------|-------|
| Claude waiting for user input | PTY `write(text + \n)` | Normal interactive flow |
| Skill `AskUserQuestion` prompt | PTY `write(selection + \n)` | Skill expects numbered choice or text |
| Sub-agent running, no prompt visible | PTY `write(text + \n)` | Queued in terminal buffer, processed when agent reads stdin |
| Claude idle/completed | `--resume` new PTY | Clean continuation |
| Need to abort | PTY `write(\x03)` (Ctrl+C) | SIGINT to Claude Code |
| Need to force kill | `pty.kill(SIGKILL)` | Last resort |

The dashboard should display a visual indicator of session state (waiting for input, actively processing, sub-agent running) parsed from terminal output patterns.

### 2. Hub (`chq-hub`)

Central Fastify server running on one designated machine. All agents and the dashboard connect here.

#### Responsibilities

- WebSocket server for agent connections (`/ws/agent`)
- WebSocket server for dashboard connections (`/ws/dashboard`)
- REST API for dashboard CRUD operations
- Session state management (SQLite)
- Relay terminal streams: agent → hub → dashboard
- Command relay: dashboard → hub → agent
- Store and serve terminal recordings (JSONL files on disk, metadata in SQLite)
- Agent registry and health monitoring
- Notification dispatch (webhook, websocket push)

#### API Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/machines` | List registered agents + status |
| `GET` | `/api/machines/:id` | Machine detail + active sessions |
| `GET` | `/api/sessions` | List all sessions (filterable: `?machine=X&status=running`) |
| `GET` | `/api/sessions/:id` | Session detail including claude session ID |
| `POST` | `/api/sessions` | Start new session on specified machine |
| `POST` | `/api/sessions/:id/resume` | Resume completed session with new prompt |
| `DELETE` | `/api/sessions/:id` | Kill a running session |
| `POST` | `/api/sessions/:id/input` | Send PTY input to active session |
| `GET` | `/api/sessions/:id/recording` | Stream terminal recording (JSONL) |
| `GET` | `/api/sessions/:id/recording/meta` | Recording metadata (duration, size, chunk count) |
| `GET` | `/api/queues` | All queues across machines |
| `GET` | `/api/queues/:machineId` | Queue for specific machine |
| `POST` | `/api/queues/:machineId` | Add task to machine's queue |
| `DELETE` | `/api/queues/:machineId/:taskId` | Remove queued task |
| `PATCH` | `/api/queues/:machineId` | Reorder queue |
| `POST` | `/api/queues/:machineId/:taskId/move` | Move task to different machine |
| `GET` | `/api/notifications/config` | Get notification settings |
| `PUT` | `/api/notifications/config` | Update notification settings |
| `GET` | `/api/notifications/history` | Recent notification log |

#### WebSocket Protocol

All messages are JSON with a `type` field. Agent and dashboard connections use separate WebSocket paths.

**Agent → Hub:**
```typescript
// Registration (on connect)
{ type: "agent:register", machineId: string, version: string, maxSessions: number, os: string }

// Heartbeat (every 30s)
{ type: "agent:heartbeat", machineId: string, activeSessions: number, cpuPercent: number, memPercent: number }

// Session lifecycle
{ type: "agent:session:started", sessionId: string, machineId: string, prompt: string, cwd: string, pid: number }
{ type: "agent:session:output", sessionId: string, chunks: Array<{ts: number, data: string}> }
{ type: "agent:session:ended", sessionId: string, exitCode: number, claudeSessionId: string | null }

// Recording upload (batched)
{ type: "agent:recording:upload", sessionId: string, chunks: Array<{ts: number, data: string}>, final: boolean }

// Queue state sync
{ type: "agent:queue:updated", machineId: string, queue: Array<QueueTask> }
```

**Hub → Agent:**
```typescript
// Session commands
{ type: "hub:session:start", sessionId: string, prompt: string, cwd: string, flags: string[] }
{ type: "hub:session:resume", sessionId: string, prompt: string, claudeSessionId: string, cwd: string }
{ type: "hub:session:kill", sessionId: string }
{ type: "hub:session:input", sessionId: string, input: string }

// Queue commands
{ type: "hub:queue:add", task: QueueTask }
{ type: "hub:queue:remove", taskId: string }
{ type: "hub:queue:reorder", order: string[] }
```

**Hub → Dashboard:**
```typescript
// Real-time updates (subscribed per session)
{ type: "session:output", sessionId: string, chunks: Array<{ts: number, data: string}> }
{ type: "session:updated", session: SessionRecord }
{ type: "machine:updated", machine: MachineRecord }
{ type: "queue:updated", machineId: string, queue: Array<QueueTask> }
{ type: "notification", notification: NotificationRecord }
```

#### Database Schema (SQLite via better-sqlite3)

```sql
CREATE TABLE machines (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  last_seen INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'offline',
  max_sessions INTEGER NOT NULL DEFAULT 2,
  meta TEXT  -- JSON: { version, os, arch, claudeVersion }
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL REFERENCES machines(id),
  prompt TEXT NOT NULL,
  cwd TEXT NOT NULL,
  flags TEXT,                          -- JSON array of CLI flags
  status TEXT NOT NULL DEFAULT 'queued',
  pid INTEGER,
  exit_code INTEGER,
  claude_session_id TEXT,              -- for --resume follow-ups
  parent_session_id TEXT,              -- links resume chains
  started_at INTEGER,
  ended_at INTEGER,
  last_activity_at INTEGER,
  recording_path TEXT,
  recording_size_bytes INTEGER,
  recording_chunk_count INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_sessions_machine ON sessions(machine_id, status);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_parent ON sessions(parent_session_id);

CREATE TABLE queue (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL REFERENCES machines(id),
  prompt TEXT NOT NULL,
  cwd TEXT NOT NULL,
  flags TEXT,
  priority INTEGER NOT NULL DEFAULT 100,  -- lower = higher priority
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_queue_machine ON queue(machine_id, position);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  type TEXT NOT NULL,                  -- session_completed, session_failed, queue_empty, error
  channel TEXT NOT NULL,               -- webhook, websocket
  payload TEXT NOT NULL,               -- JSON
  sent_at INTEGER NOT NULL DEFAULT (unixepoch()),
  delivered INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE notification_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  webhooks TEXT,                        -- JSON array of webhook URLs
  events TEXT NOT NULL DEFAULT '["session_completed","session_failed"]',
  enabled INTEGER NOT NULL DEFAULT 1
);
```

#### Recording Storage

Recordings stored on Hub filesystem at `{dataDir}/recordings/{sessionId}.jsonl`.

Format (newline-delimited JSON):
```json
{"ts":0,"data":"\u001b[?2004h> claude -p \"Fix auth bug\""}
{"ts":105,"data":"\u001b[32m...\u001b[0m Analyzing codebase..."}
{"ts":1230,"data":"Found 3 files to modify:\n  src/middleware/auth.ts\n  src/utils/jwt.ts"}
```

- `ts`: milliseconds since session start
- `data`: raw terminal output (ANSI preserved)
- Agent streams chunks to Hub every 5s (configurable)
- Hub appends to recording file on disk
- Final flag on last upload closes the recording

### 3. Dashboard (`chq-dashboard`)

Nuxt 3 SPA for viewing and controlling everything. Accessible only via Tailscale network.

#### Views

**Overview / Home**
- Grid of machine cards: name, status indicator, active session count, CPU/mem sparklines
- Global session list (most recent first, filterable)
- Quick action: "New Session" modal (pick machine, enter prompt, set cwd)
- Notification feed sidebar

**Machine Detail (`/machines/:id`)**
- Active sessions with mini terminal previews
- Recent completed sessions with duration, exit code
- Queue manager: drag-to-reorder, add/remove tasks
- Machine health: CPU, memory, disk, uptime

**Session View (`/sessions/:id`)**
- Full xterm.js terminal emulator rendering live output
- Session metadata panel: prompt, machine, duration, status, claude session ID
- Input bar: text field for sending PTY input (with Enter to submit)
- Action buttons: Kill, Pause Stream, Resume (for completed sessions)
- Session state indicator: `Processing`, `Waiting for Input`, `Sub-agent Running`, `Completed`
- Follow-up prompt: appears when session completes, uses `--resume` flow

**Session Grid (`/sessions/grid`)**
- 2x2 or 1x4 layout of live terminal views
- Click to expand any session to full view
- Compact metadata overlays

**Replay View (`/sessions/:id/replay`)**
- xterm.js rendering recorded output
- Timeline scrubber with activity heatmap
- Playback controls: play/pause, 1x/2x/4x/8x speed
- Jump to timestamp, keyboard shortcuts (space=pause, left/right=skip)

**Queue Manager (`/queues`)**
- Cross-machine view: all queues side by side
- Drag tasks between machine queues
- Bulk actions: clear queue, pause auto-advance

#### Session State Detection

The dashboard parses terminal output patterns to determine session state for the UI indicator:

```typescript
const STATE_PATTERNS = {
  processing: [
    /[spinner-chars]/,
    /Analyzing|Reading|Writing|Editing/,
  ],
  waitingForInput: [
    /\? .+\(Y\/n\)/,
    /\? .+\(y\/N\)/,
    /Enter .+ to continue/,
    /Select an option/,
  ],
  subAgentRunning: [
    /\[agent:.+\] running/,
    /Spawning sub-agent/,
    /Delegating to/,
  ],
  completed: [
    /Task completed/,
    /Session ended/,
  ],
};
```

These patterns are configurable and will need tuning based on Claude Code's actual output format.

#### Tech Stack

| Concern | Choice |
|---------|--------|
| Framework | Nuxt 3 (SPA mode, `ssr: false`) |
| UI Library | Quasar |
| Terminal | xterm.js + xterm-addon-fit + xterm-addon-webgl + xterm-addon-serialize |
| WebSocket | Reconnecting WebSocket (custom composable with exponential backoff) |
| State | Pinia |
| Drag-and-drop | vuedraggable (for queue reordering) |
| Charts | unovis or Chart.js (for machine health sparklines) |

### 4. Notification System

Notifications are a core feature. When running fire-and-forget queued tasks across machines, you need to know when things finish or break.

#### Notification Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `session_completed` | Session exits with code 0 | session ID, machine, prompt, duration |
| `session_failed` | Session exits with non-zero code | session ID, machine, prompt, exit code, last 20 lines of output |
| `session_stalled` | No output for configurable threshold (default 5min) | session ID, machine, last activity timestamp |
| `queue_empty` | Machine queue fully drained | machine ID, sessions completed count |
| `agent_offline` | Agent heartbeat missed for 60s+ | machine ID, last seen timestamp |
| `input_needed` | Session waiting for user input for 30s+ | session ID, machine, detected prompt text |

#### Notification Channels

**Phase 2: Webhook**
```json
POST {webhookUrl}
{
  "event": "session_completed",
  "timestamp": "2026-03-15T14:30:00Z",
  "session": {
    "id": "abc-123",
    "machine": "studio-pc",
    "prompt": "Fix the auth middleware bug",
    "duration": 342,
    "exitCode": 0
  }
}
```

Webhook URLs can point to Discord, Slack, Home Assistant, ntfy.sh, or any custom endpoint.

**Phase 2: Dashboard Push**
Real-time via WebSocket. Toast notifications in the dashboard with sound option.

**Phase 4 (future): Direct integrations**
- Discord bot (richer formatting, thread per session)
- Slack app
- Pushover / ntfy native
- Email digest

#### Notification Config

```typescript
interface NotificationConfig {
  enabled: boolean;
  events: NotificationEvent[];
  webhooks: WebhookConfig[];
  stallThresholdSeconds: number;   // default 300 (5 min)
  inputNeededDelaySeconds: number; // default 30
}

interface WebhookConfig {
  url: string;
  label: string;
  events?: NotificationEvent[];
  format: 'json' | 'discord' | 'slack';
}
```

## Data Flows

### Live Terminal Streaming

```
Claude Code (PTY stdout) -> node-pty onData callback -> Agent
  -> buffers chunks for ~100ms
  -> WebSocket frame { type: "agent:session:output", chunks: [...] } -> Hub
    -> appends to recording file on disk
    -> forwards to all Dashboard connections subscribed to this session
      -> xterm.js.write(chunk.data) for each chunk
```

Latency target: < 200ms end-to-end over Tailscale.

### Remote Session Start

```
Dashboard: user clicks "New Session" on studio-pc
  -> POST /api/sessions { machineId: "studio-pc", prompt: "Fix bug", cwd: "/home/user/project" }
  -> Hub validates, checks agent capacity (activeSessions < maxSessions)
  -> Hub creates session record (status: queued)
  -> Hub sends WS: hub:session:start -> Agent on studio-pc
  -> Agent checks local capacity
    -> If slot available: spawns PTY with claude -p "Fix bug" --dangerously-skip-permissions
    -> If full: adds to local queue, notifies Hub
  -> Agent sends WS: agent:session:started { sessionId, pid }
  -> Hub updates session status -> running
  -> Output streaming begins
```

### Session Follow-up (Resume Mode)

```
Dashboard: session "abc-123" completed, user types follow-up prompt
  -> POST /api/sessions/abc-123/resume { prompt: "Now add tests" }
  -> Hub creates NEW session record (parent_session_id: "abc-123")
  -> Hub sends WS: hub:session:resume { sessionId: "def-456", claudeSessionId: "...", prompt: "..." }
  -> Agent spawns new PTY: claude -p "Now add tests" --resume {claudeSessionId}
  -> New session streams independently
```

### PTY Input (Active Session)

```
Dashboard: user types "yes" in input bar for active session
  -> POST /api/sessions/abc-123/input { input: "yes\n" }
  -> Hub sends WS: hub:session:input -> Agent
  -> Agent calls pty.write("yes\n") on the correct PTY instance
  -> Claude Code receives input on stdin, processes it
  -> Output flows back through normal streaming path
```

### Terminal Replay

```
Dashboard: user opens completed session, clicks "Replay"
  -> GET /api/sessions/abc-123/recording
  -> Hub streams JSONL file from disk
  -> Dashboard buffers chunks, builds timeline index
  -> Playback engine:
    -> Reads chunks sequentially
    -> Applies real-time delays (ts delta between chunks)
    -> Speed multiplier adjusts delays (2x = half delay)
    -> xterm.js.write(chunk.data) at each step
  -> Scrubber: rebuilds terminal state by replaying all chunks up to target timestamp
```

### Notification Flow

```
Agent sends: agent:session:ended { sessionId, exitCode: 0 }
  -> Hub updates session record
  -> Hub checks notification config
    -> Event "session_completed" is enabled
    -> Webhooks configured: Discord, Home Assistant
  -> Hub dispatches:
    -> POST Discord webhook (formatted embed with session details)
    -> POST Home Assistant webhook (triggers automation)
  -> Hub sends WS to Dashboard: notification event (toast shown)
  -> Hub logs notification to notifications table
```

## Security

- **Network boundary:** Tailscale mesh. Dashboard, Hub, and all Agents are on the same Tailscale tailnet. No public exposure.
- **Auth:** Tailscale identity. No login page needed.
- **Secrets in recordings:** Agent config supports `scrubPatterns` regex array to redact sensitive content before streaming/storing.
- **Permission flags:** `--dangerously-skip-permissions` is configurable per-agent and overridable per-session from the dashboard.

```json
{
  "scrubPatterns": [
    "sk-ant-[a-zA-Z0-9-_]+",
    "ANTHROPIC_API_KEY=[^ ]+",
    "Bearer [a-zA-Z0-9-_.]+"
  ],
  "scrubReplacement": "[REDACTED]"
}
```

## Project Structure

```
claude-hq/
├── packages/
│   ├── agent/                       # chq-agent
│   │   ├── src/
│   │   │   ├── cli.ts               # CLI entry (chq run, chq agent, chq kill, etc.)
│   │   │   ├── daemon.ts            # Long-running daemon process
│   │   │   ├── pty-pool.ts          # Manages multiple PTY sessions
│   │   │   ├── session.ts           # Single PTY session lifecycle
│   │   │   ├── recorder.ts          # Terminal recording to JSONL + upload
│   │   │   ├── claude-session.ts    # Claude session ID extraction
│   │   │   ├── queue.ts             # Local queue with auto-advance
│   │   │   ├── ws-client.ts         # WebSocket client to Hub (reconnecting)
│   │   │   ├── health.ts            # CPU/mem/disk reporting
│   │   │   └── config.ts            # Config loading + validation
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── hub/                         # chq-hub
│   │   ├── src/
│   │   │   ├── server.ts            # Fastify setup, plugin registration
│   │   │   ├── db.ts                # SQLite schema, migrations, queries
│   │   │   ├── ws/
│   │   │   │   ├── agent-handler.ts # Agent WebSocket message handling
│   │   │   │   └── dashboard-handler.ts
│   │   │   ├── relay.ts             # Stream relay: agent -> recording + dashboard
│   │   │   ├── recordings.ts        # Recording file management
│   │   │   ├── notifications.ts     # Notification dispatch engine
│   │   │   └── routes/
│   │   │       ├── machines.ts
│   │   │       ├── sessions.ts
│   │   │       ├── queues.ts
│   │   │       └── notifications.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── dashboard/                   # chq-dashboard
│   │   ├── app/
│   │   │   ├── pages/
│   │   │   │   ├── index.vue        # Overview grid
│   │   │   │   ├── machines/
│   │   │   │   │   └── [id].vue     # Machine detail
│   │   │   │   ├── sessions/
│   │   │   │   │   ├── [id].vue     # Live session terminal view
│   │   │   │   │   ├── [id]/
│   │   │   │   │   │   └── replay.vue
│   │   │   │   │   └── grid.vue     # Multi-session grid view
│   │   │   │   └── queues/
│   │   │   │       └── index.vue    # Cross-machine queue manager
│   │   │   ├── components/
│   │   │   │   ├── terminal/
│   │   │   │   │   ├── TerminalView.vue
│   │   │   │   │   ├── TerminalReplay.vue
│   │   │   │   │   ├── TerminalInput.vue
│   │   │   │   │   └── SessionStateIndicator.vue
│   │   │   │   ├── session/
│   │   │   │   │   ├── SessionCard.vue
│   │   │   │   │   ├── SessionMeta.vue
│   │   │   │   │   └── NewSessionModal.vue
│   │   │   │   ├── machine/
│   │   │   │   │   ├── MachineCard.vue
│   │   │   │   │   └── MachineHealth.vue
│   │   │   │   ├── queue/
│   │   │   │   │   ├── QueueManager.vue
│   │   │   │   │   └── QueueTask.vue
│   │   │   │   └── notifications/
│   │   │   │       ├── NotificationFeed.vue
│   │   │   │       └── NotificationToast.vue
│   │   │   ├── composables/
│   │   │   │   ├── useWebSocket.ts
│   │   │   │   ├── useTerminal.ts
│   │   │   │   ├── useReplay.ts
│   │   │   │   └── useNotifications.ts
│   │   │   └── stores/
│   │   │       ├── sessions.ts
│   │   │       ├── machines.ts
│   │   │       ├── queues.ts
│   │   │       └── notifications.ts
│   │   ├── nuxt.config.ts
│   │   └── package.json
│   └── shared/                      # Shared types + protocol
│       ├── types.ts
│       ├── events.ts
│       ├── protocol.ts
│       └── package.json
├── package.json                     # pnpm workspace root
├── pnpm-workspace.yaml
└── turbo.json
```

## Implementation Phases

### Phase 1: Agent + Hub Core (MVP)
**Goal:** Sessions can be started via CLI, tracked by Hub, output streamed.

- Agent: daemon process, PTY pool, single-session spawn, output streaming to Hub
- Agent: CLI (`chq run`, `chq agent start/stop/status`)
- Hub: Fastify server, SQLite schema, agent registration via WebSocket
- Hub: Session CRUD REST API
- Hub: Stream relay (agent output -> recording file)
- Shared: TypeScript types, WebSocket protocol
- **Test:** `chq agent start` on one machine, `chq run "hello"`, verify Hub has session record + recording

### Phase 2: Dashboard + Notifications
**Goal:** Full live monitoring from browser, get notified when sessions complete.

- Dashboard: Nuxt 3 + Quasar scaffold, Tailscale-only access
- Dashboard: Overview page with machine cards
- Dashboard: Session view with xterm.js live terminal rendering
- Dashboard: Start/kill sessions from browser
- Dashboard: PTY input bar for active sessions
- Hub: Dashboard WebSocket handler with session subscriptions
- Hub: Notification engine (webhook dispatch)
- Dashboard: Notification feed + toast
- **Test:** Open dashboard, start session on remote machine, watch live output, send input, get Discord notification on completion

### Phase 3: Replay + Queue + Resume
**Goal:** Complete async workflow management.

- Hub: Recording serve endpoint with streaming
- Dashboard: Replay player with timeline scrubber + speed controls
- Agent: Queue management with auto-advance
- Hub + Dashboard: Queue CRUD API + UI with drag-to-reorder
- Agent: Claude session ID extraction for `--resume`
- Hub + Dashboard: Session follow-up/resume flow
- Dashboard: Session chain view (original -> follow-up -> follow-up)
- **Test:** Queue 5 tasks, watch them auto-advance, replay a completed session, resume with follow-up

### Phase 4: Polish + Power Features
**Goal:** Multi-session power user workflow.

- Dashboard: 2x2 / 1x4 session grid view
- Dashboard: Cross-machine queue drag (move tasks between machines)
- Dashboard: Session search, filter, history view
- Agent: Secret scrubbing in recordings
- Hub: Recording retention + cleanup cron
- Hub: Rich notification integrations (Discord embeds, Slack blocks, Home Assistant)
- Dashboard: Notification config UI
- Dashboard: Machine health charts (CPU/mem/disk over time)
- Agent: `chq resume` CLI command

## Key Dependencies

| Package | Purpose | Component |
|---------|---------|-----------|
| `node-pty` | PTY spawning + management | Agent |
| `commander` | CLI framework | Agent |
| `ws` | WebSocket client (reconnecting) | Agent |
| `fastify` | HTTP + WS server | Hub |
| `@fastify/websocket` | WebSocket support | Hub |
| `better-sqlite3` | Embedded database | Hub |
| `pino` | Structured logging | Agent + Hub |
| `xterm` | Terminal emulator | Dashboard |
| `xterm-addon-fit` | Auto-resize terminal | Dashboard |
| `xterm-addon-webgl` | GPU-accelerated rendering | Dashboard |
| `xterm-addon-serialize` | Terminal state serialization (for replay scrub) | Dashboard |
| `@quasar/extras` | UI components | Dashboard |
| `pinia` | State management | Dashboard |
| `vuedraggable` | Drag-and-drop queue reordering | Dashboard |
| `zod` | Runtime type validation (config, API payloads) | All |
