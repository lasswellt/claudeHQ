---
name: phase-plan
description: |
  Architecture-driven planning. Reads architecture doc, extracts implementation
  phases, generates epic registry with dependencies and capabilities.
  Use when: "plan phases", "generate epics", "create roadmap", "what to build"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, SendMessage, TeamCreate, WebSearch, WebFetch, ToolSearch
model: opus
---

# Phase Plan: Architecture-Driven Epic Generation

Transform the claudeHQ architecture document into a structured, executable
roadmap with epics, dependencies, and capability inventory.

## Phase 0: CONTEXT

Load existing project state to avoid duplicate work and understand current progress.

1. Read `docs/_context/registry.json` -- check for:
   - Existing epics and their statuses
   - Active sprint context
   - Completed phases
2. Read `docs/_context/research-index.json` -- check for:
   - Previous research findings relevant to planning
   - Library compatibility notes
   - Architecture decisions already made
3. If either file does not exist, note it and continue (first run).

## Phase 1: PARSE

Extract the full implementation plan from architecture documentation.

1. Read `docs/claude-hq-architecture.md` -- the primary source of truth.
2. Read `docs/claude-hq-validation-report.md` -- validation constraints and requirements.
3. Extract exactly **4 implementation phases** from the architecture doc:
   - **Phase 1: Foundation** -- Monorepo, shared types, protocol, basic agent daemon
   - **Phase 2: Core** -- Hub server, WebSocket relay, session management, SQLite persistence
   - **Phase 3: Dashboard** -- Nuxt 3 app, Vuetify UI, xterm.js terminals, live views
   - **Phase 4: Polish** -- Queue management, replay, multi-session grid, notifications, Tailscale auth
4. For each phase, enumerate every component and feature:
   - Map each feature to a package: `agent`, `hub`, `dashboard`, or `shared`
   - Identify cross-package dependencies (e.g., shared protocol types must exist before agent can use them)
   - Note external library requirements per feature
5. Build a feature matrix:

   ```
   Feature                  | Package    | Phase | Dependencies
   -------------------------|------------|-------|-------------
   Zod protocol schemas     | shared     | 1     | none
   TypeScript type inference | shared     | 1     | protocol schemas
   PTY session manager      | agent      | 1     | node-pty, shared types
   Agent daemon             | agent      | 1     | PTY manager
   ...
   ```

## Phase 2: RESEARCH

Spawn 2-3 named research agents to gather implementation intelligence in parallel.

### Agent: library-researcher

**Purpose:** Verify library compatibility, find latest patterns, identify gotchas.

**Tasks:**
1. Query Context7 (via `mcp__plugin_context7_context7__resolve-library-id` and
   `mcp__plugin_context7_context7__query-docs`) for each core dependency:
   - `node-pty` -- API surface, platform-specific builds, spawn options
   - `fastify` -- Plugin architecture, WebSocket upgrade handling, hooks
   - `xterm.js` -- Addons (fit, webgl, search), attach API, serialization
   - `better-sqlite3` -- WAL mode, prepared statements, migration patterns
   - `ws` -- Server creation, message handling, binary frames, heartbeat
   - `@vuetify/extras` + `vuetify` -- Nuxt integration, component catalog, theming
   - `nuxt` -- Module system, server routes, runtime config, SSR considerations
2. WebSearch for:
   - "node-pty fastify integration 2025" -- PTY over WebSocket patterns
   - "xterm.js fit addon resize handling" -- terminal resize best practices
   - "nuxt 3 vuetify framework setup" -- integration patterns
   - "better-sqlite3 WAL migration pattern" -- database setup
3. Compile findings into structured notes per library:
   - Version to target
   - Key API patterns to use
   - Known issues or platform constraints
   - Integration examples

### Agent: codebase-analyst

**Purpose:** Understand what already exists in the codebase.

**Tasks:**
1. Search for existing package.json files, tsconfig files, source code
2. Inventory existing code:
   - Which packages exist and what is in them
   - Existing type definitions, interfaces, schemas
   - Test infrastructure (vitest config, test files)
   - Build configuration (turbo.json, tsup, etc.)
3. Check for patterns already established:
   - Import style (path aliases, relative imports)
   - Error handling patterns
   - Logging approach
   - Configuration management
4. Identify gaps between architecture doc and current implementation

### Agent: infra-researcher (optional, spawn if Phase 4 epics are in scope)

**Purpose:** Research deployment and infrastructure concerns.

**Tasks:**
1. Tailscale integration patterns:
   - `tailscale status --json` output format
   - Tailscale ACL tag-based access control
   - Tailscale Funnel vs direct MagicDNS access
2. systemd service file patterns:
   - Node.js daemon service files
   - Watchdog integration
   - Journal logging
   - Restart policies
3. node-pty platform compatibility:
   - Linux (primary target) -- build requirements
   - macOS support considerations
   - Windows/WSL2 constraints

### Synthesis

After all agents report back:
1. Merge findings into a unified research summary
2. Flag any conflicts between architecture plan and library capabilities
3. Note version constraints or compatibility issues
4. Identify any architecture adjustments needed

## Phase 3: GENERATE

Create the epic registry and supporting documents.

### Epic Registry: `docs/roadmap/_EPIC_REGISTRY.json`

Generate a JSON file containing all epics:

```json
{
  "$schema": "epic-registry-v1",
  "generated": "ISO-8601 timestamp",
  "phases": [
    {
      "id": "PHASE-1",
      "name": "Foundation",
      "description": "Monorepo structure, shared types, protocol layer, basic agent",
      "epics": ["EPIC-001", "EPIC-002", "EPIC-003", "EPIC-004"]
    }
  ],
  "epics": [
    {
      "id": "EPIC-001",
      "phase": "PHASE-1",
      "title": "Monorepo & Build Infrastructure",
      "description": "pnpm workspace, turbo pipeline, shared tsconfig, vitest setup",
      "package": "root",
      "status": "planned",
      "priority": "critical",
      "dependencies": [],
      "capabilities": ["build", "test", "lint"],
      "stories": [],
      "estimatedComplexity": "medium",
      "acceptanceCriteria": [
        "pnpm workspace resolves all packages",
        "turbo build succeeds for all packages",
        "vitest runs with shared config",
        "TypeScript strict mode enabled"
      ]
    }
  ],
  "capabilities": {
    "build": { "description": "Project builds successfully", "epics": ["EPIC-001"] },
    "protocol": { "description": "WebSocket message types defined", "epics": ["EPIC-002"] }
  }
}
```

**Epic naming convention:** `EPIC-NNN` where NNN is zero-padded 3 digits.

**Required epics (minimum, expand based on architecture doc):**

Phase 1 -- Foundation:
- EPIC-001: Monorepo & Build Infrastructure
- EPIC-002: Shared Protocol Types (Zod schemas, TS types)
- EPIC-003: Agent PTY Manager (node-pty wrapper, session lifecycle)
- EPIC-004: Agent Daemon Core (process management, config, logging)

Phase 2 -- Core:
- EPIC-005: Hub Server Foundation (Fastify, plugins, config)
- EPIC-006: Hub SQLite Database (schema, migrations, DAL)
- EPIC-007: Hub WebSocket Relay (ws server, message routing)
- EPIC-008: Hub Session Manager (state machine, agent coordination)
- EPIC-009: Agent-Hub Integration (registration, heartbeat, reconnect)

Phase 3 -- Dashboard:
- EPIC-010: Dashboard Foundation (Nuxt 3, Vuetify, layout)
- EPIC-011: Dashboard WebSocket Client (composable, reconnect, state sync)
- EPIC-012: Dashboard Terminal Views (xterm.js, fit/webgl addons)
- EPIC-013: Dashboard Session & Machine Pages (list, detail, status)

Phase 4 -- Polish:
- EPIC-014: Queue Management (cross-machine queue, priority, reorder)
- EPIC-015: Session Replay (recording, timeline, playback)
- EPIC-016: Multi-Session Grid (2x2/1x4 layout, synchronized scroll)
- EPIC-017: Notifications & Alerts (WebSocket push, Vuetify QNotify)
- EPIC-018: Tailscale Auth & Security (ACL, machine identity)

### Dependency Graph: `docs/roadmap/_DEPENDENCY_GRAPH.md`

Generate a Mermaid dependency graph:

```markdown
# Epic Dependency Graph

## Full Dependency Chain

graph TD
    EPIC-001[Monorepo & Build] --> EPIC-002[Shared Protocol]
    EPIC-001 --> EPIC-003[Agent PTY]
    EPIC-001 --> EPIC-004[Agent Daemon]
    EPIC-002 --> EPIC-003
    EPIC-002 --> EPIC-005[Hub Server]
    ...

## Critical Path

The longest dependency chain determines minimum implementation time.

## Parallelization Opportunities

Epics that can be worked on simultaneously after their dependencies are met.
```

### Individual Epic Documents: `docs/roadmap/epics/EPIC-NNN_title.md`

For each epic, generate a detailed document:

```markdown
# EPIC-NNN: Title

## Overview
- **Phase:** PHASE-N
- **Package:** agent | hub | dashboard | shared
- **Status:** planned
- **Priority:** critical | high | medium | low
- **Dependencies:** EPIC-XXX, EPIC-YYY

## Description

Detailed description of what this epic accomplishes and why it matters.

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Technical Notes

Key implementation details, library-specific notes, patterns to follow.

## Stories (to be generated by sprint-plan)

Stories will be created when this epic enters a sprint.

## Research References

Links to relevant research findings from Phase 2.
```

## Phase 4: REPORT

Present a comprehensive planning summary:

1. **Phase Overview** -- Table of phases with epic counts and estimated complexity
2. **Critical Path** -- The longest dependency chain and its implications
3. **Parallelization** -- Which epics can be worked simultaneously
4. **Risk Register** -- Technical risks identified during research
5. **Capability Map** -- What the system can do after each phase completes
6. **Recommended First Sprint** -- Suggest which epics to tackle first

Suggest next step: `/sprint-plan` to break the first set of epics into stories.

## Phase Final: REGISTER

Update project context files:

1. **Update `docs/_context/research-index.json`:**
   - Add entries for all research performed in Phase 2
   - Include library versions, key findings, timestamps

2. **Update `docs/_context/registry.json`:**
   - Set `activeContext.currentPhase` to "PHASE-1"
   - Add all epic IDs to the epic registry section
   - Record this planning session's timestamp and outcome

3. **Log execution:**
   - Record skill invocation in registry
   - Note any issues or deviations from expected output
