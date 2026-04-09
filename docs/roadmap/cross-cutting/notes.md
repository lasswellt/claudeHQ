# Cross-Cutting Notes

Short notes on system-wide concerns. In this brownfield roadmap refresh the authoritative specifications live in (a) `capability-index.json` for acceptance criteria, (b) the existing `.claude/rules/*.md` files for coding conventions, and (c) the domain-specific source research documents in `docs/_research/`. This file only captures decisions that span all domains.

## Authentication

ClaudeHQ is **single-tenant / single-user self-hosted**. There is no login, no user table, no role-based access control. All access control is achieved via:

- Tailscale mesh — the hub is only reachable by machines on the operator's tailnet
- Tailscale Serve HTTPS — terminates TLS with Tailscale's managed certs (CAP-097)
- Optional tags (`tag:claudehq`) — restrict which tailnet members can reach the hub

Do not add user auth plumbing to any epic without explicit product decision. If multi-user support is ever required, it enters the roadmap as new capabilities.

## Error Handling

- Backend: Zod `.parse()` on every inbound message/body; throws are caught by Fastify's error handler and returned as `{ error: string }` with correct status code. Log at pino error level with `req.log.error(err, 'context')`.
- Frontend: every data view handles three states — loading (VSkeletonLoader), empty (VAlert), error (VAlert + retry). The codebase review flagged several places where this is violated (HI-06, HI-07); those are part of R1.
- WebSocket: invalid messages are logged and connections are closed with code 1008. No silent drops.
- Dashboard API calls: one `res.json()` per response (the double-read bug CR-01 is part of R1).

## Testing

- Framework: **Vitest** across all packages.
- Factory functions for test data. AAA pattern. No mocking the database in integration tests — use a real SQLite file in a temp dir.
- Coverage targets: not formally enforced; every capability epic must ship with at least unit tests for new pure logic and one integration test for any new route or WS message handler.
- E2E is manual today; consider Playwright in a future capability if needed (not on current roadmap).

## CI / CD

- Local: `pnpm build`, `pnpm type-check`, `pnpm test`, `pnpm lint` via turbo.
- No GitHub Actions workflow exists yet. Release artifact is the Docker image built from `Dockerfile.hub` (CAP-094).
- Deployment is `docker compose up` by the operator. No hosted staging/production.
- If the operator runs multiple environments, `.env` + `docker-compose.simple.yml` vs full `docker-compose.yml` is the variation axis.

## Monitoring / Observability

- **Logging**: pino everywhere on the backend. No `console.log` (ESLint rule enforced).
- **Metrics**: machine heartbeats feed `machine_metrics` (CAP-075) — keep a rolling window in SQLite, not a TS database.
- **Audit log**: every mutation route appends to `audit_log` (CAP-015).
- **OpenTelemetry**: optional cost/usage export via `CLAUDE_CODE_ENABLE_TELEMETRY=1` (CAP-074). Langfuse/Helicone integration deferred to R4.
- **Health**: `GET /health` is the only liveness probe; Docker compose healthcheck uses it.

## Protocol / Shared Types

- All shared types and schemas live in `packages/shared/`. Nothing else exports types or schemas cross-package.
- The WS protocol is versioned by inclusion in the discriminated unions `agentToHubSchema`, `hubToAgentSchema`, `hubToDashboardSchema`. Any new message type MUST be added to the correct union (this is the root cause of review finding HI-01).
- Browser-side schemas must also be re-exported from `packages/shared/src/browser.ts` (HI-03).
- Message field naming: `type` literal, then camelCase. No discriminator collision across unions.

## Security

- SQL: prepared statements only. No string interpolation (rule enforced in `.claude/rules/sqlite-patterns.md`).
- Shell injection: agent-side process spawning MUST use argv arrays, never a shell string. The review flagged 5 critical shell injection findings in the agent package — those were fixed; keep the rule.
- Secrets: loaded from `/run/secrets/` via Docker secrets (CAP-099) or env vars. Never hardcoded, never logged.
- Container sandbox: every Docker-mode container must meet the CAP-081 security baseline BEFORE `--dangerously-skip-permissions` is enabled (enforced in code, not convention).
- Tailscale: the only network boundary between hub and external world; no direct internet exposure.
