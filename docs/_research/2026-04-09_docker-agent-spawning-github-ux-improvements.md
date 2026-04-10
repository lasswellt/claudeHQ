---
title: 'Docker Agent Spawning, GitHub UX Mapping & Implementation Improvements'
date: 2026-04-09
tags: [docker, agents, spawning, github, dashboard, ux, deployment, readme, improvements]
status: complete
related:
  [
    container-orchestration-sandboxed-autonomy,
    github-docker-costs-rivet,
    self-hosted-docker-deployment,
  ]
packages: [hub, agent, dashboard, shared]
---

# Docker Agent Spawning, GitHub UX Mapping & Implementation Improvements

## Summary

Claude HQ's Docker agent spawning infrastructure is functional but incompletely surfaced. The Hub's `ContainerOrchestrator` can create/start/stop Docker containers with git worktree isolation, but the dashboard has no UI for it and several wiring gaps exist (no container log streaming, hardcoded URLs in PR bodies, GitHub Checks lifecycle implemented but not connected to job completion). The README's Docker section is solid for the Hub itself but doesn't document the Hub-managed agent spawning flow. Five categories of improvements are identified: Docker wrapping polish, README updates, method fixes, WebUI→GitHub mapping, and agent spawn UX.

## Research Questions

1. What is the current state of Docker wrapping and what needs to change for Hub-spawned agents to work end-to-end?
2. What README deployment documentation needs updating to reflect the current Docker architecture?
3. What method-level improvements exist in the hub and agent code?
4. How should the dashboard map to GitHub operations (PR lifecycle, Checks, webhooks)?
5. What's needed for end-to-end Docker agent spawning from the dashboard?

## Findings

### 1. Docker Wrapping — Current State & Gaps

**What exists and works (both Hub-side and Agent-side):**

| Component                     | Status      | Location                                                                                                                                |
| ----------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile.hub`              | Complete    | Multi-stage, hub+dashboard combined, ~250MB image                                                                                       |
| `Dockerfile.agent`            | Complete    | Separate image for agent, multi-stage                                                                                                   |
| `docker-compose.yml`          | Functional  | Hub service with Docker socket mount, chq-internal network                                                                              |
| `ContainerOrchestrator` (Hub) | Implemented | `hub/src/container-orchestrator.ts` — dockerode, bare clone, worktree, container lifecycle                                              |
| `ContainerPool` (Agent)       | Implemented | `agent/src/container-pool.ts` — Docker lifecycle, events, capacity management, security validation                                      |
| `createDockerExecSpawn`       | Implemented | `agent/src/spawn-docker.ts` — Routes into pre-running container via `docker exec`                                                       |
| `createDockerRunSpawn`        | Implemented | `agent/src/spawn-docker.ts` — Ephemeral per-session containers via `docker run --rm`                                                    |
| `runSetupPipeline`            | Implemented | `agent/src/container-setup.ts` — Allowlisted setup commands in temp container                                                           |
| Container security config     | Implemented | `agent/src/container-security.ts` — Hardened defaults, immutable cap-drop/securityOpt                                                   |
| Container worktree mgmt       | Implemented | `agent/src/container-worktree.ts` — Per-container git worktree isolation                                                                |
| Agent REST routes             | Wired       | `POST /api/agents/spawn`, `GET /api/agents`, `POST /api/agents/:id/stop`, `DELETE /api/agents/:id`                                      |
| Hub config schema             | Complete    | `agentImage`, `dockerSocketPath`, `agentNetworkName`, `claudeBinaryHostPath`, `reposPath`, `agentDefaultMemoryMb`, `agentMaxContainers` |
| Agent→Hub WS reconnect        | Wired       | Spawned agent uses machineId=UUID, Hub's `agentHandler.setOrchestrator()` marks running/stopped                                         |
| Reconciliation                | Basic       | On Hub restart, reconciles active records with Docker container state                                                                   |
| WS protocol schemas           | Defined     | `shared/src/workforce.ts` — Full Zod schemas for `hub:container:*` and `agent:container:*` messages                                     |

**Gaps identified:**

1. **No container stdout/stderr streaming to dashboard.** The orchestrator creates containers but doesn't attach to their output streams. Agent containers connect back via WebSocket and then relay terminal data, but there's no direct container log pipe for the pre-connection bootstrap phase.

2. **No `displayName` persistence.** `SpawnOptions.displayName` is accepted but never stored in the `spawned_agents` table — the column doesn't exist.

3. **No `agentMaxContainers` enforcement.** The config field exists but `spawn()` never checks the current container count before creating a new one.

4. **Docker Compose doesn't declare `chq-repos` volume mount path.** The `chq-repos:/data/repos` volume is declared but the Hub container's `reposPath` defaults to `/data/repos` — these are aligned, but the bind path for worktrees needs the Docker socket AND the repo volume to share the same path namespace between Hub and spawned agent containers (both see `/data/repos` as the same filesystem).

5. **Claude binary bind-mount requires host path.** `CHQ_HUB_CLAUDE_BINARY_HOST_PATH` must point to the host's `claude` binary. If the agent image (`chq-agent:local`) already has Claude Code installed (e.g., via npm), this is unnecessary. If using `ghcr.io/anthropics/claude-code:latest`, the binary is inside the image. The config should document which scenario applies.

6. **No dead container cleanup cron.** Containers that exit but aren't removed stay in Docker. `reconcile()` marks them as stopped but doesn't remove them.

7. **Container protocol handlers NOT wired.** The Zod schemas for `hub:container:create`, `hub:container:stop`, `hub:container:remove` (Hub→Agent) and `agent:container:created`, `agent:container:started`, `agent:container:stdout`, `agent:container:exited`, `agent:container:stats`, `agent:container:error` (Agent→Hub) are fully defined in `shared/src/workforce.ts` and included in the protocol union — but **no handlers exist** in `daemon.ts` or `agent-handler.ts`. Job routes still use `hub:session:start` instead of `hub:container:create` (documented TODO at `jobs.ts:110`).

8. **SDK renamed.** The Claude Code SDK was renamed to **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`). The old `@anthropic-ai/claude-code` package still works but the new one no longer inherits Claude Code's system prompt. If the agent package uses the old SDK name, it should be migrated.

9. **Claude Managed Agents launched April 8, 2026.** Anthropic now offers cloud-hosted agent execution via `POST /v1/sessions`. Pricing: standard token rates + $0.08/session-hour. This is a potential alternative to self-hosted Docker spawning for users who don't need deep container customization. Claude HQ could offer both: self-hosted Docker containers AND Managed Agents as execution backends.

### 2. README Deployment Documentation — Needed Updates

**Current README Docker section is good but incomplete.** Key gaps:

1. **Agent spawning not documented.** The README explains Hub deployment and connecting a bare-metal agent, but doesn't mention that the Hub can spawn agent containers directly. The `POST /api/agents/spawn` API, Docker socket mount, and `CHQ_HUB_AGENT_IMAGE` config are all undocumented.

2. **`.env.example` diverged.** The committed `.env.example` has 4 vars:

   ```
   CHQ_HUB_PORT, CHQ_HUB_LOGLEVEL, ANTHROPIC_API_KEY, CHQ_HUB_CLAUDE_BINARY_HOST_PATH, TS_AUTHKEY
   ```

   But the docker-compose.yml references additional env vars: `CHQ_HUB_AGENT_IMAGE`, `CHQ_HUB_AGENT_NETWORK_NAME`. These should be documented.

3. **`docker-compose.yml` has `chq-repos` volume** but the README's Docker section doesn't mention it or explain what it's for (git bare clones + worktrees for spawned agents).

4. **Health endpoint version is hardcoded** to `0.1.0` in the README example output. The actual `GET /health` response is dynamic.

5. **API Reference section** doesn't list the agent spawn endpoints (`/api/agents/*`).

6. **Architecture diagram** doesn't show the Hub→Docker→Agent container flow.

**Recommended additions:**

- "Spawning Agents from the Hub" section explaining Docker-managed agent containers
- Updated architecture diagram showing Hub as orchestrator
- `docker-compose.yml` annotated explanation (Docker socket, repos volume, network)
- Agent spawn API reference

### 3. Method-Level Improvements

#### 3a. ContainerOrchestrator

| Issue                                     | File:Line                           | Fix                                                                                                             |
| ----------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `displayName` ignored                     | `container-orchestrator.ts:121`     | Add `display_name` column to `spawned_agents` table, store and return it                                        |
| No container count limit                  | `container-orchestrator.ts:122`     | Check active container count against `config.agentMaxContainers` before spawning                                |
| No cleanup of exited containers           | `container-orchestrator.ts:372-412` | Add periodic sweep that calls `container.remove()` for stopped agents older than N hours                        |
| Bare clone uses `execFileSync` (blocking) | `container-orchestrator.ts:333`     | For large repos, this blocks the event loop. Consider `execFile` (async) with promise wrapper                   |
| Hub URL hardcoded to `ws://hub:${port}`   | `container-orchestrator.ts:143`     | Works only when agent containers share the Hub's Docker network. Document this requirement or make configurable |
| No container resource stats               | N/A                                 | Add periodic `container.stats()` calls to report CPU/memory to dashboard                                        |

#### 3b. GitHub Routes

| Issue                                         | File:Line                          | Fix                                                                                                                                                                                                                                 |
| --------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR body has hardcoded `http://localhost:3000` | `github.ts:168`                    | Use the Hub's actual URL or make configurable via `HubConfig`                                                                                                                                                                       |
| Checks lifecycle not wired to jobs            | `checks-lifecycle.ts` (standalone) | Connect `createChecksLifecycle` to job start/complete events in `job-routes.ts`                                                                                                                                                     |
| No GitHub App callback endpoint               | `github.ts:102`                    | Manifest flow `redirect_url` points to `/api/github/callback` but no handler exists — the wizard does a client-side POST to `/api/github/app` instead. Either add the callback route or update the manifest `redirect_url` to match |
| Manifest `redirect_url` should be SPA route   | `github.ts:109`                    | `redirect_url` points to `/api/github/callback` but should point to the SPA wizard page (`/settings/github/wizard`) so the SPA can capture `?code=` and exchange it. Same for `setup_url` → `/settings/github/wizard?step=install`  |
| No GitHub repo browser endpoint               | N/A                                | Add `GET /api/github/repos` using `octokit.rest.apps.listReposAccessibleToInstallation()` for better import UX than URL paste                                                                                                       |
| No webhook → poll hybrid                      | N/A                                | Add a background poller (every 15min) as consistency reconciler for missed webhook deliveries during GitHub outages or Funnel downtime                                                                                              |
| Webhook raw body may be undefined             | `github.ts:204`                    | `rawBody` cast could fail if content parser order changes. Add explicit check earlier                                                                                                                                               |
| Auto-PR not wired to session completion       | `jobs.ts:110-118`                  | When session ends with exit code 0 and job has `auto_pr: true`, should auto-create PR + Check Run. Pieces exist but aren't connected                                                                                                |

#### 3c. Server Wiring

| Issue                                              | File:Line      | Fix                                                                                                                  |
| -------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| Rate limit of 100/min is low for dashboard polling | `server.ts:82` | Consider exempting `/ws/*` or raising for authenticated clients                                                      |
| No CORS configuration                              | `server.ts`    | If dashboard ever runs on a different origin, CORS headers are needed. Currently same-origin so OK, but worth noting |

### 4. WebUI → GitHub Mapping

**Current mapping:**

| Dashboard Page           | GitHub API                                                       | Status                                         |
| ------------------------ | ---------------------------------------------------------------- | ---------------------------------------------- |
| Settings > GitHub wizard | Manifest flow → `/api/github/app`, `/api/github/installation`    | Implemented (7-step wizard)                    |
| Settings > GitHub        | `/api/github/status`, `/api/github/pat`                          | Implemented                                    |
| PRs page (`/prs`)        | `GET /api/prs` (local DB)                                        | Implemented (reads from `pull_requests` table) |
| Job detail → Create PR   | `POST /api/jobs/:id/create-pr` → Octokit `pulls.create`          | Implemented                                    |
| Job detail → Link Issue  | `POST /api/jobs/:id/link-issue` → Octokit `issues.createComment` | Implemented                                    |
| Webhook → PR status      | `POST /hooks/github` → update `pull_requests` table              | Implemented (merge, close, CI, review)         |

**Missing mappings:**

| Dashboard Need            | GitHub API                      | Gap                                                              |
| ------------------------- | ------------------------------- | ---------------------------------------------------------------- |
| Check Run on job start    | `checks.create` (in_progress)   | `ChecksLifecycle` exists but not wired to job start              |
| Check Run on job complete | `checks.update` (completed)     | `ChecksLifecycle.finish()` exists but not called                 |
| Real-time PR status push  | Webhook → WS broadcast          | Webhook handler updates DB but doesn't broadcast to dashboard WS |
| Issue list from GitHub    | `issues.listForRepo`            | Not implemented — dashboard only shows linked issues             |
| Repo branch list          | `repos.listBranches`            | Not implemented — dashboard repos page doesn't fetch branches    |
| Commit status badges      | `repos.getCombinedStatusForRef` | Not implemented                                                  |

**Recommended wiring for Check Runs:**

```typescript
// In job routes, when a job starts and has a repo with GitHub configured:
const { checkRunId } = await checksLifecycle.start({
  owner,
  repo,
  headSha,
  name: `Claude HQ: ${job.title}`,
  detailsUrl: `${hubUrl}/jobs/${job.id}`,
  externalId: job.id,
});
// Store checkRunId on the job record

// When job completes:
await checksLifecycle.finish({
  checkRunId,
  owner,
  repo,
  conclusion: jobStatusToConclusion(job.status),
  summary: `${job.files_changed} files changed, $${job.cost_usd.toFixed(2)} spent`,
  title: job.title,
});
```

**Webhook → Dashboard broadcast:**

Currently the webhook handler at `POST /hooks/github` updates the database but doesn't push to connected dashboards. The fix is straightforward — after each DB update, call `broadcastToDashboard()`:

```typescript
// After setPrMergedStmt.run(prNumber):
broadcastToDashboard({ type: 'pr:updated', prNumber, status: 'merged' });
```

This requires the webhook handler to have access to the broadcast function. Pass it as a parameter to `githubRoutes()`.

### 5. Docker Agent Spawning — End-to-End

**Current flow (API-only, no dashboard UI):**

```
POST /api/agents/spawn { repoUrl, branch }
  → ContainerOrchestrator.spawn()
    → git clone --bare (if needed) / git fetch
    → git worktree add (detached at origin/branch)
    → docker.createContainer({ image: chq-agent:local, binds: [worktree:/workspace] })
    → container.start()
    → Agent inside container connects back to Hub via WS
    → Hub marks agent as "running"
```

**What's missing for full end-to-end:**

1. **Dashboard UI for spawning agents.** No page exists. The `/workspaces` page is a placeholder. Need:
   - Agent list page showing spawned agents with status (creating/running/stopped/error)
   - "Spawn Agent" dialog: pick repo, branch, optional display name
   - Per-agent controls: stop, remove, view logs
   - Container resource usage display (CPU, memory)

2. **Container log streaming.** When a container is starting up (before the agent process connects via WS), there's no way to see what's happening. Need `container.attach()` → stream to dashboard.

3. **Agent image selection.** Currently uses `config.agentImage` globally. Should support per-spawn image override for different repos that need different toolchains.

4. **Setup commands.** After worktree creation but before starting the agent, repos may need `npm install`, `pip install`, etc. The orchestrator doesn't run setup commands. Could be:
   - A `setupCommands` field on the repo record
   - A temporary "setup container" that runs before the agent container

5. **Branch creation.** Currently spawns on an existing branch (detached HEAD at `origin/branch`). For new work, should create a new branch (`chq/job-{id}/{slug}`) — the detached HEAD approach means agent commits won't have a branch ref.

## Analysis

### Docker Architecture Is Sound, Needs Surface Area

The core Docker infrastructure is well-designed: dockerode for API access, bare clones with worktrees for branch isolation, security options (cap-drop, no-new-privileges, PID limits). The main gap is surface area — no dashboard UI, no container log streaming, no cleanup automation. These are UI/UX issues, not architectural ones.

### GitHub Integration Is Deep but Disconnected

The GitHub client, webhook handler, checks lifecycle, and PR management are all individually solid. The problem is they're not fully connected: checks lifecycle isn't wired to jobs, webhook events don't broadcast to dashboard, PR body has a hardcoded localhost URL. These are wiring fixes, not rewrites.

### README Reflects v1.0 But Docker Agent Spawning Is v1.1

The README was written for the initial release where agents run bare-metal and connect to a Dockerized Hub. The Hub-managed Docker agent spawning is a significant new capability that needs its own README section and updated architecture diagram.

### Container Protocol Is Schema-Complete but Handler-Absent

The full container message protocol exists in `shared/src/workforce.ts` with proper Zod schemas and is included in the protocol union. The agent package has `ContainerPool`, `createDockerExecSpawn`, `createDockerRunSpawn`, `runSetupPipeline`, and `container-security.ts` — all implemented and exported. But `daemon.ts` doesn't handle `hub:container:create` messages and `agent-handler.ts` doesn't process `agent:container:*` messages. The job routes have a TODO noting this gap. Wiring these handlers is the key enabler for the full Docker execution path.

### Claude Managed Agents: A Complementary Execution Backend

Anthropic's Managed Agents (launched April 8, 2026) offer cloud-hosted agent execution at $0.08/session-hour + standard token rates. For users who don't need deep container customization or on-premise execution, this could be a simpler alternative. Claude HQ could offer both backends: `executionMode: 'docker' | 'managed-agent' | 'pty'` — docker for self-hosted sandboxed autonomy, managed-agent for cloud-hosted simplicity, pty for interactive terminal sessions.

### Improvement Priority

| Priority | Category                                                        | Effort   | Impact                                         |
| -------- | --------------------------------------------------------------- | -------- | ---------------------------------------------- |
| 1        | Wire container protocol handlers (daemon.ts + agent-handler.ts) | Medium   | Critical (enables Docker execution path)       |
| 2        | Wire checks lifecycle to job routes                             | Small    | High (GitHub status reporting)                 |
| 3        | Fix hardcoded localhost in PR body                              | Tiny     | Medium (broken links in PRs)                   |
| 4        | Fix manifest redirect_url to SPA route                          | Tiny     | Medium (GitHub App setup broken on some flows) |
| 5        | Add webhook → dashboard broadcast                               | Small    | High (real-time PR status)                     |
| 6        | Enforce agentMaxContainers                                      | Tiny     | Medium (runaway prevention)                    |
| 7        | Dashboard agent spawn UI                                        | Medium   | High (enables non-API users)                   |
| 8        | Add GitHub repo browser endpoint                                | Small    | Medium (better import UX)                      |
| 9        | Container log streaming                                         | Medium   | Medium (debugging agent startup)               |
| 10       | README agent spawning section                                   | Small    | Medium (documentation)                         |
| 11       | Migrate to @anthropic-ai/claude-agent-sdk                       | Small    | Low (future-proofing)                          |
| 12       | Dead container cleanup cron                                     | Small    | Low (resource hygiene)                         |
| 13       | Evaluate Managed Agents as execution backend                    | Research | Medium (architecture option)                   |

## Recommendations

1. **Wire container protocol handlers.** Add `hub:container:create/stop/remove` handling in `daemon.ts` and `agent:container:*` handling in `agent-handler.ts`. Replace the `hub:session:start` workaround in `jobs.ts:110` with `hub:container:create`. This is the gating item for the full Docker execution path.

2. **Wire `ChecksLifecycle` into the job route handlers.** Call `start()` when a job begins on a GitHub-connected repo, `finish()` when it completes. Store `check_run_id` on the job record. Makes Claude HQ visible in GitHub PR pages.

3. **Replace hardcoded `http://localhost:3000` in PR body** (`github.ts:168`) with a configurable Hub URL from `HubConfig` or derived from the GitHub App's configured URL.

4. **Fix manifest `redirect_url` and `setup_url`** to point to SPA routes (`/settings/github/wizard` and `/settings/github/wizard?step=install`) instead of API endpoints. The SPA already handles `?code=` params on mount — just needs the right redirect target.

5. **Add dashboard broadcast to webhook handler.** Pass `broadcastToDashboard` to `githubRoutes()` and emit `pr:updated` events after each webhook-driven DB update. Add `pr:updated`, `repo:updated`, `job:updated` message types to `protocol.ts`.

6. **Add `GET /api/github/repos` endpoint** using `octokit.rest.apps.listReposAccessibleToInstallation()` to provide a searchable repo browser in the dashboard, replacing URL-paste import.

7. **Enforce `agentMaxContainers` in `ContainerOrchestrator.spawn()`.** Count active containers before creating. Return 429 if at limit.

8. **Build a dashboard Agents page** at `/agents` with spawned agent list, spawn dialog, stop/remove controls, and session links.

9. **Add container log streaming** during agent bootstrap via `container.attach()` → WebSocket relay to dashboard.

10. **Update README** with Hub-managed agent spawning section, updated architecture diagram, agent spawn API reference, and annotated docker-compose.yml.

11. **Migrate to `@anthropic-ai/claude-agent-sdk`** — the old `@anthropic-ai/claude-code` package still works but the new SDK no longer inherits Claude Code's system prompt, giving cleaner control.

12. **Evaluate Claude Managed Agents** as an optional execution backend alongside Docker. Could offer `executionMode: 'docker' | 'managed-agent' | 'pty'` in config. The $0.08/session-hour pricing makes it viable for users who don't need on-premise execution.

13. **Add dead container cleanup** as a periodic sweep (every 30min) and a webhook+poll hybrid for GitHub state consistency.

## Risks

| Risk                                                        | Severity | Mitigation                                                                                               |
| ----------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| Docker socket in Hub container = root equivalent            | High     | Document: only mount Docker socket if agent spawning is needed; use rootless Docker for defense-in-depth |
| Bare clone `execFileSync` blocks event loop for large repos | Medium   | Convert to async `execFile` with promise wrapper; add timeout                                            |
| Worktree disk accumulation                                  | Medium   | Dead container cleanup should also prune orphan worktrees; add disk usage monitoring                     |
| Agent image not pre-pulled → slow first spawn               | Low      | `prePullImage()` already runs on init; log warning if it fails                                           |
| Hub URL assumption (`ws://hub:port`)                        | Medium   | Make configurable or auto-detect from Docker network inspect                                             |

## Sources

### Codebase Files (Primary)

- `packages/hub/src/container-orchestrator.ts` — Hub-side Docker agent spawning
- `packages/agent/src/container-pool.ts` — Agent-side Docker container lifecycle management
- `packages/agent/src/spawn-docker.ts` — `createDockerExecSpawn` and `createDockerRunSpawn` adapters
- `packages/agent/src/container-setup.ts` — Setup pipeline with allowlisted commands
- `packages/agent/src/container-security.ts` — Hardened container security defaults
- `packages/agent/src/container-worktree.ts` — Per-container git worktree management
- `packages/shared/src/workforce.ts` — Zod schemas for container protocol messages
- `packages/hub/src/routes/agents.ts` — Agent spawn REST API
- `packages/hub/src/routes/github.ts` — GitHub routes including PR creation and webhooks
- `packages/hub/src/routes/jobs.ts` — Job routes (TODO at line 110 for container wiring)
- `packages/hub/src/github/client.ts` — Octokit-based GitHub client
- `packages/hub/src/github/checks-lifecycle.ts` — GitHub Checks API lifecycle wrapper
- `packages/hub/src/github/manifest-flow.ts` — GitHub App manifest builder + code exchange
- `packages/hub/src/github/pr-body.ts` — PR body markdown renderer
- `packages/hub/src/github/pat-poller.ts` — Poll scheduler for PAT fallback mode
- `packages/hub/src/server.ts` — Hub server wiring
- `packages/shared/src/config.ts` — Hub and Agent config schemas
- `packages/hub/src/migrations/010_spawned_agents.sql` — Spawned agents table schema
- `Dockerfile.hub`, `Dockerfile.agent` — Docker build files
- `docker-compose.yml` — Compose configuration
- `packages/dashboard/app/pages/settings/github/wizard.vue` — GitHub setup wizard

### External Sources

- [Claude Agent SDK Hosting Guide](https://code.claude.com/docs/en/agent-sdk/hosting) — Official hosting patterns (ephemeral, long-running, hybrid)
- [Claude Agent SDK Secure Deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment) — Docker hardening guide
- [Claude Agent SDK Migration Guide](https://platform.claude.com/docs/en/agent-sdk/migration-guide) — Rename from Claude Code SDK
- [Claude Managed Agents Overview](https://platform.claude.com/docs/en/managed-agents/overview) — Cloud-hosted agents (launched 2026-04-08)
- [Claude Code Sandboxing](https://code.claude.com/docs/en/sandboxing) — Sandbox runtime docs
- [Docker Sandboxes for Claude Code](https://docs.docker.com/ai/sandboxes/agents/claude-code/) — Docker Desktop microVM sandboxes
- [ghcr.io/anthropics/claude-code](https://github.com/anthropics/claude-code/pkgs/container/claude-code) — Official Claude Code Docker image
- [cabinlab/claude-code-sdk-docker](https://github.com/cabinlab/claude-code-sdk-docker) — Pre-configured Agent SDK Docker images
- [receipting/claude-agent-sdk-container](https://github.com/receipting/claude-agent-sdk-container) — REST API + web CLI container
- [ComposioHQ/agent-orchestrator](https://github.com/ComposioHQ/agent-orchestrator) — Multi-agent orchestrator (Claude, Codex, Aider)
- [@anthropic-ai/sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime) — Open-source OS-level sandboxing

### Prior Research

- `docs/_research/2026-03-16_container-orchestration-sandboxed-autonomy.md` — Container orchestration design
- `docs/_research/2026-03-15_github-docker-costs-rivet.md` — Docker spawn and GitHub App implementation research
- `docs/_research/2026-03-15_self-hosted-docker-deployment.md` — Docker deployment architecture

## Appendix

### Spawned Agents Table Schema

```sql
CREATE TABLE spawned_agents (
  id TEXT PRIMARY KEY,
  container_id TEXT,
  repo_id TEXT REFERENCES repos(id),
  repo_url TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  worktree_path TEXT,
  status TEXT NOT NULL DEFAULT 'creating',
  error_message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at INTEGER,
  stopped_at INTEGER
);
-- Missing: display_name, check_run_id
```

### Suggested Schema Migration (011)

```sql
ALTER TABLE spawned_agents ADD COLUMN display_name TEXT;
ALTER TABLE spawned_agents ADD COLUMN check_run_id INTEGER;
ALTER TABLE jobs ADD COLUMN check_run_id INTEGER;
```

### Agent Spawn API Reference

```
POST   /api/agents/spawn       Spawn new agent container
  Body: { repoUrl: string, repoId?: string, branch?: string, displayName?: string }
  Returns: SpawnedAgentRecord (201)

GET    /api/agents              List spawned agents
  Query: ?status=running|stopped|error|creating
  Returns: SpawnedAgentRecord[]

GET    /api/agents/:id          Get single agent
  Returns: SpawnedAgentRecord (200) | { error } (404)

POST   /api/agents/:id/stop     Stop agent container
  Returns: { ok: true } (200)

DELETE /api/agents/:id           Stop, remove container, clean up worktree
  Returns: { ok: true } (200)
```

### Docker Compose — Annotated

```yaml
services:
  hub:
    build: { context: ., dockerfile: Dockerfile.hub }
    ports:
      - '${CHQ_HUB_PORT:-7700}:7700'
    environment:
      - CHQ_HUB_AGENT_IMAGE=chq-agent:local # Image for spawned agent containers
      - CHQ_HUB_AGENT_NETWORK_NAME=chq-internal # Network agents join
      # ... other env vars
    volumes:
      - ./data/db:/app/data/db # SQLite + WAL files
      - ./data/recordings:/app/data/recordings # Session JSONL recordings
      - /var/run/docker.sock:/var/run/docker.sock # Required for agent spawning
      - chq-repos:/data/repos # Bare clones + worktrees for spawned agents
    networks:
      - chq-internal # Shared with spawned agent containers

networks:
  chq-internal:
    driver: bridge # Agents connect to Hub via ws://hub:7700/ws/agent

volumes:
  chq-repos: # Persistent storage for git repos and worktrees
```
