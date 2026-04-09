---
id: E008
title: 'Deployment & Operations'
phase: R8
domain: 'deploy-infra, recording-and-replay'
capabilities: ['CAP-047', 'CAP-096', 'CAP-097', 'CAP-099', 'CAP-100']
status: planned
depends_on: ['E006']
estimated_stories: 7
---

# Deployment & Operations

## Description

Finalize the self-hosted deployment story: Tailscale sidecar in docker-compose, Tailscale Serve HTTPS config, Docker secrets for API keys and GitHub private key, SQLite backup strategy via cron and optional Litestream sidecar, and recordings volume retention enforcement.

## Capabilities Addressed

| ID      | Coverage                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------- |
| CAP-047 | Recordings volume TTL sweeper using `RECORDINGS_MAX_AGE_DAYS`                                              |
| CAP-096 | `docker-compose.yml` defines tailscale sidecar + hub `network_mode: service:tailscale` + `ts-state` volume |
| CAP-097 | `deploy/ts-config/serve.json` exposes hub at 443 HTTPS via Tailscale Serve with auto-TLS                   |
| CAP-099 | Docker secrets for `anthropic_api_key` and `github_app_private_key`; hub reads from `/run/secrets/*`       |
| CAP-100 | Cron-based `sqlite3 .backup` script + optional Litestream sidecar for continuous S3/B2/SFTP replication    |

## Acceptance Criteria

1. `docker-compose.yml` defines `tailscale` and `hub` services; hub uses `network_mode: service:tailscale`. `TS_AUTHKEY`, `TS_STATE_DIR`, `TS_SERVE_CONFIG`, and `TS_EXTRA_ARGS=--advertise-tags=tag:claudehq` all configured. `ts-state` named volume persists across restarts.
2. `deploy/ts-config/serve.json` includes TCP 443 HTTPS with a Web handler proxying to `http://127.0.0.1:7700`. After `docker compose up`, hub is reachable at `https://claude-hq.<tailnet>.ts.net` with a browser-trusted cert.
3. Compose `secrets:` block defines `anthropic_api_key` and `github_app_private_key`. Hub reads both with `fs.readFileSync('/run/secrets/...', 'utf-8').trim()`. `.gitignore` excludes `secrets/`, `.env`, `data/`.
4. Nightly cron script runs `docker exec hub sqlite3 /app/data/db/chq.db '.backup /app/data/db/backup-YYYYMMDD.db'`. Documentation covers restore procedure.
5. Optional Litestream sidecar container configured for continuous replication to S3/B2/SFTP. Enabled via a compose profile so operators can opt in.
6. Hub periodically scans `/app/data/recordings/` and deletes files with `mtime > RECORDINGS_MAX_AGE_DAYS`. Deletion respects the append-only JSONL format (no locking concerns).
7. Health check passes and `docker compose ps` shows healthy for both services after `docker compose up`.

## Technical Approach

- Tailscale sidecar is a straight copy of the pattern in the self-hosted-docker-deployment research doc — minimal code, mostly compose config.
- Secrets: the hub's config loader gets a new helper `loadSecret(name)` that tries `/run/secrets/<name>` first, falling back to env var, failing fast if neither is present for required secrets.
- Recording sweeper runs on the same hourly cron as the other sweepers (workspace TTL from E005, approvals timeout from CAP-024).
- Litestream is gated behind a compose profile (`docker compose --profile backup up`) so operators who don't want it aren't forced to configure it.
- Cron `.backup` script is a standalone shell script in `scripts/backup.sh` that the operator wires into their host cron.

## Stories (Outline)

1. **docker-compose.yml Tailscale sidecar + volume.** (Points: 3)
2. **deploy/ts-config/serve.json + verification.** (Points: 2)
3. **Docker secrets block + hub config loader.** (Points: 3)
4. **Recordings retention sweeper.** (Points: 2)
5. **scripts/backup.sh + docs.** (Points: 2)
6. **Litestream sidecar compose profile.** (Points: 3)
7. **E2E smoke test: compose up → browser → session → kill.** (Points: 3)

## Dependencies

- **Requires**: E006 (Tailscale Funnel URL used for GitHub webhook wiring)
- **Enables**: Operators can run the full stack end-to-end

## Risk Factors

- Tailscale Serve requires HTTPS cert provisioning on first boot — document the 2-3 minute delay and the `tailscale cert` command as a fallback.
- Litestream S3/B2/SFTP config varies per destination; ship an example for S3 and document where to customize.
- Docker secrets are a Swarm concept in some tooling; validate that standalone compose file-based secrets work in the operator's docker version.
