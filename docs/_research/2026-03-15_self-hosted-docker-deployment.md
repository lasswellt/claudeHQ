---
title: "Self-Hosted Docker Deployment: Complete Docker Compose for Claude HQ"
date: 2026-03-15
tags: [docker, deployment, docker-compose, tailscale, sqlite, caddy, nginx, monorepo, dockerfile]
status: complete
related: [github-docker-costs-rivet, workforce-management-platform]
packages: [hub, dashboard, agent, shared]
---

# Self-Hosted Docker Deployment: Complete Docker Compose for Claude HQ

## Summary

Claude HQ should deploy as a **single container** where the Hub (Fastify) serves the Dashboard's static files directly via `@fastify/static` — one port, one process, zero inter-container complexity. The Nuxt 3 SPA is built with `nuxt generate` and copied into the Hub image during a multi-stage Docker build using `turbo prune --docker` for optimal layer caching. SQLite and recordings persist on bind-mount volumes. Tailscale runs either on the host (simplest) or as a sidecar container with Tailscale Serve handling TLS. The complete `docker-compose.yml` needs just 2-3 services: Tailscale (optional sidecar), Hub (all-in-one), and the remote Agent (runs separately on target machines, connects via WebSocket).

## Research Questions

1. How should Hub and Dashboard be containerized — one container or separate?
2. What does the complete docker-compose.yml look like?
3. How to handle SQLite persistence, Tailscale, recordings, and secrets?
4. What are the best multi-stage Dockerfile patterns for a pnpm monorepo?
5. How should the Agent on remote machines connect to a Dockerized Hub?

## Findings

### 1. Service Architecture: Single Container Wins

**Recommendation: Hub serves Dashboard static files directly.**

| Option | Containers | Complexity | Best For |
|--------|-----------|------------|----------|
| **A: Single container** | 1 (Hub serves static) | Lowest | Personal tool (recommended) |
| B: Hub + Nginx | 2 + networking | Medium | If static caching matters |
| C: Hub + Dashboard + Caddy | 3 + proxy config | Highest | Public-facing with TLS |

How it works:
- `nuxt generate` produces static SPA files in `.output/public/`
- Multi-stage Docker build copies them into the Hub image
- Hub uses `@fastify/static` to serve at `/`, with `setNotFoundHandler` returning `index.html` for client-side routing
- API at `/api/*`, WebSocket at `/ws/*`, hooks at `/hooks/*` — all on port 7700
- Dashboard uses relative paths (`/api/*`, `/ws/*`) — no URL configuration needed

```typescript
// In Hub's server.ts
import fastifyStatic from '@fastify/static';

app.register(fastifyStatic, {
  root: path.join(__dirname, '../dashboard-static'),
  wildcard: false,
});

// SPA fallback for client-side routing
app.setNotFoundHandler((req, reply) => {
  if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/ws/') && !req.url.startsWith('/hooks/')) {
    return reply.sendFile('index.html');
  }
  reply.code(404).send({ error: 'Not found' });
});
```

**Critical caveat:** `NUXT_PUBLIC_*` runtime env vars do NOT work with `nuxt generate` (static SPA). Variables are baked at build time. Since Dashboard and Hub share the same origin in the single-container model, relative paths work with zero configuration. If runtime config is ever needed, use a `/api/config` endpoint.

### 2. Multi-Stage Dockerfile (Hub + Dashboard Combined)

Uses `turbo prune --docker` which generates `out/json/` (package manifests for dep caching) and `out/full/` (source code) separately.

```dockerfile
# syntax=docker/dockerfile:1

# ── Stage 0: Base ──────────────────────────────────────────────
FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# ── Stage 1: Prune monorepo for hub + dashboard ───────────────
FROM base AS pruner
RUN npm i -g turbo@^2
COPY . .
RUN turbo prune @chq/hub --docker
# Also prune dashboard for static build
RUN turbo prune @chq/dashboard --docker --out-dir out-dashboard

# ── Stage 2: Install hub dependencies ──────────────────────────
FROM base AS hub-deps
# better-sqlite3 needs build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ── Stage 3: Build hub ─────────────────────────────────────────
FROM hub-deps AS hub-builder
COPY --from=pruner /app/out/full/ .
COPY turbo.json turbo.json
RUN pnpm turbo build --filter=@chq/hub...

# ── Stage 4: Build dashboard (static SPA) ──────────────────────
FROM base AS dashboard-builder
COPY --from=pruner /app/out-dashboard/json/ .
COPY --from=pruner /app/out-dashboard/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out-dashboard/pnpm-workspace.yaml ./pnpm-workspace.yaml

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY --from=pruner /app/out-dashboard/full/ .
COPY turbo.json turbo.json
RUN pnpm turbo build --filter=@chq/dashboard...

# ── Stage 5: Production hub dependencies ───────────────────────
FROM base AS prod-deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ── Stage 6: Runtime ───────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
RUN corepack enable
WORKDIR /app

ENV NODE_ENV=production

# Production node_modules (with native better-sqlite3)
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=prod-deps /app/packages/hub/node_modules ./packages/hub/node_modules

# Built hub + shared
COPY --from=hub-builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=hub-builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=hub-builder /app/packages/hub/dist ./packages/hub/dist
COPY --from=hub-builder /app/packages/hub/package.json ./packages/hub/package.json
COPY --from=hub-builder /app/package.json ./package.json

# Dashboard static files served by Hub
COPY --from=dashboard-builder /app/packages/dashboard/.output/public ./packages/hub/dashboard-static

# Data directory
RUN mkdir -p /app/data/db /app/data/recordings

EXPOSE 7700

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=15s \
  CMD node -e "fetch('http://localhost:7700/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/hub/dist/server.js"]
```

**Key decisions:**
- **`node:22-bookworm-slim`** (Debian), NOT Alpine — better-sqlite3 has prebuilt binaries for glibc; Alpine's musl causes `fcntl64` symbol errors
- **Separate hub-deps and dashboard-builder stages** — dashboard has no native modules, so no build tools needed
- **BuildKit cache mount** for pnpm store — avoids re-downloading between builds
- **Dashboard static files copied into Hub image** at a known path
- **`turbo build --filter=@chq/hub...`** — the `...` suffix builds hub AND all its workspace dependencies (shared)

### 3. Agent Dockerfile (Separate Image)

The Agent runs on remote machines, NOT in the main docker-compose. Built separately.

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS pruner
RUN npm i -g turbo@^2
COPY . .
RUN turbo prune @chq/agent --docker

FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS builder
COPY --from=pruner /app/out/full/ .
COPY turbo.json turbo.json
RUN pnpm turbo build --filter=@chq/agent...

FROM base AS prod-deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

FROM node:22-bookworm-slim AS runtime
RUN corepack enable && \
    apt-get update && apt-get install -y --no-install-recommends procps && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=prod-deps /app/packages/agent/node_modules ./packages/agent/node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/agent/dist ./packages/agent/dist
COPY --from=builder /app/packages/agent/package.json ./packages/agent/package.json
COPY --from=builder /app/package.json ./package.json

CMD ["node", "packages/agent/dist/index.js"]
```

`procps` is included for node-pty's process management needs.

### 4. Docker Compose (Complete)

```yaml
# docker-compose.yml

services:
  # ── Tailscale (optional sidecar for mesh networking) ────────
  tailscale:
    image: tailscale/tailscale:latest
    hostname: claude-hq
    environment:
      - TS_AUTHKEY=${TS_AUTHKEY}
      - TS_STATE_DIR=/var/lib/tailscale
      - TS_SERVE_CONFIG=/config/serve.json
      - TS_EXTRA_ARGS=--advertise-tags=tag:claudehq
    volumes:
      - ts-state:/var/lib/tailscale
      - ./deploy/ts-config:/config:ro
    devices:
      - /dev/net/tun:/dev/net/tun
    cap_add:
      - net_admin
      - sys_module
    restart: unless-stopped

  # ── Hub (API + WebSocket + Dashboard static) ────────────────
  hub:
    build:
      context: .
      dockerfile: Dockerfile.hub
    network_mode: service:tailscale
    environment:
      - DATABASE_PATH=/app/data/db/chq.db
      - RECORDINGS_PATH=/app/data/recordings
      - HUB_PORT=7700
      - LOG_LEVEL=info
      - NODE_OPTIONS=--max-old-space-size=384
    env_file:
      - .env
    secrets:
      - anthropic_api_key
      - github_app_private_key
    volumes:
      - sqlite-data:/app/data/db
      - recordings:/app/data/recordings
    depends_on:
      - tailscale
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

# ── Secrets ──────────────────────────────────────────────────
secrets:
  anthropic_api_key:
    file: ./secrets/anthropic_api_key
  github_app_private_key:
    file: ./secrets/github_app.pem

# ── Volumes ──────────────────────────────────────────────────
volumes:
  ts-state:
  sqlite-data:
  recordings:
```

**Tailscale Serve config** (`deploy/ts-config/serve.json`):
```json
{
  "TCP": {
    "443": { "HTTPS": true }
  },
  "Web": {
    "${TS_CERT_DOMAIN}:443": {
      "Handlers": {
        "/": { "Proxy": "http://127.0.0.1:7700" }
      }
    }
  }
}
```

This makes the Hub accessible at `https://claude-hq.<tailnet>.ts.net` with automatic TLS certs from Tailscale. Add `"AllowFunnel"` for the `/hooks/*` path if GitHub webhooks are needed.

**Simplified version (Tailscale on host, no sidecar):**

```yaml
services:
  hub:
    build:
      context: .
      dockerfile: Dockerfile.hub
    ports:
      - "7700:7700"
    environment:
      - DATABASE_PATH=/app/data/db/chq.db
      - RECORDINGS_PATH=/app/data/recordings
      - HUB_PORT=7700
      - LOG_LEVEL=info
    env_file:
      - .env
    volumes:
      - ./data/db:/app/data/db
      - ./data/recordings:/app/data/recordings
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:7700/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 15s
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

Remote agents connect to `ws://<host-tailscale-ip>:7700/ws/agent`. Browsers access `http://<host-tailscale-ip>:7700/`.

### 5. SQLite in Docker

**Critical rules:**
- Mount the **directory**, not the file — SQLite creates `-wal` and `-shm` companion files
- **Never use NFS or network-mounted volumes** — SQLite requires POSIX file locking
- Bind mounts and named Docker volumes both work correctly
- WAL mode is safe with local volumes (single-writer Hub process)

**Recommended PRAGMAs** (set on startup):
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -20000;      -- 20MB
PRAGMA mmap_size = 268435456;    -- 256MB
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
```

**Backup strategy:**
- **Simple:** Host cron runs `docker exec hub sqlite3 /app/data/db/chq.db ".backup /app/data/db/backup-$(date +%Y%m%d).db"`
- **Continuous:** [Litestream](https://litestream.io/guides/docker/) sidecar replicates to S3/B2/SFTP in real-time
- **Manual:** `cp` the `.db` file while Hub is running (safe with WAL mode)

### 6. Recording Storage

- Separate bind mount: `./data/recordings:/app/data/recordings`
- Recordings are append-only JSONL — no locking concerns
- Retention policy: Hub deletes recordings older than N days (configurable)
- Independent backup schedule from database (recordings are larger, less critical)

### 7. Secrets Management

| Secret | Storage | Access |
|--------|---------|--------|
| `ANTHROPIC_API_KEY` | `./secrets/anthropic_api_key` file | Docker secret → `/run/secrets/anthropic_api_key` |
| GitHub App private key | `./secrets/github_app.pem` file | Docker secret → `/run/secrets/github_app_private_key` |
| `TS_AUTHKEY` | `.env` file | Environment variable (one-time use) |
| Hub config (non-secret) | `.env` file | Environment variables |

Hub reads secrets with:
```typescript
const apiKey = readFileSync('/run/secrets/anthropic_api_key', 'utf-8').trim();
```

Add to `.gitignore`: `secrets/`, `.env`, `data/`

### 8. Agent Connectivity

The Agent daemon runs on remote machines (bare metal, WSL2, or in its own Docker container) and connects TO the Hub:

```
Remote Machine (Agent)
  └─ Tailscale (mesh IP: 100.x.x.x)
       └─ chq-agent daemon
            └─ WebSocket → ws://claude-hq.<tailnet>.ts.net/ws/agent
                         (or ws://<hub-tailscale-ip>:7700/ws/agent)
```

The Agent is NOT in the Hub's docker-compose. It has its own deployment:
- **Bare metal:** systemd service running `node packages/agent/dist/index.js`
- **Docker:** `docker run -d --restart unless-stopped -e HUB_URL=ws://... claude-hq/agent:latest`
- **WSL2:** systemd service inside WSL2 instance

### 9. Reverse Proxy Options (If Needed)

For most users, Hub serving everything on port 7700 with Tailscale Serve handling TLS is sufficient. If a separate proxy is needed:

**Caddy (recommended):**
```caddyfile
claude-hq.tail1234.ts.net {
    reverse_proxy localhost:7700 {
        stream_close_delay 5m
    }
}
```

Caddy handles WebSocket upgrades automatically (no special config). `stream_close_delay` prevents reconnection storms on config reload.

**When to add Caddy:**
- Multiple domains or virtual hosts
- Static asset caching/compression beyond Fastify
- Rate limiting at the proxy layer
- Public-facing with Let's Encrypt (not just Tailscale)

### 10. .dockerignore

```
node_modules
**/node_modules
**/.nuxt
**/.output
**/dist
**/.turbo
.git
.github
.vscode
.claude
docs
*.md
.env*
secrets/
data/
```

### 11. Image Size Estimates

| Image | Base | Expected Size |
|-------|------|---------------|
| Hub (+ Dashboard static) | `node:22-bookworm-slim` (~80MB) | ~220-280MB |
| Agent | `node:22-bookworm-slim` (~80MB) | ~200-250MB |
| Dashboard-only (if separate) | `nginx:1.27-alpine` (~5MB) | ~15-25MB |

## Analysis

### Why Single Container is Right for Claude HQ

Claude HQ is a **personal tool** running on a private Tailscale network. The benefits of multi-container architectures (independent scaling, separate deployment cycles, team ownership boundaries) don't apply. The single-container model:

- **One `docker compose up`** and everything works
- **No CORS issues** — Dashboard and API share the same origin
- **No inter-container networking** — no Docker networks to debug
- **One health check** — if the Hub is healthy, the Dashboard is served
- **One log stream** — `docker compose logs -f` shows everything
- **Simpler updates** — `docker compose build && docker compose up -d`

### Tailscale: Host vs Sidecar

| Approach | Simplicity | Isolation | Best For |
|----------|------------|-----------|----------|
| **Tailscale on host** | Simplest | None | Machines already running Tailscale |
| **Tailscale sidecar** | Medium | Container gets own tailnet identity | Fresh servers, automated deployment |

For a machine that already runs Tailscale (like a personal dev machine), just use Tailscale on the host and expose port 7700. For a dedicated server or VPS, the sidecar pattern gives the Hub its own tailnet hostname.

### TLS Decision Matrix

| Scenario | Approach |
|----------|----------|
| All users on Tailscale | No TLS needed — WireGuard already encrypts |
| Want browser trust (no cert warnings) | Tailscale Serve with auto-certs for `*.ts.net` |
| Need GitHub webhooks | Tailscale Funnel for `/hooks/*` path |
| Public domain | Caddy with Let's Encrypt |

## Recommendations

1. **Ship a single `Dockerfile.hub`** that builds both Hub and Dashboard into one image. Use `turbo prune --docker` for optimal layer caching.

2. **Ship a `docker-compose.yml`** with two services: Tailscale sidecar + Hub. Include a simplified version (just Hub with port mapping) for users with Tailscale on the host.

3. **Use bind mounts for data** (`./data/db` and `./data/recordings`) rather than named volumes — makes backups trivial with standard file tools.

4. **Use Docker secrets** (file-based) for API keys and private keys. Ship a `secrets/.gitkeep` with documentation on what files to create.

5. **Set `NODE_OPTIONS=--max-old-space-size=384`** in the Hub container — Node.js doesn't auto-detect container memory limits.

6. **Ship the Agent as a separate Docker image** (`Dockerfile.agent`) for users who want to run agents in containers, but document that bare-metal systemd is the primary agent deployment method.

7. **Add a `GET /health` endpoint** to the Hub returning `{ status: "ok", version, uptime }` for Docker health checks and monitoring.

8. **Include a `Makefile` or npm scripts** for common operations: `make build`, `make up`, `make logs`, `make backup`, `make update`.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| SQLite file locking fails on network volumes | High | Document: only use local volumes, never NFS/CIFS |
| `nuxt generate` bakes env vars at build time | Medium | Use relative paths (same-origin); add `/api/config` endpoint if runtime config needed |
| Tailscale sidecar auth key expires (90 days) | Medium | Use OAuth client credentials instead (never expire) |
| better-sqlite3 fails to compile on Alpine | High | Use `node:22-bookworm-slim` (Debian), never Alpine |
| Node.js doesn't respect container memory limits | Medium | Set `NODE_OPTIONS=--max-old-space-size=384` explicitly |
| Docker Compose secrets not supported in `docker compose run` | Low | Use `env_file` as fallback for development |
| Large recording files fill disk | Medium | Implement retention policy; separate recordings volume; monitor with `docker system df` |

## Sources

### Docker + Monorepo
- [Turborepo Docker guide](https://turborepo.dev/docs/guides/tools/docker)
- [turbo prune reference](https://turborepo.dev/docs/reference/prune)
- [pnpm Docker guide](https://pnpm.io/docker)
- [Running Nuxt 3 in Docker (Markus Oberlehner)](https://markus.oberlehner.net/blog/running-nuxt-3-in-a-docker-container)
- [better-sqlite3 Alpine discussion](https://github.com/WiseLibs/better-sqlite3/discussions/1270)

### Tailscale
- [Tailscale Docker guide](https://tailscale.com/docs/features/containers/docker)
- [Tailscale Docker deep dive](https://tailscale.com/blog/docker-tailscale-guide)
- [Tailscale Serve sidecar pattern](https://runtimeterror.dev/tailscale-serve-docker-compose-sidecar/)
- [Tailscale OAuth clients](https://tailscale.com/kb/1215/oauth-clients)
- [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel)

### SQLite + Persistence
- [SQLite in Docker (OneUptime)](https://oneuptime.com/blog/post/2026-02-08-how-to-run-sqlite-in-docker-when-and-how/view)
- [Litestream Docker guide](https://litestream.io/guides/docker/)
- [Docker volumes docs](https://docs.docker.com/engine/storage/volumes/)

### Reverse Proxy
- [Caddy reverse_proxy docs](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [Caddy + Tailscale certs](https://tailscale.com/kb/1190/caddy-certificates)
- [Nginx WebSocket proxying](https://nginx.org/en/docs/http/websocket.html)

### Secrets + Operations
- [Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/)
- [Docker Compose env var best practices](https://docs.docker.com/compose/how-tos/environment-variables/best-practices/)
- [Docker Compose health checks](https://www.tvaidyan.com/2025/02/13/health-checks-in-docker-compose-a-practical-guide/)
- [@fastify/static](https://github.com/fastify/fastify-static)

## Appendix

### Directory Structure for Deployment

```
claude-hq/
├── docker-compose.yml
├── docker-compose.simple.yml     # Simplified (no Tailscale sidecar)
├── Dockerfile.hub                # Hub + Dashboard combined
├── Dockerfile.agent              # Agent (separate image)
├── .dockerignore
├── .env.example                  # Template for configuration
├── deploy/
│   └── ts-config/
│       └── serve.json            # Tailscale Serve configuration
├── secrets/
│   ├── .gitkeep
│   ├── anthropic_api_key         # User creates this
│   └── github_app.pem            # User creates this (after GitHub App setup)
├── data/                         # Created by Docker, gitignored
│   ├── db/
│   │   └── chq.db
│   └── recordings/
│       └── *.jsonl
└── packages/
    ├── shared/
    ├── hub/
    ├── dashboard/
    └── agent/
```

### .env.example

```bash
# Hub configuration
HUB_PORT=7700
LOG_LEVEL=info
DATABASE_PATH=/app/data/db/chq.db
RECORDINGS_PATH=/app/data/recordings

# Tailscale (for sidecar mode)
TS_AUTHKEY=tskey-auth-xxxxx

# Node.js
NODE_OPTIONS=--max-old-space-size=384

# Optional: GitHub App (set after running setup wizard)
GITHUB_APP_ID=
GITHUB_APP_INSTALLATION_ID=
```

### Makefile

```makefile
.PHONY: build up down logs backup update

build:
	docker compose build

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f hub

backup:
	docker compose exec hub sqlite3 /app/data/db/chq.db ".backup /app/data/db/backup-$$(date +%Y%m%d).db"

update:
	git pull
	docker compose build --pull
	docker compose up -d

status:
	docker compose ps
	@echo "---"
	@curl -s http://localhost:7700/health | jq .
```
