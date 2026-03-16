---
title: "Container Orchestration with Sandboxed Autonomy: Hub-Managed Docker for Claude Code"
date: 2026-03-16
tags: [docker, orchestration, containers, sandbox, security, autonomy, volumes, worktrees]
status: complete
related: [self-hosted-docker-deployment, github-docker-costs-rivet, workforce-management-platform]
packages: [hub, agent, shared]
---

# Container Orchestration with Sandboxed Autonomy: Hub-Managed Docker for Claude Code

## Summary

The Hub should manage ephemeral Docker containers for Claude Code execution via an **Orchestration Agent** daemon on each machine. Each machine clones repos to a shared volume (`/data/repos/{repo-id}/`) and creates git worktrees per container to enable branch-level isolation. Containers run `ghcr.io/anthropics/claude-code:latest` with `--dangerously-skip-permissions` safely because the container IS the sandbox — no Docker socket, no host network, dropped capabilities, read-only rootfs, memory/CPU/PID limits. The Orchestration Agent uses `dockerode` (Node.js Docker API client) to create/start/stop/remove containers and stream stdout back to the Hub via WebSocket.

## Research Questions

1. How should the Hub orchestrate Docker container lifecycle via the Orchestration Agent?
2. What makes `--dangerously-skip-permissions` safe inside a container?
3. How should shared repo volumes work with branch isolation?
4. What's the complete container security spec?
5. What's the end-to-end flow from "user launches job" to "Claude running in sandboxed container"?

## Findings

### 1. Orchestration Agent Architecture

The Orchestration Agent replaces the current PTY-based agent with a Docker container manager:

```
Hub (Fastify)
  │ WebSocket
  ▼
Orchestration Agent (Node.js daemon on each Ubuntu machine)
  │ Docker socket (/var/run/docker.sock)
  ▼
Docker Engine
  ├── Container A (claude-code image, repo-X worktree mounted)
  ├── Container B (claude-code image, repo-Y worktree mounted)
  └── Container C (claude-code image, repo-X different-branch worktree mounted)
```

**Use `dockerode`** (not shell-out to `docker` CLI):
- 2.7M+ weekly npm downloads, TypeScript types available
- Direct Unix socket communication (JSON over HTTP)
- Proper streaming for stdout/stderr
- Container lifecycle: `createContainer()` → `start()` → `attach()` → `stop()` → `remove()`

**Container creation via dockerode:**

```typescript
import Docker from 'dockerode';
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const container = await docker.createContainer({
  Image: 'ghcr.io/anthropics/claude-code:latest',
  Cmd: ['claude', '-p', '--dangerously-skip-permissions', prompt],
  Tty: false,
  AttachStdout: true,
  AttachStderr: true,
  Env: [
    `ANTHROPIC_API_KEY=${apiKey}`,
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1',
  ],
  HostConfig: {
    Binds: [`${worktreePath}:/workspace:rw`],
    Memory: 2 * 1024 * 1024 * 1024,  // 2GB
    CpuQuota: 150000,                 // 1.5 cores
    CpuPeriod: 100000,
    PidsLimit: 256,
    NetworkMode: 'claude-restricted',  // allowlist network
    SecurityOpt: ['no-new-privileges'],
    CapDrop: ['ALL'],
    ReadonlyRootfs: true,
    Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=512m' },
    User: '1000:1000',
  },
  WorkingDir: '/workspace',
});
```

**Streaming output back to Hub:**

```typescript
const stream = await container.attach({ stream: true, stdout: true, stderr: true });
container.modem.demuxStream(
  stream,
  { write: (chunk) => ws.send(JSON.stringify({
      type: 'container:stdout', containerId, data: chunk.toString()
    }))
  },
  { write: (chunk) => ws.send(JSON.stringify({
      type: 'container:stderr', containerId, data: chunk.toString()
    }))
  },
);
```

### 2. Shared Repo Volume with Git Worktrees

**Pattern: Clone once, worktree per container.**

```
/data/repos/
  └── {repo-id}/                    # bare/full clone (shared .git objects)
      ├── .git/                     # shared git object store
      └── worktrees/
          ├── {container-id-1}/     # worktree on branch chq/job-abc/fix-bug
          ├── {container-id-2}/     # worktree on branch chq/job-def/add-tests
          └── {container-id-3}/     # worktree on branch chq/job-ghi/refactor
```

**Why worktrees, not plain mounts:**
- Each container gets its own branch, index, and working directory
- No file locking conflicts between containers
- Git objects are deduplicated (shared .git store)
- Each container sees only its branch's files

**Orchestration Agent manages the git layer:**

```typescript
// Agent clones repo (once)
if (!existsSync(`/data/repos/${repoId}/.git`)) {
  execFileSync('git', ['clone', '--filter=blob:none', repoUrl, `/data/repos/${repoId}`]);
} else {
  execFileSync('git', ['fetch', 'origin'], { cwd: `/data/repos/${repoId}` });
}

// Create worktree for this container
const worktreePath = `/data/repos/${repoId}/worktrees/${containerId}`;
const branchName = `chq/${jobId}/${slug}`;
execFileSync('git', ['worktree', 'add', '-b', branchName, worktreePath, 'origin/main'], {
  cwd: `/data/repos/${repoId}`,
});

// Mount worktreePath into container as /workspace
// After container exits: commit, push, remove worktree
```

**Critical rule:** The Orchestration Agent (not the container) handles `git fetch`, `git gc`, `git worktree prune`. Containers only do working-tree-local operations (the code Claude writes). This prevents lock contention on the shared `.git` directory.

**UID mapping:** Run containers as `--user 1000:1000` to match the host user that owns `/data/repos/`. Files created inside the container will be owned by UID 1000 on the host.

### 3. Container Security Spec

**Why `--dangerously-skip-permissions` is safe here:**

The container boundary replaces Claude Code's permission system. Claude can do whatever it wants *inside the container*, but the container limits what "whatever" means:

| Threat | Mitigation |
|--------|-----------|
| Delete host files | Container can only access the mounted worktree |
| Install malware on host | Read-only rootfs, no Docker socket, no host PID |
| Exfiltrate data via network | Restricted network (allowlist only `api.anthropic.com`) |
| Escalate to root | `--cap-drop ALL` + `no-new-privileges` + non-root user |
| Fork bomb / resource exhaustion | `--pids-limit 256` + `--memory 2g` + `--cpus 1.5` |
| Access other containers | `--network claude-restricted` (isolated Docker network) |
| Crypto mining | CPU limit + network restriction (can't reach pool) |
| Escape container | Default seccomp profile blocks dangerous syscalls |

**Complete `docker run` equivalent:**

```bash
docker run --rm -i \
  --name "claude-${JOB_ID}" \
  --user 1000:1000 \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=512m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --network claude-restricted \
  --memory 2g \
  --cpus 1.5 \
  --pids-limit 256 \
  -e "ANTHROPIC_API_KEY=${API_KEY}" \
  -e "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1" \
  -v "${WORKTREE_PATH}:/workspace:rw" \
  -w /workspace \
  ghcr.io/anthropics/claude-code:latest \
  claude -p --dangerously-skip-permissions "${PROMPT}"
```

**Network setup:** Create a Docker network with an HTTP proxy that allowlists only:
- `api.anthropic.com` (Claude API — required)
- `registry.npmjs.org` (npm install — optional, for setup commands)
- GitHub IP ranges (git clone/push — optional, if container does git ops)

Or use the Anthropic devcontainer's `init-firewall.sh` pattern with iptables inside the container (requires `NET_ADMIN` capability — less secure but simpler).

**Recommended: `--network claude-restricted` with a Squid/tinyproxy container as HTTP allowlist proxy.** This is more secure than granting `NET_ADMIN` to the Claude container.

### 4. End-to-End Flow

```
User clicks "Launch Job" in Dashboard
  │
  ├─ Dashboard → Hub: POST /api/jobs { repoId, prompt, machineId }
  │
  ├─ Hub creates job record (status: pending)
  ├─ Hub selects machine (auto-schedule or user-specified)
  ├─ Hub sends to Orchestration Agent via WS:
  │   { type: "container:create", jobId, repoId, repoUrl, prompt, branch }
  │
  ├─ Orchestration Agent:
  │   1. git fetch /data/repos/{repoId} (or clone if first time)
  │   2. git worktree add /data/repos/{repoId}/worktrees/{jobId} -b chq/{jobId}
  │   3. Run setup commands in worktree (pnpm install, etc.) via temp container
  │   4. docker.createContainer({ image, mounts: [worktreePath:/workspace], ... })
  │   5. container.start()
  │   6. container.attach() → stream stdout to Hub via WS
  │   7. Report: { type: "container:started", jobId, containerId }
  │
  ├─ Hub updates job (status: running)
  ├─ Hub forwards stdout to Dashboard via WS → xterm.js
  │
  ├─ Container exits (Claude Code finishes)
  │   Orchestration Agent:
  │   1. Detect exit via container.wait()
  │   2. Report: { type: "container:exited", jobId, exitCode }
  │   3. In worktree: git add -A && git commit && git push
  │   4. Remove container: container.remove()
  │   5. (Optional) Create PR via Hub
  │   6. Remove worktree: git worktree remove
  │
  └─ Hub updates job (status: completed), creates PR if auto_pr
```

### 5. Orchestration Agent vs Current Agent

| Aspect | Current Agent (PTY) | New Orchestration Agent (Docker) |
|--------|--------------------|---------------------------------|
| Execution | node-pty on host | Docker container per session |
| Isolation | None (host process) | Full container sandbox |
| `--dangerously-skip-permissions` | Unsafe on host | Safe in container |
| Repo access | Full host filesystem | Mounted worktree only |
| Network | Host network | Restricted/none |
| Cleanup | PTY process exit | Container removal + worktree prune |
| Resource limits | OS-level only | Docker cgroups (memory, CPU, PIDs) |
| Concurrent sessions | PTY pool (maxSessions) | Container count (limited by resources) |

**The Orchestration Agent replaces PtyPool but keeps WsClient, health reporting, and Hub communication.** It's a new execution backend, not a rewrite.

### 6. Dependencies

**New npm package needed:**
- `dockerode` — Docker Engine API client for Node.js
- `@types/dockerode` — TypeScript types

**Host requirements:**
- Docker Engine installed and running
- User running the agent added to `docker` group (or use rootless Docker)
- `ghcr.io/anthropics/claude-code:latest` image pre-pulled
- Sufficient disk for repo clones and worktrees

## Recommendations

1. **Add `dockerode` to the agent package** and create a `ContainerPool` class that mirrors the existing `PtyPool` interface but manages Docker containers instead of PTY processes.

2. **Create a restricted Docker network** (`docker network create claude-restricted`) with a Squid proxy container that allowlists only `api.anthropic.com`. This is more secure than `NET_ADMIN` + iptables inside the Claude container.

3. **Use git worktrees for branch isolation.** The Orchestration Agent clones each repo once to `/data/repos/{repoId}/`, creates worktrees per job, and mounts worktrees into containers. The agent (not the container) handles git fetch/gc/push.

4. **Run containers as `--user 1000:1000`** matching the host agent user. This ensures file ownership consistency for git commits after the container exits.

5. **Pre-pull the Claude Code image on agent startup** and refresh periodically. Container creation is fast (<1s); image pull is slow (30s+).

6. **Keep the existing PTY agent as a fallback.** Config option `executionMode: 'docker' | 'pty'` lets users choose. Docker mode is recommended for autonomous/queued work; PTY mode for interactive terminal sessions where the user is watching.

7. **Stream container stdout via `container.attach()`** with `demuxStream` for non-TTY containers. For TTY containers (if interactive terminal view is needed), use `Tty: true` and pipe the stream directly.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Docker socket on agent = root equivalent | High | Only the Orchestration Agent process has socket access; never expose to containers or network |
| Container escape via kernel vulnerability | Low | Keep Docker + kernel updated; default seccomp profile blocks most vectors |
| Git lock contention on shared .git | Medium | Agent handles all git operations (fetch, gc); containers only write to working tree |
| API key in container env | Medium | Never log env vars; use Docker secrets for production; key only lives for container lifetime |
| Image supply chain | Low | Pin to specific image digest, not `:latest`; verify ghcr.io/anthropics provenance |
| Disk exhaustion from many worktrees | Medium | Retention policy: auto-remove worktrees after job completion + age-based cleanup |
| Claude writes to paths outside /workspace | Low | Read-only rootfs + tmpfs /tmp; only /workspace is writable |

## Sources

### Docker API & Dockerode
- [Dockerode GitHub](https://github.com/apocas/dockerode) — Node.js Docker API client
- [Docker Engine API](https://docs.docker.com/reference/api/engine/) — official reference
- [Docker Resource Constraints](https://docs.docker.com/engine/containers/resource_constraints/) — memory, CPU, PIDs
- [docker-events npm](https://github.com/deoxxa/docker-events) — container lifecycle events

### Container Security
- [Claude Code Sandboxing (Anthropic Engineering)](https://www.anthropic.com/engineering/claude-code-sandboxing) — official approach
- [Claude Code Sandboxing Docs](https://code.claude.com/docs/en/sandboxing) — sandboxing reference
- [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)
- [Docker Seccomp Profiles](https://docs.docker.com/engine/security/seccomp/)
- [Docker no-new-privileges](https://raesene.github.io/blog/2019/06/01/docker-capabilities-and-no-new-privs/)

### Anthropic Official
- [Docker Sandboxes for Claude Code](https://docs.docker.com/ai/sandboxes/agents/claude-code/) — Docker's product
- [Anthropic DevContainer](https://github.com/anthropics/claude-code/tree/main/.devcontainer) — Dockerfile + firewall
- [init-firewall.sh](https://github.com/anthropics/claude-code/blob/main/.devcontainer/init-firewall.sh) — iptables allowlist
- [Claude Code .env auto-loading risk](https://www.knostic.ai/blog/claude-loads-secrets-without-permission)

### Git Worktrees
- [Git Worktree Documentation](https://git-scm.com/docs/git-worktree)
- [Claude Code with Git Worktrees and Docker](https://sangyh.com/posts/productivity/claude-code-with-git-worktrees/)
- [LLM Coding Agents Isolation](https://medium.com/@llupRisingll/the-quest-for-true-development-environment-isolation-on-linux-71dffbf23aad)

### Orchestration
- [Hawser - lightweight Docker agent](https://github.com/Finsys/hawser) — reference architecture
- [Apify container startup optimization](https://blog.apify.com/container-startup-time-improvement/) — warm pool strategies

## Appendix

### WebSocket Protocol Additions

```typescript
// Hub → Orchestration Agent
{ type: "container:create", jobId, repoId, repoUrl, branch, prompt, setupCommands, env }
{ type: "container:stop", containerId }
{ type: "container:remove", containerId }
{ type: "container:exec", containerId, cmd: string[] }

// Orchestration Agent → Hub
{ type: "container:created", jobId, containerId }
{ type: "container:started", jobId, containerId, pid }
{ type: "container:stdout", containerId, data: string }
{ type: "container:stderr", containerId, data: string }
{ type: "container:exited", containerId, exitCode, jobId }
{ type: "container:error", containerId, error: string, phase: string }
{ type: "container:stats", containerId, cpuPercent, memoryMB, pids }
```

### Docker Network Setup

```bash
# Create restricted network with HTTP proxy
docker network create --internal claude-restricted

# Run allowlist proxy (Squid or tinyproxy)
docker run -d \
  --name claude-proxy \
  --network claude-restricted \
  -e ALLOWED_DOMAINS="api.anthropic.com registry.npmjs.org" \
  tinyproxy-allowlist:latest

# Claude containers use this network and proxy env var:
# -e HTTP_PROXY=http://claude-proxy:8888
# -e HTTPS_PROXY=http://claude-proxy:8888
```

### Dockerfile for Custom Claude Code Image (Optional)

```dockerfile
FROM ghcr.io/anthropics/claude-code:latest

# Pre-install common dev tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    git jq ripgrep fd-find \
    && rm -rf /var/lib/apt/lists/*

# Pre-install common language runtimes (optional per use case)
# RUN curl -fsSL https://get.pnpm.io/install.sh | sh

USER 1000
WORKDIR /workspace
```
