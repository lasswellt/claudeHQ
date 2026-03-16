# Claude HQ

A self-hosted workforce management platform for Claude Code. Manage, monitor, and control Claude Code sessions across multiple machines from a single web dashboard.

```
                    Claude HQ Dashboard
                   (Nuxt 3 + Vuetify 3)

  +----------+ +----------+ +----------+
  | Session 1| | Session 2| | Session 3|  + Queue
  | studio-pc| | macbook  | | nuc-srv  |  + Approvals
  | running  | | running  | | queued   |  + Notifications
  +----------+ +----------+ +----------+
                      |
               +------+------+
               |   Hub API   |
               |  (Fastify)  |
               |  + SQLite   |
               +------+------+
                      |
          +-----------+-----------+
          |           |           |
     +----+----+ +----+----+ +----+----+
     |  Agent  | |  Agent  | |  Agent  |
     |studio-pc| | macbook | | nuc-srv |
     | PTY x2  | | PTY x1  | | PTY x2  |
     +---------+ +---------+ +---------+
```

## Features

- **Live Terminal Streaming** -- Watch Claude Code work in real-time via xterm.js in your browser
- **Multi-Machine Management** -- Agents on any machine connect to a central Hub over Tailscale
- **Session Queue** -- Queue tasks with priority ordering, auto-advance when slots free up
- **Approval System** -- Policy engine auto-approves safe actions, queues risky ones for human review
- **Session Replay** -- Replay completed sessions with timeline scrubber and speed controls
- **Repository Registry** -- Register repos, auto-detect dependencies, launch jobs against any codebase
- **Job Orchestration** -- Full lifecycle: clone repo, create branch, install deps, run agent, commit, create PR
- **GitHub Integration** -- Auto-create PRs, report status via Checks API, receive webhooks
- **Cost Tracking** -- Per-session token/cost tracking with daily/monthly budgets
- **Scheduled Tasks** -- Cron-based recurring prompts
- **Notifications** -- Webhooks to Discord, Slack, ntfy.sh, or any endpoint
- **Docker Deployment** -- Single `docker compose up` runs everything
- **Dark/Light Theme** -- Vuetify 3 with custom color scheme

## Prerequisites

- **Node.js** >= 20
- **pnpm** >= 9 (installed via corepack: `corepack enable`)
- **Claude Code** installed on agent machines (`curl -fsSL https://claude.ai/install.sh | bash`)
- **Tailscale** (optional but recommended) for mesh networking between machines
- **Docker** (optional) for containerized deployment

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/lasswellt/claudeHQ.git
cd claudeHQ
corepack enable
pnpm install
```

### 2. Build

```bash
pnpm turbo build
```

### 3. Start the Hub

```bash
cd packages/hub
node dist/index.js
```

The Hub starts on `http://localhost:7700`. Verify:

```bash
curl http://localhost:7700/health
# {"status":"ok","version":"0.1.0","uptime":1.23,"machines":0,"connectedAgents":0}
```

### 4. Start the Dashboard (Development)

```bash
cd packages/dashboard
pnpm dev
```

Opens at `http://localhost:3000`. The dashboard proxies API calls to the Hub automatically.

### 5. Configure an Agent

Create `~/.chq/config.json` on each machine that will run Claude Code:

```json
{
  "machineId": "my-machine",
  "displayName": "My Development Machine",
  "hubUrl": "ws://localhost:7700"
}
```

If using Tailscale, replace `localhost` with the Hub machine's Tailscale IP:

```json
{
  "hubUrl": "ws://100.x.x.x:7700"
}
```

### 6. Start the Agent

```bash
cd packages/agent
node dist/cli.js agent start
```

The agent connects to the Hub, registers, and starts sending heartbeats. You should see the machine appear in the dashboard.

## Docker Deployment

For production, run everything in Docker:

```bash
# Copy and edit the environment file
cp .env.example .env

# Build and start
docker compose build
docker compose up -d

# Verify
curl http://localhost:7700/health
```

The Hub serves the dashboard's static files directly -- one container, one port.

### Docker Compose Services

```yaml
services:
  hub:
    build: { context: ., dockerfile: Dockerfile.hub }
    ports: ["7700:7700"]
    volumes:
      - ./data/db:/app/data/db          # SQLite persistence
      - ./data/recordings:/app/data/recordings  # Session recordings
    restart: unless-stopped
```

### With Tailscale Sidecar

For mesh networking with automatic TLS:

```yaml
services:
  tailscale:
    image: tailscale/tailscale:latest
    hostname: claude-hq
    environment:
      - TS_AUTHKEY=${TS_AUTHKEY}
      - TS_STATE_DIR=/var/lib/tailscale
    volumes:
      - ts-state:/var/lib/tailscale
    devices: ["/dev/net/tun:/dev/net/tun"]
    cap_add: [net_admin, sys_module]

  hub:
    build: { context: ., dockerfile: Dockerfile.hub }
    network_mode: service:tailscale
    # ... rest of config
```

## Configuration

### Hub (`CHQ_HUB_*` environment variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `CHQ_HUB_PORT` | `7700` | HTTP/WebSocket port |
| `CHQ_HUB_HOST` | `0.0.0.0` | Bind address |
| `CHQ_HUB_DATABASEPATH` | `./data/db/chq.db` | SQLite database path |
| `CHQ_HUB_RECORDINGSPATH` | `./data/recordings` | JSONL recording storage |
| `CHQ_HUB_LOGLEVEL` | `info` | Log level (fatal/error/warn/info/debug/trace) |
| `CHQ_HUB_DASHBOARDSTATICPATH` | - | Path to dashboard static files (production) |

### Agent (`~/.chq/config.json`)

```json
{
  "machineId": "studio-pc",
  "displayName": "Studio PC",
  "hubUrl": "ws://100.x.x.x:7700",
  "claudeBinary": "claude",
  "defaultFlags": [],
  "defaultCwd": "/home/user/projects",
  "maxConcurrentSessions": 2,
  "recordingChunkIntervalMs": 100,
  "recordingUploadIntervalMs": 5000
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `machineId` | Yes | - | Unique machine identifier |
| `hubUrl` | Yes | - | WebSocket URL of the Hub |
| `displayName` | No | machineId | Human-readable name |
| `claudeBinary` | No | `claude` | Path to Claude Code binary |
| `defaultFlags` | No | `[]` | Default CLI flags for sessions |
| `maxConcurrentSessions` | No | `2` | Max parallel PTY sessions |

## Dashboard Pages

| Page | URL | Description |
|------|-----|-------------|
| Overview | `/` | Machine cards, recent sessions, New Session button |
| Jobs | `/jobs` | Job lifecycle tracking (pending, running, completed) |
| Repos | `/repos` | Repository registry, import from GitHub URL |
| Pull Requests | `/prs` | PRs created by agents, review/CI status |
| Sessions | `/sessions` | Search, filter, session history |
| Session Detail | `/sessions/:id` | Live terminal, metadata, input bar, kill/resume |
| Session Replay | `/sessions/:id/replay` | Playback with timeline, speed controls |
| Session Grid | `/sessions/grid` | 2x2 or 1x4 multi-terminal view |
| Machines | `/machines` | Machine cards with health sparklines |
| Machine Detail | `/machines/:id` | Sessions, health charts, queue |
| Queue | `/queues` | Per-machine task queues, add/remove/reorder |
| Approvals | `/approvals` | Pending approval requests, bulk actions |
| Scheduled Tasks | `/scheduled-tasks` | Cron-based recurring tasks |
| Costs | `/costs` | Today/week/month spend, cost by repo/machine |
| Settings | `/settings/approval-policies` | Approval policy rules |
| GitHub | `/settings/github` | GitHub App setup wizard |

## GitHub Integration

Claude HQ can auto-create pull requests when jobs complete.

### Option 1: GitHub App (Recommended)

1. Navigate to **Settings > GitHub** in the dashboard
2. Click **Create GitHub App** -- this uses the GitHub manifest flow
3. GitHub creates the app and returns credentials automatically
4. Install the app on your repositories
5. Claude HQ handles token rotation automatically

### Option 2: Personal Access Token

1. Create a fine-grained PAT at `github.com/settings/personal-access-tokens/new`
2. Grant permissions: Contents (write), Pull Requests (write), Issues (write)
3. Enter the token in **Settings > GitHub**
4. Note: No webhooks, no Checks API with PAT

## Approval System

Claude HQ includes a policy engine that auto-resolves safe actions and queues risky ones:

| Priority | Rule | Action |
|----------|------|--------|
| 10 | Read, Glob, Grep, LS, View | Auto-approve |
| 20 | Bash: rm -rf, sudo, curl\|bash | Auto-deny |
| 30 | Bash: ls, git status, npm test | Auto-approve |
| 40 | Write, Edit (code files) | Auto-approve |
| 50 | All other Bash commands | Require approval |
| 1000 | Default (everything else) | Require approval |

Configure rules in **Settings > Approval Policies** or via `POST /api/approval-policies`.

## API Reference

### Sessions

```
GET    /api/sessions              List sessions (?machine=X&status=running)
GET    /api/sessions/:id          Session detail
POST   /api/sessions              Start session { machineId, prompt, cwd }
DELETE /api/sessions/:id          Kill session
POST   /api/sessions/:id/input    Send PTY input { input: "yes\n" }
POST   /api/sessions/:id/resume   Resume with follow-up { prompt }
GET    /api/sessions/:id/recording Stream JSONL recording
```

### Machines

```
GET    /api/machines              List machines
GET    /api/machines/:id          Machine detail + sessions
GET    /api/machines/:id/health   Health history (?hours=24)
```

### Jobs

```
GET    /api/jobs                  List jobs (?repoId=X&status=running)
POST   /api/jobs                  Create job { repoId, title, prompt }
POST   /api/jobs/:id/cancel       Cancel job
POST   /api/jobs/:id/create-pr    Create PR from job
POST   /api/jobs/batch            Batch create { repoIds[], prompt }
```

### Repos

```
GET    /api/repos                 List repositories
POST   /api/repos                 Register repo
POST   /api/repos/import          Import from GitHub URL { url }
PUT    /api/repos/:id             Update repo config
```

### Queue, Templates, Approvals, Notifications, Costs, Scheduled Tasks

See full API at `GET /health` and explore via the dashboard.

## Architecture

```
packages/
  shared/        Zod schemas, TypeScript types, WebSocket protocol
  agent/         Node.js daemon: PTY pool, WS client, recorder, git ops,
                 Docker/SSH spawn, queue, scrubber, devcontainer detection
  hub/           Fastify server: SQLite (9 migrations), REST API (10 route files),
                 WS relay, approval engine, notifications, GitHub client, cron, costs
  dashboard/     Nuxt 3 SPA: Vuetify 3, xterm.js, 17 pages, Pinia stores
```

### Package Boundaries

```
agent     --> shared   (allowed)
hub       --> shared   (allowed)
dashboard --> shared   (allowed, browser entrypoint only)
*         --> *        (forbidden between agent/hub/dashboard)
```

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm turbo build

# Run tests (36 tests)
npx vitest run

# Start Hub in dev mode
cd packages/hub && node dist/index.js

# Start Dashboard in dev mode (with API proxy)
cd packages/dashboard && pnpm dev

# Lint
pnpm lint

# Format
pnpm format
```

### Makefile Shortcuts

```bash
make build     # docker compose build
make up        # docker compose up -d
make down      # docker compose down
make logs      # docker compose logs -f hub
make status    # show health + container status
make backup    # sqlite3 .backup
make test      # vitest run
```

## Security Notes

- **Default-deny approval system** -- unresolved tool calls are denied, not allowed
- **No `--dangerously-skip-permissions` by default** -- must be explicitly configured per agent
- **Shell injection protected** -- all git operations use `execFileSync` with argument arrays
- **SQL injection protected** -- parameterized prepared statements everywhere, column whitelisting
- **GitHub webhook verification** -- HMAC-SHA256 signature validation
- **Zod validation** -- all WebSocket messages and API payloads validated at the boundary
- **Secrets never in Hub DB** -- agent secrets resolved locally via env/file references
- **Tailscale network boundary** -- no public exposure required

## License

MIT
