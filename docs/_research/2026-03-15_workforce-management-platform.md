---
title: "Workforce Management Platform: Claude Code Agent Orchestration Across Codebases"
date: 2026-03-15
tags: [architecture, workforce, docker, wsl2, git, github, sdk, cli, scheduling, repos]
status: complete
related: [docs-audit, remote-console-patterns]
packages: [agent, hub, dashboard, shared]
---

# Workforce Management Platform: Claude Code Agent Orchestration Across Codebases

## Summary

Claude HQ can evolve from a remote console system into a full **AI workforce management platform** by adding five new layers on top of the existing architecture: a Repository Registry, Workspace Manager, GitHub Integration Layer, Environment Resolver, and Job Orchestrator. The Claude Code ecosystem as of March 2026 provides every building block needed — the Agent SDK's `spawnClaudeCodeProcess` abstraction enables Docker/SSH/WSL2 execution backends, headless mode (`-p --output-format stream-json`) eliminates the TTY requirement for containerized agents, git worktrees enable parallel agent work on the same repo, and the full hooks system provides structured lifecycle events. The key new abstraction is the **Job** — a unit of work that encompasses repo provisioning, agent invocation, and PR creation.

## Research Questions

1. What is the complete Claude Code programmatic control surface as of March 2026?
2. Can Claude Code run in Docker containers, and what are the requirements?
3. How can WSL2 instances be managed remotely for agent hosting?
4. What git/GitHub automation patterns enable programmatic repo management?
5. What does a workforce management architecture look like?

## Findings

### 1. Claude Code Programmatic Control Surface (March 2026)

#### Five Ways to Control Claude Code

| Method | Best For | TTY Required? | Multi-Session? |
|--------|----------|---------------|----------------|
| **Agent SDK** (`@anthropic-ai/claude-agent-sdk`) | Full programmatic control | No | Yes (separate processes) |
| **CLI headless** (`claude -p --output-format stream-json`) | Simple scripting, CI/CD | No | Yes (separate processes) |
| **CLI interactive** (`claude` in PTY) | Live dashboard terminal view | Yes | Yes (separate PTYs) |
| **Remote Control** (`claude remote-control --spawn worktree`) | Multi-session server mode | Minimal | Yes (up to 32 concurrent) |
| **Agent Teams** (experimental) | Parallel work coordination | Yes (tmux or in-process) | 2-16 teammates per team |

#### Agent SDK — The Primary Integration Surface

The `@anthropic-ai/claude-agent-sdk` TypeScript package is the most powerful control mechanism:

```typescript
import { query, listSessions, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";

// Start a session with full control
for await (const msg of query({
  prompt: "Fix the auth bug",
  options: {
    model: "opus",
    permissionMode: "bypassPermissions",
    maxTurns: 250,
    maxBudgetUsd: 5.0,
    cwd: "/path/to/repo",
    env: { NODE_ENV: "test" },
    // Custom tool approval callback
    canUseTool: async (tool, input) => tool.name === "Bash" ? "deny" : "allow",
    // In-process hooks (no HTTP/command needed)
    hooks: {
      Stop: [{ callback: async (event) => { /* update Hub */ } }],
      PostToolUse: [{ callback: async (event) => { /* log tool use */ } }]
    },
    // Custom MCP servers
    mcpServers: [myCustomMcpServer],
    // CRITICAL: Custom spawn function for Docker/SSH/remote execution
    spawnClaudeCodeProcess: customSpawnFn,
  }
})) {
  if (msg.type === "result") {
    console.log(msg.session_id, msg.cost_usd, msg.usage);
  }
}

// Read session transcripts
const messages = await getSessionMessages(sessionId);

// V2 Preview: Session-based multi-turn
await using session = unstable_v2_createSession({ model: "claude-opus-4-6" });
await session.send("Fix the bug");
for await (const msg of session.stream()) { /* ... */ }
await session.send("Now add tests");  // continues same session
```

**Key capability for Claude HQ:** The `spawnClaudeCodeProcess` option accepts a custom function that receives `{ command, args, cwd, env, signal }` and returns a `SpawnedProcess` (stdin/stdout streams + kill/exit). This lets the Hub route execution to:
- Docker containers via `docker exec`
- Remote machines via `ssh`
- WSL2 instances via `wsl -d <distro> --`
- Local processes (default)

#### Complete CLI Flags (50+ flags)

Key flags for workforce management:

| Flag | Purpose |
|------|---------|
| `-p` / `--print` | Headless mode (no TTY) |
| `-n` / `--name` | Session name for tracking |
| `-r` / `--resume` | Resume session by ID or name |
| `--output-format stream-json` | NDJSON streaming output |
| `--input-format stream-json` | NDJSON streaming input (multi-turn) |
| `--max-turns N` | Limit agentic turns |
| `--max-budget-usd N` | Cost limit per session |
| `--dangerously-skip-permissions` | Skip all permission prompts |
| `--permission-mode` | Set permission mode (plan, acceptEdits, bypassPermissions) |
| `--allowedTools` | Whitelist specific tools |
| `--disallowedTools` | Blacklist specific tools |
| `--mcp-config` | Load MCP servers from JSON |
| `--system-prompt` / `--append-system-prompt` | Custom system prompt |
| `--json-schema` | Structured JSON output matching a schema |
| `--worktree` / `-w` | Start in isolated git worktree |
| `--effort` | Set effort level (low/medium/high/max) |
| `--agent` | Specify a subagent |
| `--agents` | Define subagents dynamically via JSON |
| `--no-session-persistence` | Don't save session to disk |
| `--fork-session` | Create new session ID when resuming |
| `--cwd` | Working directory (implicit, via process cwd) |

#### Hooks System — 21+ Events

| Event | HTTP Hook? | Can Block? | Workforce Use |
|-------|-----------|------------|---------------|
| `PreToolUse` | Yes | Yes | Centralized policy enforcement |
| `PostToolUse` | Yes | No | Live activity feed, tool use tracking |
| `PostToolUseFailure` | Yes | No | Error tracking |
| `PermissionRequest` | Yes | Yes | Auto-approve/deny from Hub |
| `Stop` | Yes | Yes | Session completion notification |
| `SubagentStop` | Yes | Yes | Sub-agent tracking |
| `TaskCompleted` | Yes | Yes | Task tracking |
| `UserPromptSubmit` | Yes | Yes | Input logging |
| `SessionStart` | Command only | No | Session registration (use agent WS) |
| `SessionEnd` | Command only | No | Session cleanup (use agent WS) |
| `Notification` | Command only | No | Input needed detection |
| `SubagentStart` | Command only | No | Sub-agent spawn tracking |
| `PreCompact` | Command only | No | Context health monitoring |

#### Stream-JSON Message Types

The NDJSON output includes 18+ message types: `assistant`, `user`, `result`, `system` (init/compact_boundary), `stream_event`, `status`, hook events, tool progress, rate limit events, and prompt suggestions. The `result` message contains `session_id`, `total_cost_usd`, `usage`, `duration_ms`, `num_turns`, and `stop_reason`.

#### Key Environment Variables (200+ total)

Critical for workforce management:
- `ANTHROPIC_API_KEY` — authentication
- `ANTHROPIC_MODEL` — default model override
- `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, `MAX_THINKING_TOKENS` — token limits
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` — enable teams
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` — disable telemetry in containers
- `CLAUDE_CODE_DISABLE_AUTO_MEMORY` — prevent memory writes in automated runs
- `OTEL_EXPORTER_OTLP_ENDPOINT` — OpenTelemetry observability

### 2. Docker Containerization

#### Official Support is First-Class

Anthropic provides:
- **Official Docker image:** `ghcr.io/anthropics/claude-code:latest`
- **DevContainer Feature:** `"features": { "ghcr.io/anthropics/devcontainer-features/claude-code:1.0": {} }`
- **Docker Sandboxes:** Purpose-built sandboxing via Docker microVMs
- **Official devcontainer** with firewall restrictions at `anthropics/claude-code/.devcontainer`

#### Running Claude Code in Docker

**Headless mode (`-p`) does NOT require a TTY.** This is the key enabler for containerized agents.

```bash
# Ephemeral: run task, capture output, tear down
docker run --rm \
  -e ANTHROPIC_API_KEY=$KEY \
  -e CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
  -v /path/to/repo:/workspace \
  -w /workspace \
  ghcr.io/anthropics/claude-code:latest \
  claude -p "Fix the pagination bug" \
    --output-format stream-json \
    --dangerously-skip-permissions \
    --max-budget-usd 5
```

**Important notes:**
- Use `node:22-slim` base (NOT Alpine — musl libc breaks native modules)
- NPM install is deprecated since Feb 2026; use `curl -fsSL https://claude.ai/install.sh | bash` or the official image
- node-pty works in Docker (has `/dev/pts`) but is NOT needed for headless mode
- Claude Code auto-loads `.env` files — block access in containers for security
- Never mount Docker socket into a Claude Code container

#### Community Projects

| Project | Focus |
|---------|-------|
| [claudebox](https://github.com/RchGrav/claudebox) | 15+ dev profiles, per-project isolation, firewall allowlists |
| [claude-container](https://github.com/nezhar/claude-container) | Complete isolation with persistent credentials |
| [claude-code-devcontainer](https://github.com/trailofbits/claude-code-devcontainer) | Trail of Bits security audit sandbox with bubblewrap |
| [claude-code-sdk-docker](https://github.com/cabinlab/claude-code-sdk-docker) | Docker containers for TS and Python SDKs |
| [claude-agent-server](https://github.com/dzhng/claude-agent-server) | WebSocket-controlled Claude Code in Docker |

#### Container-per-Job Model

```
Machine (Agent)
├── Agent process (native, manages containers)
└── Running containers:
    ├── job-abc123 (repo-a workspace)
    │   └── Claude Code headless process
    └── job-def456 (repo-b workspace)
        └── Claude Code headless process
```

The Agent SDK's `spawnClaudeCodeProcess` routes execution into containers:

```typescript
const customSpawn = ({ command, args, cwd, env }) => {
  const proc = spawn('docker', [
    'exec', '-i', containerId,
    command, ...args
  ], { cwd, env });
  return { stdin: proc.stdin, stdout: proc.stdout, kill: () => proc.kill(), /* ... */ };
};
```

### 3. WSL2 Management

#### Key Capabilities

| Capability | Status | Notes |
|-----------|--------|-------|
| systemd | Supported | `[boot] systemd=true` in `/etc/wsl.conf` |
| SSH server | Works | Enable via systemd; allows remote access |
| Tailscale | Run on Windows host | Running inside WSL2 conflicts with Windows Tailscale |
| Multiple distros | Supported | `wsl --import` from tar archives |
| Resource limits | Global only | `.wslconfig` applies to ALL distros (no per-distro limits) |
| Mirrored networking | Win 11 22H2+ | WSL2 gets a routable LAN IP |
| Docker inside WSL2 | Works | Install `docker-ce` directly; avoids Docker Desktop licensing |
| Startup automation | Task Scheduler | `wsl -u root /path/to/startup.sh` on Windows boot |

#### WSL2 as Agent Host

```
Windows Machine
├── Tailscale (Windows-level, provides mesh IP)
├── WSL2 Instance "ubuntu-dev"
│   ├── systemd enabled
│   ├── chq-agent daemon (systemd service)
│   ├── Node.js 22 + Claude Code
│   └── /home/user/workspaces/
└── WSL2 Instance "ubuntu-gpu" (optional second distro)
    └── Different agent config (GPU workloads)
```

#### Provisioning Automation

```powershell
# Create WSL2 instance from Docker image
docker export $(docker create node:22-slim) > node-agent.tar
wsl --import claude-agent C:\WSL\claude-agent node-agent.tar
wsl -d claude-agent -- bash -c "apt-get update && apt-get install -y git curl && curl -fsSL https://claude.ai/install.sh | bash"
```

**Critical limitation:** `.wslconfig` resource limits are global, not per-distro. If running multiple WSL2 agent instances, they share the same memory/CPU pool.

### 4. Git & GitHub Automation

#### Recommended Libraries

| Purpose | Package | Why |
|---------|---------|-----|
| Git operations | `simple-git` | Most popular, promise-based, TypeScript |
| GitHub API | `octokit` | Official SDK, REST + GraphQL + Auth + Webhooks |
| GitHub Auth | `@octokit/auth-app` | GitHub App tokens with auto-rotation |
| Webhooks | `@octokit/webhooks` | Event typing, signature verification |
| Package manager detection | `nypm` | By UnJS/Nuxt team, auto-detects npm/pnpm/yarn/bun |
| File watching | `chokidar` | Native OS events, used in VS Code |
| Diff viewer | `@git-diff-view/vue` | GitHub-style, Vue 3, virtual scrolling |

#### Git Worktrees — Critical for Parallel Agents

Git worktrees allow multiple working directories sharing a single `.git` object store:

```
/repos/org/acme-api/                    # base clone (shared .git)
/workspaces/
  session-abc123/                        # worktree on branch chq/abc123/fix-login
  session-def456/                        # worktree on branch chq/def456/add-tests
  session-ghi789/                        # worktree on branch chq/ghi789/refactor
```

Benefits: Full isolation between agents, shared git objects (minimal disk overhead), independent `node_modules` per worktree. **pnpm is strongly recommended** — its content-addressable store deduplicates packages across worktrees via hardlinks.

Worktree lifecycle:
1. `git worktree add /workspaces/<id> -b chq/<id>/<slug> origin/main`
2. `cd /workspaces/<id> && pnpm install`
3. Agent works, commits, pushes
4. Create PR via Octokit
5. `git worktree remove /workspaces/<id>`

#### GitHub App Authentication (Recommended)

GitHub Apps are the best auth method for an automation system:
- Not tied to a user account
- Short-lived tokens (60 min) with auto-rotation
- Granular per-repository permissions (50+ scopes)
- Higher rate limits (5,000 req/hour per installation)
- Audit trail with `token_id` in all API calls
- `@octokit/auth-app` handles JWT creation and token rotation automatically

#### Branch Strategy for AI Agents

Convention: `chq/<session-id>/<description-slug>`

- `chq/` prefix for easy filtering and cleanup
- Session ID for traceability
- Never push directly to main — always feature branch + PR
- Auto-delete branches after PR merge (via webhook listener)
- Conflict prevention: assign agents to non-overlapping areas, keep branches short-lived, rebase before PR creation

#### GitHub Checks API

Report agent work status back to GitHub as check runs visible on PRs:

```typescript
await octokit.rest.checks.create({
  owner, repo, head_sha: commitSha,
  name: "Claude HQ Agent",
  status: "in_progress",
  output: { title: "Agent working...", summary: "Processing: fix login bug" }
});
```

### 5. Workforce Management Architecture

#### The Job Abstraction

The current system has Sessions (PTY invocation). The workforce system introduces **Jobs** — a higher-level unit encompassing the full lifecycle from workspace provisioning through PR creation:

```
Job (workforce unit)
├── Workspace (provisioned repo + branch)
├── Session 1: Initial work
├── Session 2: Follow-up fix (--resume)
├── Session 3: Add tests
├── Post-completion: commit, push, create PR
└── Metadata: cost, duration, files changed, PR URL, test results
```

#### Complete Workflow

```
User: "Fix the pagination bug in acme-api"
  │
  ├─ [RESOLVE]     Hub looks up repo in registry → git URL, auth, setup commands
  ├─ [SCHEDULE]    Hub selects machine (auto-score or user picks)
  ├─ [PROVISION]   Agent clones/fetches repo, creates worktree + branch
  ├─ [PREPARE]     Agent installs deps, runs pre-flight checks
  ├─ [SPAWN]       Agent launches Claude Code in workspace
  ├─ [WORK]        Claude Code runs, hooks fire to Hub, output streams to dashboard
  ├─ [COMPLETE]    Session ends, Agent runs post-flight checks
  ├─ [DELIVER]     Agent commits, pushes, Hub creates PR via GitHub API
  └─ [CLEANUP]     Workspace retained for follow-up or auto-cleaned
```

#### Repository Registry

New Hub module tracking known repositories with their configuration:

```sql
CREATE TABLE repos (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner TEXT,
  default_branch TEXT NOT NULL DEFAULT 'main',
  auth_method TEXT NOT NULL DEFAULT 'ssh_key',
  auth_credential_ref TEXT,
  preferred_machine_id TEXT REFERENCES machines(id),
  dependency_manager TEXT,
  node_version TEXT,
  setup_commands TEXT,           -- JSON: ["pnpm install"]
  pre_flight_commands TEXT,      -- JSON: ["pnpm typecheck", "pnpm test"]
  post_flight_commands TEXT,     -- JSON: ["pnpm test"]
  claude_config TEXT,            -- JSON: custom CLAUDE.md or settings overrides
  env_vars TEXT,                 -- JSON: non-secret env vars
  secret_env_refs TEXT,          -- JSON: references to secrets on agent machines
  tags TEXT,                     -- JSON array
  last_synced_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

Auto-detection from repo contents: lockfiles → package manager, `.nvmrc` → node version, `devcontainer.json` → container support.

#### Workspace Management

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  machine_id TEXT NOT NULL REFERENCES machines(id),
  path TEXT NOT NULL,
  branch TEXT NOT NULL,
  is_worktree INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'creating',
    -- creating | preparing | ready | active | stale | cleanup | deleted
  job_id TEXT REFERENCES jobs(id),
  disk_usage_bytes INTEGER,
  deps_installed_at INTEGER,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER
);
```

Cleanup policies: configurable TTL (default 24h), max workspaces per machine, max disk usage.

#### Jobs Table

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  workspace_id TEXT REFERENCES workspaces(id),
  machine_id TEXT REFERENCES machines(id),
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  branch TEXT,
  branch_created TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
    -- pending | provisioning | preparing | running | post_processing | completed | failed | cancelled
  pr_number INTEGER,
  pr_url TEXT,
  github_issue_number INTEGER,
  cost_usd REAL DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  files_changed INTEGER DEFAULT 0,
  tests_passed INTEGER,
  error_message TEXT,
  parent_job_id TEXT REFERENCES jobs(id),
  timeout_seconds INTEGER,
  max_cost_usd REAL,
  auto_pr INTEGER NOT NULL DEFAULT 0,
  auto_cleanup INTEGER NOT NULL DEFAULT 0,
  tags TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Link sessions to jobs
ALTER TABLE sessions ADD COLUMN job_id TEXT REFERENCES jobs(id);
```

#### Pull Request Tracking

```sql
CREATE TABLE pull_requests (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  repo_id TEXT NOT NULL REFERENCES repos(id),
  github_pr_number INTEGER NOT NULL,
  github_pr_url TEXT NOT NULL,
  head_branch TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  review_status TEXT DEFAULT 'pending',
  ci_status TEXT DEFAULT 'unknown',
  additions INTEGER,
  deletions INTEGER,
  changed_files INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

#### Batch Jobs

```typescript
// POST /api/jobs/batch
interface BatchJobRequest {
  repoIds: string[];                    // or repoFilter: { tags: ["lang:typescript"] }
  prompt: string;
  branchPrefix?: string;
  autoPr: boolean;
  maxConcurrency?: number;
  tags?: string[];
}
```

Creates individual jobs per repo, respects concurrency limits, dashboard shows batch progress.

#### Environment Resolver (Agent-Side)

Detects and resolves project environment before launching Claude Code:

| File Present | Language | Install Command | Version Manager |
|-------------|----------|-----------------|-----------------|
| `pnpm-lock.yaml` | Node.js | `pnpm install` | fnm (reads `.nvmrc`) |
| `yarn.lock` | Node.js | `yarn install` | fnm |
| `package-lock.json` | Node.js | `npm install` | fnm |
| `pyproject.toml` | Python | `uv sync` or `pip install` | pyenv |
| `go.mod` | Go | `go mod download` | — |
| `Cargo.toml` | Rust | `cargo fetch` | — |

#### Secrets — Never in the Hub

Secrets are stored as references, resolved on the Agent machine:
- `env:DATABASE_URL` → read from agent's environment
- `file:/home/user/.secrets/api-key` → read from file on agent
- Future: HashiCorp Vault, 1Password CLI

#### New API Routes

```
# Repository Registry
GET    /api/repos                       List repos
POST   /api/repos                       Register repo
POST   /api/repos/import                Import from GitHub URL
GET    /api/repos/:id                   Repo detail
PUT    /api/repos/:id                   Update config
POST   /api/repos/:id/sync             Trigger git fetch
POST   /api/repos/:id/detect           Auto-detect settings

# Jobs
GET    /api/jobs                        List jobs
POST   /api/jobs                        Create job (triggers full workflow)
GET    /api/jobs/:id                    Job detail + sessions + workspace + PR
POST   /api/jobs/:id/retry             Retry failed job
POST   /api/jobs/:id/cancel            Cancel running job
POST   /api/jobs/:id/follow-up         Follow-up on same workspace
POST   /api/jobs/:id/create-pr         Manually trigger PR creation
GET    /api/jobs/:id/diff              Git diff of changes
POST   /api/jobs/batch                  Batch job launcher

# Workspaces
GET    /api/workspaces                  List active workspaces
DELETE /api/workspaces/:id             Cleanup workspace

# Pull Requests
GET    /api/prs                         List PRs across all repos
GET    /api/prs/:id                     PR detail

# GitHub Webhooks
POST   /api/github/webhooks            Receive GitHub events
```

#### New WebSocket Protocol Messages

```typescript
// Hub -> Agent (workspace management)
{ type: "hub:workspace:provision", workspaceId, repoUrl, branch, setupCommands, useWorktree }
{ type: "hub:workspace:cleanup", workspaceId, path }

// Agent -> Hub (workspace status)
{ type: "agent:workspace:cloning", workspaceId, progress }
{ type: "agent:workspace:preparing", workspaceId, step }
{ type: "agent:workspace:ready", workspaceId, path, branch, diskUsageBytes }
{ type: "agent:workspace:error", workspaceId, error, phase }
{ type: "agent:workspace:cleaned", workspaceId }

// Agent -> Hub (git status)
{ type: "agent:git:status", workspaceId, branch, uncommitted, ahead, behind }
{ type: "agent:git:committed", workspaceId, commitHash, message, filesChanged }
{ type: "agent:git:pushed", workspaceId, branch, remote }
```

#### Dashboard — New Views

**Repos Page:** Card list of registered repos with name, sync status, active jobs, quick actions (Launch Job, Sync, Settings, GitHub link).

**Job Launcher Modal:** Repo + prompt + branch + machine + advanced options (auto-PR, pre-flight, cost limit, timeout, GitHub issue link).

**PR Tracker:** Table of all open PRs with repo, status, review state, CI status, creation date.

**Cost Dashboard:** Total spend today/week/month, breakdown by repo and machine, daily timeline chart, budget alerts.

**Batch Launcher:** Multi-select repos (or filter by tag), shared prompt, concurrency control, progress bars per repo.

**Enhanced Overview:** Active jobs (not just sessions), machines, PRs open, cost today, recent activity feed.

## Analysis

### The Execution Backend Spectrum

| Backend | Isolation | Performance | Setup | Best For |
|---------|-----------|-------------|-------|----------|
| Native PTY | OS-level | Best | Minimal | Personal machines, interactive sessions |
| Docker | Excellent | Good (-5%) | Low | Untrusted repos, reproducibility |
| WSL2 | Good | Good | Medium | Windows machines, existing setup |
| Cloud sandbox (E2B/Daytona) | Excellent (microVM) | Good | Very low | Burst capacity, pay-per-use |

**Recommendation:** Start with native PTY (Phase 1-4 existing plan), add Docker as an execution backend in a later phase. The Agent SDK's `spawnClaudeCodeProcess` is the abstraction point — implement different spawn strategies per backend type without changing the rest of the architecture.

### Headless vs. PTY for Workforce

| Scenario | Mode | Rationale |
|----------|------|-----------|
| User watching live | PTY | Full terminal rendering in dashboard |
| Fire-and-forget job | Headless (`-p --output-format stream-json`) | No TTY overhead, structured output |
| Docker container | Headless | No TTY allocation needed |
| Follow-up / resume | PTY or SDK `query()` | Depends on whether user wants to watch |

**Recommendation:** The Job model should support both modes. Default to PTY (consistent with existing architecture, recordings always available). Add headless mode as optimization for queued background jobs.

### What Rivet's Sandbox Agent SDK Means

[Rivet's Sandbox Agent SDK](https://github.com/rivet-dev/sandbox-agent) (January 2026) solves the same "unified agent control API" problem — a universal HTTP/SSE API that works with Claude Code, Codex, OpenCode, and Amp. Worth evaluating as either inspiration or direct dependency. However, building our own gives us tighter integration with the specific Claude Code features (hooks, Agent SDK, teams) and our Tailscale-based private network model.

### Monorepo Strategy

For monorepos: create one job per package/task. Multiple jobs targeting different packages can use separate worktrees (same repo, different branches, full isolation). Each worktree gets its own `node_modules` but shares the `.git` object store.

## Recommendations

1. **Implement the Job abstraction as the new core user-facing unit.** Sessions remain the low-level primitive; Jobs compose on top. Backward compatible — users can still start raw sessions.

2. **Add the Repository Registry to Phase 5.** This is the foundation for "spawn agent against any codebase" — without knowing what repos exist and how to set them up, every job launch requires manual configuration.

3. **Use git worktrees for all parallel agent work.** Never clone the same repo twice on one machine. Worktrees share `.git` objects, and pnpm's content-addressable store deduplicates `node_modules`.

4. **Authenticate with GitHub via a GitHub App.** Not tied to a user, short-lived tokens, granular permissions, higher rate limits. `@octokit/auth-app` handles token lifecycle automatically.

5. **Auto-detect repo configuration but allow overrides.** On first import, scan for lockfiles, version files, devcontainer.json. Store detected values in repo registry. User can override anything.

6. **Use the Agent SDK's `spawnClaudeCodeProcess` as the execution backend abstraction.** This single interface supports Docker, SSH, WSL2, and local processes. Don't build separate integration paths.

7. **Never store secrets in the Hub.** Use references (`env:VAR_NAME`, `file:/path/to/secret`) resolved on the Agent machine.

8. **Make auto-PR generation the default for completed jobs.** The PR body should include: original prompt, change summary, test results, cost, duration, link to session recording.

9. **Use GitHub Checks API to report agent status on PRs.** Visible to reviewers, integrates with branch protection rules.

10. **Plan batch operations as a first-class feature.** "Run this across all my repos" is a core workflow for dependency updates, security patches, and documentation generation.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Feature creep from workforce vision | High | Strict phasing — repo registry + jobs first, GitHub integration second, Docker/batch third |
| Git worktree cleanup failures leaving orphaned directories | Medium | Periodic `git worktree prune`, workspace status tracking, disk usage monitoring |
| Docker adds operational complexity | Medium | Defer Docker to later phase; native PTY works for personal use |
| GitHub App setup complexity for users | Medium | Provide setup wizard in dashboard; also support PAT as simpler fallback |
| Agent SDK `spawnClaudeCodeProcess` may have undocumented limitations | Medium | Prototype early with Docker spawn; fall back to CLI if SDK doesn't work |
| Cost runaway with batch jobs across many repos | High | `max_cost_usd` per job, per-machine daily budget, global budget (from previous research) |
| Race conditions with multiple agents on same repo | Medium | Git worktrees provide isolation; rebase before PR; conflict detection |
| WSL2 per-distro resource limits not available | Low | Use a single WSL2 instance per Windows machine; Docker inside WSL2 for isolation |
| Claude Code `.env` auto-loading exposing secrets | Medium | Agent strips `.env` from workspace or sets `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` |

## Sources

### Claude Code CLI & SDK
- [CLI Reference](https://code.claude.com/docs/en/cli-reference) — complete flag reference
- [Headless Mode](https://code.claude.com/docs/en/headless) — programmatic usage
- [Agent SDK TypeScript](https://platform.claude.com/docs/en/agent-sdk/typescript) — full API
- [Agent SDK V2 Preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview) — session-based API
- [Agent SDK Hosting](https://platform.claude.com/docs/en/agent-sdk/hosting) — deployment patterns
- [Hooks Reference](https://code.claude.com/docs/en/hooks) — all 21+ hook events
- [Agent Teams](https://code.claude.com/docs/en/agent-teams) — parallel coordination
- [Remote Control](https://code.claude.com/docs/en/remote-control) — multi-session server mode
- [MCP Integration](https://code.claude.com/docs/en/mcp) — custom tool servers
- [Settings](https://code.claude.com/docs/en/settings) — configuration hierarchy
- [Environment Variables Gist](https://gist.github.com/unkn0wncode/f87295d055dd0f0e8082358a0b5cc467) — 200+ env vars

### Docker
- [Official Docker Image](https://github.com/anthropics/claude-code/tree/main/.devcontainer)
- [DevContainer Features](https://github.com/anthropics/devcontainer-features)
- [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/agents/claude-code/)
- [claudebox](https://github.com/RchGrav/claudebox) — per-project isolation
- [claude-agent-server](https://github.com/dzhng/claude-agent-server) — WebSocket-controlled Docker
- [Sandboxing Docs](https://code.claude.com/docs/en/sandboxing)
- [DataCamp Docker Tutorial](https://www.datacamp.com/tutorial/claude-code-docker)

### WSL2
- [WSL2 Advanced Config](https://learn.microsoft.com/en-us/windows/wsl/wsl-config) — .wslconfig
- [WSL2 Networking](https://learn.microsoft.com/en-us/windows/wsl/networking) — mirrored mode
- [Tailscale WSL2](https://tailscale.com/docs/install/windows/wsl2) — run on Windows host
- [WSL2 Custom Distro Import](https://learn.microsoft.com/en-us/windows/wsl/use-custom-distro)
- [WSL2 Start on Boot](https://www.cod3r.com/2025/05/wsl2-start-on-boot/)
- [Per-Distro Limits Issue](https://github.com/microsoft/WSL/issues/8570)

### Git & GitHub
- [simple-git](https://github.com/steveukx/git-js) — Node.js git library
- [Octokit REST.js](https://octokit.github.io/rest.js/) — GitHub API SDK
- [@octokit/auth-app](https://github.com/octokit/auth-app.js/) — GitHub App auth
- [@octokit/webhooks](https://github.com/octokit/webhooks.js/) — webhook handling
- [nypm](https://github.com/unjs/nypm) — package manager detection
- [Git Worktrees + Claude Code](https://medium.com/@dtunai/mastering-git-worktrees-with-claude-code-for-parallel-development-workflow-41dc91e645fe)
- [Partial Clone & Shallow Clone](https://github.blog/open-source/git/get-up-to-speed-with-partial-clone-and-shallow-clone/)
- [@git-diff-view/vue](https://github.com/MrWangJustToDo/git-diff-view) — diff viewer component
- [chokidar](https://github.com/paulmillr/chokidar) — filesystem watching
- [GitHub Checks API](https://docs.github.com/en/rest/checks)
- [GitHub Apps vs PATs](https://michaelkasingye.medium.com/github-authentication-personal-access-tokens-vs-github-apps-0f8fba446fbd)

### Other
- [Rivet Sandbox Agent SDK](https://github.com/rivet-dev/sandbox-agent) — universal agent control API
- [Daytona Claude SDK Guide](https://www.daytona.io/docs/en/guides/claude/claude-agent-sdk-interactive-terminal-sandbox/)
- [Cloudflare Sandbox Tutorial](https://developers.cloudflare.com/sandbox/tutorials/claude-code/)
- [Cockpit Project](https://cockpit-project.org/) — web-based Linux management
- [Multi-Agent Orchestration (DEV)](https://dev.to/bredmond1019/multi-agent-orchestration-running-10-claude-instances-in-parallel-part-3-29da)

## Appendix

### Implementation Phases (Extended)

**Phase 5: Workforce Foundation** (builds on existing Phases 1-4)
- Shared: repo, workspace, job, PR type definitions + Zod schemas
- Hub: Repo registry CRUD + SQLite tables
- Hub: Job model + state machine + API routes
- Hub: Workspace management (create, track, cleanup)
- Agent: Workspace provisioner (clone, worktree, setup)
- Agent: Environment resolver (detect package manager, node version)
- Dashboard: Repos page, Job launcher modal
- Protocol: workspace and job WebSocket messages

**Phase 6: GitHub Integration**
- Hub: GitHub client (Octokit + multi-auth)
- Hub: PR creation from job completion
- Hub: GitHub webhook receiver
- Hub: Issue linking
- Dashboard: PR tracker page, job detail with PR status
- Repo import from GitHub URL

**Phase 7: Workforce Intelligence**
- Auto-scheduling (machine selection algorithm)
- Batch job launcher (multi-repo)
- Cost tracking and budget controls
- Pre-flight and post-flight check system
- Job groups (sequential/parallel cross-repo jobs)
- Dashboard: Batch launcher, Cost dashboard

**Phase 8: Advanced Isolation**
- Docker execution mode in Agent via `spawnClaudeCodeProcess`
- Devcontainer support
- Secret management (env/file/vault references)
- Workspace disk management and cleanup cron
- Cloud sandbox integration (E2B/Daytona/Cloudflare)

### Recommended Package Additions

| Package | Purpose | Component |
|---------|---------|-----------|
| `simple-git` | Git operations (clone, branch, status, commit, push) | Agent |
| `octokit` | GitHub API (PRs, issues, checks, webhooks) | Hub |
| `@octokit/auth-app` | GitHub App authentication | Hub |
| `@octokit/webhooks` | GitHub webhook handling + signature verification | Hub |
| `nypm` | Package manager auto-detection | Agent |
| `chokidar` | Filesystem watching for git status updates | Agent |
| `@git-diff-view/vue` | GitHub-style diff viewer | Dashboard |
| `fnm` | Node.js version management (system tool, not npm) | Agent machines |
