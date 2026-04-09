---
id: E009
title: 'Completeness Sweep & Docs'
phase: R9
domain: 'dashboard-core, docs'
capabilities: ['CAP-035', 'CAP-038', 'CAP-104']
status: planned
depends_on: ['E001', 'E002', 'E003', 'E004', 'E005', 'E006', 'E007', 'E008']
estimated_stories: 6
---

# Completeness Sweep & Docs

## Description

Final polish phase. Ship the status indicator visual system consistently across all views, finish machine cards (conditions + sparklines), write the competitive landscape document, and run a sweep over every "implemented" capability from the gap analysis to close the residual acceptance criteria.

## Capabilities Addressed

| ID      | Coverage                                                                                                                                                                      |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CAP-035 | Machine card renders health conditions, session slot progress bar, queue depth badge, CPU/memory sparklines for last 30min                                                    |
| CAP-038 | Shared `StatusIndicator.vue` adopted everywhere a session/machine/job status is shown. Carbon pattern (color + icon + text) with prefers-reduced-motion for pulsing animation |
| CAP-104 | `docs/market/competitive-landscape.md` comparing claudeHQ to OpenClaw, runCLAUDErun, manual Claude Code, standalone Claude                                                    |

## Acceptance Criteria

1. `StatusIndicator.vue` exists in `packages/dashboard/app/components/` and is used in the session list, session detail header, activity feed, machine card status, and job list. Seven states supported: Queued, Blocked, Running, Waiting for Input, Completed, Failed, Cancelled.
2. Color contrast ratios meet WCAG AA. Pulsing animation for Running state respects `prefers-reduced-motion`.
3. Machine card shows conditions derived from heartbeat metrics (Ready, NotReady, MemoryPressure, DiskPressure, SessionPressure). Session slots shown as progress bar. Queue depth as badge. CPU and memory sparklines render last 30 minutes from the `machine_metrics` store (CAP-075, delivered in E001).
4. `docs/market/competitive-landscape.md` exists with a comparison table and a differentiator section. Linked from `README.md`.
5. A fresh Phase-2 re-assessment (either manual or via `/blitz:roadmap refresh`) returns `status: complete` for every capability previously marked `implemented` in the 2026-04-09 gap analysis.
6. Fresh `blitz:sprint-review` returns no P1 findings.

## Technical Approach

- `StatusIndicator.vue` takes `status` + `size` props. Tokens for color/icon/text derived from a single map. Pulsing is a CSS animation gated on `@media (prefers-reduced-motion: no-preference)`.
- Sparklines use Vuetify's `VSparkline` component (already in the project) wired to the machine_metrics query endpoint.
- Conditions logic is a pure function `deriveConditions(metrics: MachineMetrics): MachineCondition[]` in `packages/dashboard/app/composables/useMachineConditions.ts`.
- Completeness sweep runs `blitz:completeness-gate` and the blitz reviewer agent over each "implemented" capability's acceptance criteria from the gap analysis. Any failing criterion becomes a story.
- Competitive landscape doc is research-derived — no new investigation needed; the docs-audit research already has the content.

## Stories (Outline)

1. **StatusIndicator.vue shared component + Carbon token map.** (Points: 3)
2. **StatusIndicator rollout across all consumers.** (Points: 3)
3. **useMachineConditions composable + sparklines.** (Points: 3)
4. **Competitive landscape doc.** (Points: 2)
5. **Completeness sweep: discover residual ACs.** (Points: 3)
6. **Completeness sweep: resolve residual ACs.** (Points: 5)

## Dependencies

- **Requires**: All prior R-phases (R1 delivers machine_metrics; R2 delivers status-bearing approval banner; etc.)
- **Enables**: 100% capability coverage and a clean roadmap for the next generation

## Risk Factors

- The completeness sweep may surface more residual work than estimated. Budget +3 points for unknowns.
- Sparkline data volume: 30 minutes at 30s heartbeats = 60 points. Well within sparkline rendering limits.
- Do not let the "final polish" epic become a grab-bag for everyone's pet issue; scope strictly to capabilities already in the index.
