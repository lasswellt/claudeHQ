---
id: E004
title: 'Cost Tracking & Budgets'
phase: R4
domain: 'cost-tracking'
capabilities: ['CAP-069', 'CAP-070', 'CAP-071', 'CAP-072', 'CAP-073', 'CAP-074']
status: planned
depends_on: ['E002', 'E003']
estimated_stories: 8
---

# Cost Tracking & Budgets

## Description

Finish the cost pipeline end-to-end: complete the pricing formula (long-context, cache multipliers, batch discount), per-query budget enforcement via `maxBudgetUsd`, daily/monthly period thresholds with notifications, an upfront token counter estimator, cost dashboard polish, and OpenTelemetry/Langfuse cost observability.

## Capabilities Addressed

| ID      | Coverage                                                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| CAP-069 | Pricing table (Opus 4.6 $5/$25, Sonnet 4.6 $3/$15, Haiku 4.5 $1/$5) + long-context 2x/1.5x premium + cache 1.25x/0.1x + batch 50% |
| CAP-070 | Per-query `maxBudgetUsd` option plumbed into every SDK call site                                                                  |
| CAP-071 | 50/75/90/100% daily/monthly threshold notifications (idempotent) + optional hard stop                                             |
| CAP-072 | Upfront estimator via `POST /v1/messages/count_tokens` + `@anthropic-ai/tokenizer` fallback                                       |
| CAP-073 | Cost dashboard polish: all visualizations sourced from session_costs + CSV export                                                 |
| CAP-074 | `CLAUDE_CODE_ENABLE_TELEMETRY=1` + OTLP endpoint + optional Langfuse/Helicone client                                              |

## Acceptance Criteria

1. Pricing table lives in `packages/hub/src/costs/pricing.ts` as a typed const. Contract test validates formula output against known SDK-reported costs within 1%.
2. Every SDK call site (interactive, queued, workforce, setup containers) passes `maxBudgetUsd` from job/session config. SDK error subtype `error_max_budget_usd` is handled and terminates the session with reason `cost_limit_exceeded`.
3. Daily + monthly spend aggregates per user/org from `session_costs`. Notifications at 50%, 75%, 90%, 100% thresholds fire exactly once per period (idempotent via `budget_threshold_events` table).
4. Optional hard-stop flag rejects new sessions for a user/org once their monthly budget is at 100%.
5. Job launcher UI shows upfront cost estimate before launch; actual cost recorded post-session for accuracy tracking.
6. Cost dashboard renders summary cards (today/week/month), daily timeline chart, top-repo pie, per-machine breakdown table, and supports CSV export + custom date range.
7. When `CLAUDE_CODE_ENABLE_TELEMETRY=1` and `OTEL_EXPORTER_OTLP_ENDPOINT` are set, cost events export with attribution to session/user/model fields.

## Technical Approach

- Pricing + formula are pure modules (`packages/hub/src/costs/pricing.ts`, `formula.ts`) — easy to contract-test against the SDK's reported `total_cost_usd`.
- Budget enforcer subscribes to session-end events (audit log or DB triggers) and evaluates thresholds. Uses the CAP-032 notification router for delivery.
- Token counter calls the free `/v1/messages/count_tokens` endpoint; caches results keyed by prompt hash.
- Telemetry wiring is an optional layer — only loaded if env vars are set. Use `@opentelemetry/sdk-node` + `@opentelemetry/exporter-trace-otlp-http`.

## Stories (Outline)

1. **Pricing table + formula module + contract test.** (Points: 3)
2. **maxBudgetUsd plumbing to SDK call sites.** (Points: 3)
3. **Budget enforcer + threshold events table.** (Points: 5)
4. **Hard-stop flag + session rejection path.** (Points: 2)
5. **Token counter estimator + launcher integration.** (Points: 5)
6. **Cost dashboard polish + CSV export.** (Points: 3)
7. **OTel export module (optional).** (Points: 5)
8. **Langfuse/Helicone adapter selection + smoke test.** (Points: 3)

## Dependencies

- **Requires**: E002 (notification router for thresholds), E003 (cost enforcement shares sweeper infra)
- **Enables**: Workforce dashboard cost visibility and chargeback reporting

## Risk Factors

- Pricing updates are a recurring maintenance burden; document the review process in the pricing module header.
- Token counter requires a network call to Anthropic API; handle failure gracefully (fall back to tokenizer lib or skip estimate).
- Langfuse vs Helicone choice is deferred to an implementation decision during the sprint — both are compatible with the same abstraction.
