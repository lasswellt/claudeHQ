---
id: E003
title: 'Scheduler & Session Lifecycle Completion'
phase: R3
domain: 'session-lifecycle'
capabilities: ['CAP-011', 'CAP-012', 'CAP-013', 'CAP-014', 'CAP-016', 'CAP-017']
status: planned
depends_on: ['E001']
estimated_stories: 9
---

# Scheduler & Session Lifecycle Completion

## Description

Finish the session lifecycle story: add machine capabilities/requirements matching, the scoring-based auto-scheduler, timeout + cost enforcement, retry with backoff, SDK session discovery, and dual-stream parsing so the Events tab reflects tool calls live.

## Capabilities Addressed

| ID      | Coverage                                                                                        |
| ------- | ----------------------------------------------------------------------------------------------- |
| CAP-011 | Timeout + max_cost_usd columns with a 5-10s enforcement loop that kills offenders               |
| CAP-012 | retry_policy column with exponential backoff re-queue + exit-code filter                        |
| CAP-013 | machines.capabilities TEXT column, tasks.requirements TEXT column, matching filter              |
| CAP-014 | Optional machineId + scoring formula; atomic placement                                          |
| CAP-016 | Agent SDK query()/listSessions() wrapper powering session discovery                             |
| CAP-017 | Dual-stream parsing: --output-format stream-json + PTY; event parser routes typed events to hub |

## Acceptance Criteria

1. `machines.capabilities` JSON array and `sessions.requirements` / `queue.requirements` JSON array added via migration. Machine card shows capability badges.
2. Creating a session without `machineId` queues it; scheduler runs on transition to running and picks the highest-scoring machine using exactly: `score = (maxSessions - active) * 10 + (100 - cpuPercent) + (100 - memoryPercent) - (queueDepth * 5)`.
3. Placement is atomic (transaction + conditional UPDATE) so two concurrent placements cannot pick the same slot.
4. Sessions exceeding `timeout_seconds` or cumulative `cost_usd > max_cost_usd` are terminated within 10 seconds and marked failed with reason `timeout` or `cost_limit_exceeded`.
5. Failed queue tasks with `retry_policy` re-queue using `backoffSeconds * 2^retryCount`. `retryOnExitCodes` filter restricts retry to matching codes.
6. Session detail view shows retry history.
7. Hub has an SDK session discovery endpoint backed by `@anthropic-ai/claude-agent-sdk` `query()` / `listSessions()` rather than daemon-only polling.
8. Sessions optionally spawn with `--output-format stream-json`; agent parses JSON events (permissionAsked, toolCalled, costUpdated) in parallel with the PTY ANSI stream without corrupting either.
9. Dashboard Events tab populates from the dual-stream event feed.

## Technical Approach

- Scheduler lives in `packages/hub/src/scheduler/` (already exists — extend). The scoring function is a pure module `scheduler/score.ts` with its own unit tests.
- Atomic placement: use SQLite's `UPDATE … WHERE status = 'pending' AND id = ?` returning changes(); wrap in a transaction with the scoring query.
- Timeout/cost sweeper runs on a 10s interval, reuses the CAP-024 sweeper harness.
- Retry re-queue creates a new queue row with incremented `retry_count` and `available_at = now + backoff`.
- Dual-stream parser is a transform in the agent that splits stdout into two `Writable` streams — one JSON-lines, one passed through to PTY.
- SDK client wrapper lives in `packages/hub/src/services/agent-sdk-client.ts`, returns typed sessions.

## Stories (Outline)

1. **Migration: capabilities + requirements columns.** (Points: 2)
2. **Scheduler score module + unit tests.** (Points: 3)
3. **Atomic placement transaction + regression test.** (Points: 3)
4. **Timeout + cost enforcement loop.** (Points: 3)
5. **Retry policy re-queue + backoff.** (Points: 5)
6. **SDK session discovery wrapper + endpoint.** (Points: 3)
7. **Dual-stream parser in agent.** (Points: 5)
8. **Events tab live feed from dual-stream.** (Points: 3)
9. **Integration test: end-to-end scheduler placement + enforcement.** (Points: 3)

## Dependencies

- **Requires**: E001 (machine_metrics store feeds scheduler scoring)
- **Enables**: E004 (cost enforcement relies on retry path being correct), E007 (container stats align with dual-stream events)

## Risk Factors

- SQLite doesn't support `UPDATE … RETURNING` on older builds; verify better-sqlite3 version supports it, else fall back to `UPDATE` + `SELECT changes()`.
- `spawnClaudeCodeProcess` option flagged as unverified in research-cache (CAP-076 risk). The dual-stream parser in this epic does NOT rely on that option — it spawns `claude` via `child_process.spawn` with the `--output-format stream-json` flag and parses stdout directly.
- SDK `listSessions()` API signature should be confirmed against the latest package version; if absent, fall back to the query()-based enumeration documented in research-cache.
