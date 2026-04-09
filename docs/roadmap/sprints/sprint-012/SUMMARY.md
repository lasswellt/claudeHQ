# Sprint 012 — E001 Stability & Foundations Finish

- **Phase**: R1
- **Epic**: E001 — Stability & Foundations Finish
- **Status**: planned
- **Created**: 2026-04-08
- **Stories**: 8 / **Points**: 26

## Dependency Graph

```
012-001 (protocol cleanup)  ──┬── 012-003 (session tags API) ── 012-004 (tags UI)
                              ├── 012-005 (machine metrics)
                              ├── 012-006 (audit log)
                              └── 012-007 (risk classifier)

012-002 (dashboard fixes) — independent

012-008 (R1 exit sweep) — blocks on all of the above
```

## Story Index

| ID      | Title                                                   | Points | Assignee     |
| ------- | ------------------------------------------------------- | ------ | ------------ |
| 012-001 | Wire approval + workforce schemas into unions (HI-01/3) | 3      | backend-dev  |
| 012-002 | Fix replay container + connection chip (HI-04/5)        | 2      | frontend-dev |
| 012-003 | sessions.tags column + API                              | 3      | backend-dev  |
| 012-004 | Session tags filter UI                                  | 3      | frontend-dev |
| 012-005 | machine_metrics table + heartbeat ingestion             | 5      | backend-dev  |
| 012-006 | audit_log table + DAL wiring                            | 5      | backend-dev  |
| 012-007 | Approvals risk classifier                               | 3      | backend-dev  |
| 012-008 | R1 exit quality sweep                                   | 2      | test-writer  |

## Capabilities Advanced

- **CAP-010** — session tags end-to-end (schema, API, UI)
- **CAP-015** — audit log table + DAL + routes
- **CAP-022** — risk classifier module
- **CAP-075** — machine metrics time-series + retention

## Review Findings Resolved

- **HI-01** — approval + workforce schemas now members of discriminated unions
- **HI-03** — approval message schemas re-exported from browser.ts
- **HI-04** — replay.vue renders terminal container unconditionally via v-show
- **HI-05** — dashboard connection chip binds to real WsState

## Notes

- `docs/roadmap/sprints/sprint-011/` is an orphaned draft from before the 2026-04-09 brownfield roadmap refresh; its REVIEW-FIX stories targeted the old critical shell-injection findings and will be carried into **E007 Docker Sandbox Hardening** (phase R7).
- Total carry-forward to sprint-013: none.
