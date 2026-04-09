# Implementation Roadmap Summary

**Generated**: 2026-04-09
**Mode**: full (overwrite; prior roadmap backed up to `docs/roadmap.bak.20260409/`)
**Stack**: pnpm workspaces + Turborepo + TypeScript, Fastify/better-sqlite3/node-pty backend, Nuxt 3 + Vuetify 3 + xterm.js frontend, Vitest tests, Docker Compose deployment with Tailscale
**Research Documents**: 7
**Capabilities Extracted**: 104
**Domains Identified**: 15
**Phases Planned**: 9 (R1..R9)
**Epics Generated**: 9 (one per phase, each bundling workstreams as stories)
**Estimated Total Stories**: 74

## What's different about this refresh

ClaudeHQ is a brownfield project: sprints 001–011 have already shipped, the codebase passes type-check/lint/tests/build, and the prior roadmap (`docs/roadmap.bak.20260409/_EPIC_REGISTRY.json`) covered 41+ epics across 8 phases. This refresh:

- Re-extracts capabilities from all 7 research docs into a single normalized index (`capability-index.json`)
- Re-assesses the current codebase against those capabilities (`gap-analysis.md`)
- Replaces the former 8-phase build plan with 9 finish-oriented **R-phases** that target the remaining work, not a fresh greenfield ramp
- Collapses per-phase workstreams into 9 consolidated epics so the tracker stays readable

## Phase Overview

| Phase | Name                                     | Epic | Stories | Capabilities | Key Deliverables                                                                                     |
| ----- | ---------------------------------------- | ---- | ------: | -----------: | ---------------------------------------------------------------------------------------------------- |
| R1    | Stability & Foundations Finish           | E001 |       8 |            4 | 4 review blockers fixed, audit_log, machine_metrics, session tags, risk classifier                   |
| R2    | Approvals & Notifications Completeness   | E002 |      12 |            8 | SDK canUseTool bridge, three-way decision, dialog UIs, browser/ntfy notifications, in-session banner |
| R3    | Scheduler & Session Lifecycle Completion | E003 |       9 |            6 | Machine capabilities, auto-scheduler, timeout/cost enforcement, retry, dual-stream parsing           |
| R4    | Cost Tracking & Budgets                  | E004 |       8 |            6 | Pricing formula, per-query budget, period thresholds, token estimator, cost dashboard polish, OTel   |
| R5    | Workforce Completeness                   | E005 |       9 |            6 | Workspace TTL, pre/post-flight, batch launcher, workspace/git WS wiring, Checks API                  |
| R6    | GitHub Setup Wizard & Rotation           | E006 |       7 |            5 | Manifest flow wizard, PAT fallback, Tailscale Funnel, @octokit/auth-app, PR lifecycle                |
| R7    | Docker Sandbox Hardening                 | E007 |       8 |            6 | Restricted network, security baseline, pre-pull, container stats, WSL2 spawn, async setup            |
| R8    | Deployment & Operations                  | E008 |       7 |            5 | Tailscale sidecar + Serve HTTPS, Docker secrets, SQLite backup, recordings retention                 |
| R9    | Completeness Sweep & Docs                | E009 |       6 |            3 | Status indicator system, machine sparklines, competitive landscape doc, residual AC sweep            |

## Domain Map

| Domain                   | Capabilities | Primary Phase(s)           |
| ------------------------ | -----------: | -------------------------- |
| foundation               |            5 | already complete           |
| session-lifecycle        |           11 | R1, R3                     |
| hooks-and-approvals      |           12 | R1, R2                     |
| notifications            |            2 | R2                         |
| dashboard-core           |           11 | R1, R2, R9                 |
| templates-and-scheduling |            2 | completeness sweep         |
| recording-and-replay     |            3 | R8, completeness sweep     |
| workforce                |            9 | R5                         |
| github-integration       |            6 | R5, R6                     |
| workforce-dashboard      |            5 | completeness sweep         |
| cost-tracking            |            7 | R4                         |
| observability            |            3 | R1                         |
| docker-sandbox           |           16 | R3, R7, completeness sweep |
| deploy-infra             |           11 | R8, completeness sweep     |
| docs                     |            1 | R9                         |

## Critical Path

R1 → R2 → R3 → R4 → R5 → R6 → R8 → R9, with R7 running in parallel from R3 onward.

Critical chain rationale:

- R1 unblocks everything via protocol cleanup, metrics store, and risk classifier
- R2 and R3 can run in parallel after R1 completes; both feed R4
- R5 depends on R1's protocol fix but not on R2/R3
- R6 depends on R5's PR lifecycle polish
- R7 depends on R3's dual-stream parser alignment; otherwise independent of R4/R5/R6
- R8 depends on R6's Tailscale Funnel URL wiring
- R9 depends on all prior phases (final sweep)

## Parallel Workstreams

```
R1 ─┬─> R2 ─┬─> R4 ─┬──────────────────────> R9
    │       │       │
    ├─> R3 ─┼─> R7 ─┤
    │       │       │
    └─> R5 ─┴─> R6 ─> R8 ─────────────────────┘
```

- **After R1**: R2, R3, and R5 can all start in parallel (different domains, different files)
- **After R3**: R4 and R7 can run in parallel with R5/R6
- **R6 → R8** is a hard ordering (Tailscale Funnel URL)
- **R9** is the serial final sweep

## Open Questions

Carried forward from research-cache gap notes; resolve during the owning epic:

1. **CAP-076** (spawn abstraction) — `spawnClaudeCodeProcess` as an SDK option is unverified in Context7. The epic plan treats it as an agent-level abstraction layer over `child_process.spawn`, not an SDK option. Revisit if the SDK adds it later.
2. **CAP-082** — tinyproxy vs Squid for the allowlist proxy. Plan: start with tinyproxy; Squid only if logging/caching is needed later.
3. **CAP-100** — Litestream compose config not yet verified. Plan: use the official image behind a compose profile; document example for S3.
4. **CAP-087** — Docker stats CPU% math needs the documented delta formula in the research cache; easy to get wrong.
5. **CAP-074** — Langfuse vs Helicone for cost observability. Plan: abstract behind a client interface; pick during the sprint.

## Risk Register

| Risk                                                                 | Impact   | Likelihood | Mitigation                                                                                                 |
| -------------------------------------------------------------------- | -------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| Protocol cleanup surfaces additional schema drift beyond HI-01       | Medium   | Medium     | Budget +1 point in E001 for discovery; run a full `schema.parse()` test over recorded messages             |
| SDK `canUseTool` long-poll bridge has subtle reconnection bugs       | High     | Medium     | Use `toolUseID` as idempotency key; integration test with forced disconnects                               |
| Cost formula drifts as Anthropic updates pricing                     | Medium   | High       | Pricing module has header comment linking to the update process; contract test against SDK's reported cost |
| Container sandbox fails-open on a missing security field             | Critical | Low        | Spec validator inspects running container and asserts parity; CI test                                      |
| Tailscale Funnel unavailable on operator plan                        | Medium   | Medium     | PAT fallback path (CAP-058) shipped alongside; wizard detects and recommends                               |
| Completeness sweep (E009) uncovers more residual work than estimated | Medium   | High       | E009 is the last phase; overrun is acceptable as long as it's scoped strictly to existing capabilities     |

## Artifacts

- `capability-index.json` — 104 capabilities extracted from research
- `research-cache.json` — targeted Context7 findings + gap flags
- `gap-analysis.md` — current codebase state per capability
- `domain-index.json` — 15 domain clusters
- `phase-plan.json` — 9 R-phases with entry/exit criteria and parallelism notes
- `cross-cutting/notes.md` — system-wide decisions (auth, errors, testing, monitoring, security)
- `epics/E001..E009` — implementation epics
- `_EPIC_REGISTRY.json` — flat registry indexing all epics
- `tracker.md` — progress tracker
- `manifest.json` — pointer to every generated artifact
