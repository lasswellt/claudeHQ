# Gap Analysis — 2026-04-09

Source: evidence matrix built from Phase 2 codebase walk. See `capability-index.json` for capability definitions.

## Headline

**104 capabilities total.** Most of the planned surface area already exists in code; the codebase is in a mature state following sprints 001–011 and two codebase reviews. Remaining work concentrates in three bands: (1) cost controls and observability, (2) Tailscale/deployment polish, (3) a small set of user-facing dialog UIs and workflow gaps.

| Status      | Count | Definition                                           |
| ----------- | ----: | ---------------------------------------------------- |
| complete    |     7 | All acceptance criteria satisfied                    |
| implemented |   ~58 | Feature exists; some criteria not yet satisfied      |
| partial     |   ~31 | Enabling infrastructure exists; end-to-end not wired |
| not_started |     8 | No related code exists                               |

## Greenfield (no related code)

These capabilities need to be built from scratch.

- **CAP-013** Machine capabilities + task requirements matching — no capabilities JSON column; scheduler filter missing
- **CAP-014** Scoring-based auto-scheduler (optional machineId) — the formula, selection logic, and atomicity guard are all missing
- **CAP-057** GitHub App manifest flow wizard — only manual credential settings today; no one-click manifest POST
- **CAP-072** Token counting estimator (count_tokens API) — no upfront cost estimation
- **CAP-074** OpenTelemetry / Langfuse cost observability — no telemetry plumbing
- **CAP-079** WSL2 spawn strategy — only local, docker, ssh backends present
- **CAP-097** Tailscale Serve HTTPS config — no serve.json, no auto-TLS plumbing
- **CAP-104** Competitive landscape document — no docs/market/ directory

## Extend / refactor (partial, <50%)

Infrastructure exists but the feature is not end-to-end.

### Session lifecycle

- **CAP-010** Session tags column + filter UI — migration missing
- **CAP-011** Session timeout + max cost enforcement — timeout sweeper exists but cost-based termination not wired
- **CAP-012** Retry policy + backoff — structure exists, backoff math and re-queue incomplete
- **CAP-015** Audit log — some mutation tracking but no dedicated table

### Approvals

- **CAP-022** Risk classifier — basic pattern matching only, no low/medium/high/critical assignment
- **CAP-025** SDK canUseTool bridge — no long-poll path; SDK/headless sessions bypass hub approvals
- **CAP-028** Approve-and-Remember rule creation — no rule preview flow, no created_from_approval_id linkage
- **CAP-030** AskUserQuestion dialog UI — no chat-style dialog component
- **CAP-031** MCP elicitation dialog UI — no JSON-Schema form renderer
- **CAP-033** Notification batching + risk escalation — no 5s batching window, no escalation rules
- **CAP-042** In-session approval banner — no sticky banner on session view

### Dashboard

- **CAP-035** Machine cards with conditions + sparklines — card exists but conditions/sparklines not rendered
- **CAP-038** Status indicator visual system — Carbon pattern partially adopted; inconsistent across views

### Workforce & GitHub

- **CAP-050** Workspace manager TTL cleanup — provisioner exists, sweeper incomplete
- **CAP-053** Pre-flight / post-flight checks — partial pre-flight, post-flight absent
- **CAP-055** Batch job launcher — single-repo only, multi-repo orchestration missing
- **CAP-056** Workspace/git status WS messages — schemas exist but not wired end-to-end (see CR-HI-01 in backed-up review)
- **CAP-059** Tailscale Funnel webhook provisioning — no provisioning automation
- **CAP-062** GitHub Checks API reporting — partial create; no in_progress → completed lifecycle

### Cost tracking

- **CAP-069** Pricing table + formula — table present, long-context + cache multipliers incomplete
- **CAP-070** Per-query budget enforcement — maxBudgetUsd not plumbed to SDK call sites
- **CAP-071** Daily/monthly budget thresholds — aggregation present, notifications not integrated
- **CAP-075** Machine metrics collection + time-series — heartbeat partial; no retention window

### Docker sandbox

- **CAP-082** Restricted Docker network with HTTP allowlist proxy — no proxy container, no allowlist
- **CAP-084** Pre-pull Claude Code image on agent startup — not enforced
- **CAP-089** Async setup commands in temporary container — partial, no extended timeout path

### Deployment

- **CAP-047** Recordings volume retention — no volume limit enforcement
- **CAP-096** Docker Compose with Tailscale sidecar — simple compose only, no sidecar service
- **CAP-099** Docker secrets for API keys — no secrets: block in compose
- **CAP-100** SQLite backup strategy — no cron script, no Litestream sidecar

## Implemented (≥50% coverage, needs polish to reach complete)

These capabilities already exist end-to-end but are missing acceptance criteria on visual polish, edge cases, or full coverage of the spec. They are candidates for a "completeness sweep" sprint rather than new feature work.

Sessions: CAP-006, 007, 008, 009, 017, 018, 019, 020
Approvals: CAP-021, 023, 024, 026, 027, 029, 032, 041
Dashboard: CAP-034, 036, 037, 039, 063, 064, 065, 066, 067, 073
Workforce: CAP-045, 046, 048, 049, 051, 052, 054, 058, 060, 061
Docker: CAP-076, 077, 078, 080, 081, 083, 085, 086, 087, 088, 090, 091, 092
Deploy: CAP-093, 094, 095, 098, 101, 102, 103
Schedules/templates: CAP-043, 044

## Complete (no further work)

- CAP-001 Monorepo scaffolding
- CAP-002 Shared types + Zod schemas
- CAP-003 Node 20+ / Fastify 5.x lock
- CAP-004 Hub core server
- CAP-005 Agent daemon core
- CAP-040 xterm.js v6 scoped package migration

## Infrastructure gaps (cross-cutting)

- No `docs/market/` directory → CAP-104 (competitive landscape)
- No `@anthropic-ai/tokenizer` dependency → CAP-072 (token counter fallback)
- No OpenTelemetry / Langfuse client dependencies → CAP-074
- No `tailscale/tailscale` service in any compose variant → CAP-096, CAP-097
- No `litestream/litestream` service in any compose variant → CAP-100
- No restricted Docker network + proxy image → CAP-082

## Cross-reference to outstanding review findings

The backed-up 2026-03-16 codebase review (`docs/roadmap.bak.20260409/CODEBASE_REVIEW_2_2026-03-16.md`) has 1 critical + 13 high findings unresolved. Several block capabilities above:

- **HI-01** Approval/workforce messages missing from discriminatedUnion schemas → blocks CAP-056 (workspace/git WS messages end-to-end) and the SDK bridge CAP-025
- **HI-03** Approval message schemas missing from shared/browser.ts → blocks dashboard approval integration polish on CAP-026, CAP-041
- **HI-04** Replay terminal never initializes (v-else lifecycle bug) → blocks CAP-046 from reaching complete
- **HI-05** Connection status hardcoded "Connected" → blocks CAP-034 / CAP-039 polish

These findings should be folded into the roadmap phase plan rather than tracked as separate work.
