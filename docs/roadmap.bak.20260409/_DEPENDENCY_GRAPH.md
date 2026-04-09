# Epic Dependency Graph

## Full Dependency Chain

```mermaid
graph TD
    EPIC-001[001: Monorepo & Build] --> EPIC-002[002: Shared Protocol]
    EPIC-001 --> EPIC-003[003: Agent PTY]
    EPIC-001 --> EPIC-006[006: Hub Server]
    EPIC-001 --> EPIC-011[011: Dashboard Foundation]

    EPIC-002 --> EPIC-003
    EPIC-002 --> EPIC-004[004: Agent Daemon & CLI]
    EPIC-002 --> EPIC-006
    EPIC-002 --> EPIC-008[008: Hub WS Relay]
    EPIC-002 --> EPIC-012[012: Dashboard WS Client]
    EPIC-002 --> EPIC-016[016: Approval System]

    EPIC-003 --> EPIC-004
    EPIC-003 --> EPIC-005[005: Agent Recording]
    EPIC-003 --> EPIC-020[020: Session Resume]

    EPIC-004 --> EPIC-019[019: Queue Management]
    EPIC-004 --> EPIC-029[029: Workspace Manager]
    EPIC-004 --> EPIC-032[032: Agent Git Ops]
    EPIC-004 --> EPIC-040[040: Docker Execution]

    EPIC-005 --> EPIC-025[025: Secret Scrub + Retention]

    EPIC-006 --> EPIC-007[007: Hub SQLite]
    EPIC-006 --> EPIC-011
    EPIC-006 --> EPIC-033[033: GitHub App]

    EPIC-007 --> EPIC-008
    EPIC-007 --> EPIC-009[009: Hub REST API]
    EPIC-007 --> EPIC-010[010: Hook Receiver + Recordings]
    EPIC-007 --> EPIC-022[022: Enhanced Schema]
    EPIC-007 --> EPIC-028[028: Repo Registry]

    EPIC-008 --> EPIC-009
    EPIC-008 --> EPIC-010
    EPIC-008 --> EPIC-015[015: Hub Dashboard WS]
    EPIC-008 --> EPIC-026[026: Health Charts]

    EPIC-009 --> EPIC-019
    EPIC-009 --> EPIC-020
    EPIC-009 --> EPIC-021[021: Templates]
    EPIC-009 --> EPIC-028

    EPIC-010 --> EPIC-016
    EPIC-010 --> EPIC-017[017: Notification Engine]
    EPIC-010 --> EPIC-018[018: Replay Player]
    EPIC-010 --> EPIC-025

    EPIC-011 --> EPIC-012

    EPIC-012 --> EPIC-013[013: Terminal View]

    EPIC-013 --> EPIC-014[014: Session & Machine Pages]
    EPIC-013 --> EPIC-018
    EPIC-013 --> EPIC-023[023: Multi-Session Grid]

    EPIC-014 --> EPIC-016
    EPIC-014 --> EPIC-019
    EPIC-014 --> EPIC-020
    EPIC-014 --> EPIC-021
    EPIC-014 --> EPIC-024[024: Cross-Machine Queue + Search]
    EPIC-014 --> EPIC-026
    EPIC-014 --> EPIC-031[031: Workforce Dashboard Views]

    EPIC-015 --> EPIC-017

    EPIC-017 --> EPIC-027[027: Rich Notifications]

    EPIC-022 --> EPIC-030[030: Job Model]
    EPIC-022 --> EPIC-036[036: Auto-Scheduling]
    EPIC-022 --> EPIC-037[037: Batch Jobs + Costs]

    EPIC-028 --> EPIC-029
    EPIC-028 --> EPIC-030

    EPIC-029 --> EPIC-030
    EPIC-029 --> EPIC-040

    EPIC-030 --> EPIC-031
    EPIC-030 --> EPIC-034[034: GitHub PR Lifecycle]
    EPIC-030 --> EPIC-036
    EPIC-030 --> EPIC-037
    EPIC-030 --> EPIC-038[038: Scheduled Tasks]
    EPIC-030 --> EPIC-039[039: Job Deps + Retry]

    EPIC-033 --> EPIC-034

    EPIC-034 --> EPIC-035[035: Issue Linking]

    EPIC-040 --> EPIC-041[041: Devcontainer + Cloud]

    style EPIC-001 fill:#e74c3c,color:#fff
    style EPIC-002 fill:#e74c3c,color:#fff
    style EPIC-003 fill:#e74c3c,color:#fff
    style EPIC-006 fill:#e74c3c,color:#fff
    style EPIC-007 fill:#e74c3c,color:#fff
    style EPIC-008 fill:#e74c3c,color:#fff
```

## Critical Path

The longest dependency chain determines the minimum sequential work:

```
EPIC-001 → EPIC-002 → EPIC-008 → EPIC-009 → EPIC-028 → EPIC-029 → EPIC-030 → EPIC-034
  (build)   (types)    (ws relay)  (rest api)  (repos)    (workspaces) (jobs)    (github prs)
```

8 epics deep. Phase 1 has the most critical-path items (6 of the first 8).

## Parallelization Opportunities

### Phase 1 — After EPIC-001 + EPIC-002 complete:
- **Parallel track A:** EPIC-003 → EPIC-004 → EPIC-005 (Agent track)
- **Parallel track B:** EPIC-006 → EPIC-007 → EPIC-008 → EPIC-009 → EPIC-010 (Hub track)
- These two tracks are independent until EPIC-009 needs to send commands to agents

### Phase 2 — After Phase 1 core + EPIC-011:
- **Parallel track C:** EPIC-012 → EPIC-013 → EPIC-014 (Dashboard UI track)
- **Parallel track D:** EPIC-015 → EPIC-017 (Hub dashboard WS + notifications)
- **EPIC-016** (Approvals) needs both tracks to converge

### Phases 3-4 — High parallelism:
- EPIC-018 (Replay), EPIC-019 (Queue), EPIC-020 (Resume), EPIC-021 (Templates) are all independent

### Phases 5-8 — Sequential core with parallel extensions:
- EPIC-028 → EPIC-029 → EPIC-030 is sequential (repos → workspaces → jobs)
- After EPIC-030: EPIC-034, EPIC-036, EPIC-037, EPIC-038, EPIC-039 are all parallel
