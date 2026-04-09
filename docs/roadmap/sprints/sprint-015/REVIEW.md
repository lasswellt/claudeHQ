# Sprint 015 Review — COMPLETE

**Date**: 2026-04-09 (loop iterations 13–15)
**Epic**: E004 Cost Tracking & Budgets
**Phase**: R4
**Status**: **8 of 8 stories complete — E004 done, R4 exit criteria met**

## Stories

| ID      | Title                                       | Points | Status | Capability |
| ------- | ------------------------------------------- | ------ | ------ | ---------- |
| 015-001 | Pricing table + formula + contract test     | 3      | ✓ done | CAP-069    |
| 015-002 | maxBudgetUsd plumbing to SDK call sites     | 3      | ✓ done | CAP-070    |
| 015-003 | Budget enforcer + threshold events table    | 5      | ✓ done | CAP-071    |
| 015-004 | Hard-stop flag + HTTP 402 session rejection | 2      | ✓ done | CAP-071    |
| 015-005 | Token counter estimator                     | 5      | ✓ done | CAP-072    |
| 015-006 | Cost dashboard polish + CSV export          | 3      | ✓ done | CAP-073    |
| 015-007 | OTel OTLP/HTTP exporter                     | 5      | ✓ done | CAP-074    |
| 015-008 | Langfuse adapter                            | 3      | ✓ done | CAP-074    |

**Total points**: 29 / 29 delivered.

## Quality gates

| Command              | Result | Notes                                                |
| -------------------- | ------ | ---------------------------------------------------- |
| `pnpm -r type-check` | ✓ pass | shared, hub, agent, dashboard all clean              |
| `pnpm -r test`       | ✓ pass | shared 36/36, hub **224/224**, agent 30/30, dash n/a |
| `pnpm -r build`      | ✓ pass | all four packages                                    |

## Test delta across the sprint

| Package | Start | End | Added                                                                                  |
| ------- | ----- | --- | -------------------------------------------------------------------------------------- |
| shared  | 36    | 36  | —                                                                                      |
| hub     | 150   | 224 | +23 pricing + 15 budget enforcer + 8 hard-stop + 13 token counter + 15 telemetry = +74 |
| agent   | 30    | 30  | —                                                                                      |

## Migrations

- `014_budget_threshold_events.sql` — threshold crossing idempotency table
- `015_budget_hard_stop.sql` — adds `hard_stop` column to `budget_config`

## Files (non-exhaustive)

**New:**

- `packages/hub/src/costs/pricing.ts` (+ contract tests)
- `packages/hub/src/costs/formula.ts`
- `packages/hub/src/costs/budget-enforcer.ts`
- `packages/hub/src/costs/hard-stop.ts`
- `packages/hub/src/costs/token-counter.ts`
- `packages/hub/src/costs/telemetry.ts` (no-op + OTLP/HTTP JSON + Langfuse + env factory)

**Modified:**

- `packages/hub/src/dal.ts` — insertSession accepts `timeoutSeconds` + `maxCostUsd`
- `packages/hub/src/routes/sessions.ts` — body schema accepts both; hard-stop guard returns HTTP 402
- `packages/hub/src/routes/costs.ts` — `/api/costs/estimate` + `/api/costs/export` CSV
- `packages/hub/src/server.ts` — `createTelemetryFromEnv` wired into boot + graceful shutdown
- `packages/dashboard/app/pages/costs/index.vue` — Export CSV button

## Capabilities advanced

- **CAP-069** — Typed pricing table for Opus/Sonnet/Haiku 4.6/4.5 with long-context (2×/1.5×), cache read (0.1×), cache write (1.25×), batch (0.5×) multipliers; pure `computeCost` with breakdown + 23 contract tests
- **CAP-070** — `max_cost_usd` + `timeout_seconds` flow from request body → DAL → DB; enforcement sweeper from 014-004 already kills offenders
- **CAP-071** — Idempotent threshold-crossing evaluator at 50/75/90/100% with daily/monthly period keys; `budget_threshold_events` UNIQUE constraint; evaluate() returns newly-crossed for caller to fan out
- **CAP-071** — Hard-stop guard in session create route; HTTP 402 Payment Required with spent/limit details
- **CAP-072** — Token counter with Anthropic `count_tokens` API primary path, 4-char heuristic fallback, cache keyed by `(model, expectedOutput, system, prompt)` with LRU-style eviction
- **CAP-073** — CSV export endpoint with RFC 4180 escaping, default 30-day window, 10k row cap; dashboard download button
- **CAP-074** — OTLP/HTTP JSON trace exporter (direct POST, no SDK dep) + Langfuse basic-auth exporter, both with buffering + flush on interval, swallowed errors; env-driven factory picks based on `CLAUDE_CODE_ENABLE_TELEMETRY` + `OTEL_EXPORTER_OTLP_ENDPOINT` / `LANGFUSE_*`

## Follow-ups carried forward

1. **Wire `telemetry.emit()` into the session cost write path** — depends on the stream-json → `session_costs` INSERT pipeline, which is itself a follow-up from E003 (dual-stream parser wiring)
2. **Add a dedicated monthly column** to `budget_config` — currently monthly cap is derived as `global_daily_usd × 30`
3. **Wire budget enforcer `evaluate()`** into a periodic sweeper in `server.ts` that fans crossings out via the CAP-032 notification router (batcher + escalation)

## R4 → R5 handoff

E004 is done. R5 (Workforce Completeness, E005) depends on E001 which completed in sprint-012. Sprint-016 planning should target **E005**. Budget and enforcement infrastructure from this sprint will be consumed by the workforce scheduler's job-budget limits.
