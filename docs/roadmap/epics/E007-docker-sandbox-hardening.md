---
id: E007
title: 'Docker Sandbox Hardening'
phase: R7
domain: 'docker-sandbox'
capabilities: ['CAP-079', 'CAP-081', 'CAP-082', 'CAP-084', 'CAP-087', 'CAP-089']
status: planned
depends_on: ['E003']
estimated_stories: 8
---

# Docker Sandbox Hardening

## Description

Finish the auto-accept sandbox story so `--dangerously-skip-permissions` is demonstrably safe. Restricted Docker network with HTTP allowlist proxy, complete security baseline, pre-pull on agent startup, async setup containers with extended timeout, WSL2 spawn strategy, and accurate container stats reporting.

## Capabilities Addressed

| ID      | Coverage                                                                                                                                      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| CAP-079 | WSL2 spawn strategy (wsl -d <distro> -- <command>) passing SpawnedProcess contract test                                                       |
| CAP-081 | Container security baseline: CapDrop=ALL + no-new-privileges + ReadonlyRootfs + tmpfs /tmp + Memory=2GB + CPU=1.5 + PIDs=256 + user 1000:1000 |
| CAP-082 | Restricted Docker network `claude-restricted` with tinyproxy sidecar allowlisting api.anthropic.com + registry.npmjs.org + GitHub IP ranges   |
| CAP-084 | `docker.pull('ghcr.io/anthropics/claude-code:latest')` on agent startup + weekly refresh cron                                                 |
| CAP-087 | Container stats reporter with correct cpuPercent delta math (from research-cache GAP note)                                                    |
| CAP-089 | Async setup commands in a temporary container with extended timeout (5min vs 30min)                                                           |

## Acceptance Criteria

1. `claude-restricted` Docker network created as `--internal`. tinyproxy sidecar runs on the network with allowlist config. Containers use `HTTP_PROXY`/`HTTPS_PROXY` env vars. End-to-end test: container can reach `api.anthropic.com` but not `example.com`.
2. Container spec generator rejects creation if any required security field is missing. A runtime inspect after creation verifies the container actually matches the spec.
3. Agent startup calls `docker.pull()` for the Claude Code image; pull completion is logged with digest + size. Startup health check fails if pull fails. Weekly refresh via cron/timer.
4. Container stats reporter queries `container.stats({stream: true})` and computes `cpuPercent = (cpuDelta / systemDelta) * onlineCpus * 100`. Reports every 5-10s via `container:stats` WS message with `{ cpuPercent, memoryMB, pids }`.
5. Setup commands run in a temporary container mounting the same worktree at `/workspace`. Extended timeout (configurable, default 5 min). Failure → `container:error` + abort main container. Success → remove temp container and proceed.
6. WSL2 spawn strategy passes the same `SpawnedProcess` contract test as docker/ssh strategies. Distro name is configurable. AbortSignal kills the WSL process.
7. `--dangerously-skip-permissions` is only applied when the agent runs in docker mode AND the container meets the CAP-081 baseline AND the CAP-082 network allowlist is active. Code-level guard, not convention.

## Technical Approach

- Restricted network: ship as `deploy/docker/network/claude-restricted.yml` and a `tinyproxy.conf` allowlist. Agent provisioning uses the network name when creating containers.
- Security baseline enforcement: `packages/agent/src/container-security.ts` exports a `buildSecurityOpts()` builder that returns the exact HostConfig + a validator that inspects a running container and asserts parity.
- Pre-pull: in `packages/agent/src/daemon.ts` startup sequence. Fails fast on pull error.
- Stats math: isolate in `packages/agent/src/container-stats.ts` with unit tests covering first-sample (no delta) and steady-state cases.
- Setup container: use `docker.run()` single-call helper (from research-cache notes) to avoid manual lifecycle dance.
- WSL2 spawn: `packages/agent/src/spawn-wsl.ts` modeled on `spawn-ssh.ts`.

## Stories (Outline)

1. **Restricted network + tinyproxy config.** (Points: 5)
2. **Container security baseline builder + validator.** (Points: 3)
3. **--dangerously-skip-permissions runtime guard.** (Points: 2)
4. **Pre-pull on startup + weekly refresh.** (Points: 3)
5. **Container stats CPU% math + streaming reporter.** (Points: 3)
6. **Async setup container via docker.run().** (Points: 5)
7. **WSL2 spawn strategy + contract test.** (Points: 3)
8. **E2E test: egress blocked to disallowed domain.** (Points: 3)

## Dependencies

- **Requires**: E003 (dual-stream parsing aligns with container stats events)
- **Enables**: Full autonomous execution story; unblocks the auto-accept user value

## Risk Factors

- Docker network internal mode blocks ALL egress; proxy must be reachable from the container network. Test the network topology before baking into production.
- CPU percent math is easy to get wrong. Use the documented Docker formula verbatim; don't trust blog posts.
- WSL2 support depends on host OS — CI may not be able to test it. Document manual verification steps.
