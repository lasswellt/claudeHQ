---
name: sprint-plan
description: |
  Autonomous sprint planner. Reads epic registry, dependency graph. Selects next
  unblocked batch. Generates implementation stories with research-backed specs.
  Use when: "plan next sprint", "generate stories", "create sprint"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, SendMessage, TeamCreate, WebSearch, WebFetch, ToolSearch
model: opus
---

# Sprint Plan Skill

Autonomous sprint planning for the claudeHQ project. Reads the epic registry, topologically sorts by dependencies, selects the next unblocked batch, spawns research agents, and produces implementation stories with research-backed specifications.

---

## Phase 0: CONTEXT

Load all project planning context.

1. **Read planning files** (skip any that don't exist):
   - `docs/roadmap/epics/_EPIC_REGISTRY.json` — master list of epics with status, dependencies, and phase
   - `docs/_research/research-index.json` — prior research documents
   - `.claude/shared/codebase-inventory.json` — current codebase state, file map, module boundaries
   - `.claude/shared/registry.json` — cross-skill state, last sprint info

2. **Read architecture docs:**
   - `docs/claude-hq-architecture.md` — system architecture, component responsibilities
   - `docs/claude-hq-validation-report.md` — architecture validation findings and recommendations

3. **Identify package scopes:** agent, hub, dashboard, shared, protocol — all under `packages/`.

4. **Note key libraries to research (via Context7):**
   - `node-pty` — PTY spawning, platform compatibility
   - `fastify` — HTTP server, plugins, WebSocket integration
   - `xterm` (xterm.js) — terminal emulator, addons
   - `better-sqlite3` — SQLite bindings, query patterns
   - `ws` — WebSocket client/server
   - `vuetify` — UI components for Nuxt 3
   - `zod` — schema validation
   - `pinia` — state management

---

## Phase 1: INITIALIZE

Set up the sprint context.

1. **Topological sort of epics:**
   - Read all epics from `_EPIC_REGISTRY.json`
   - Build a dependency graph from each epic's `dependencies` array
   - Identify epics with status `ready` or `in-progress` that have all dependencies satisfied (status `complete`)
   - These form the **unblocked set** — candidates for this sprint

2. **Determine sprint number:**
   - Check `.claude/shared/registry.json` for `lastSprint.number`
   - Increment by 1 (or start at 1 if first sprint)
   - Sprint ID format: `sprint-NNN` (zero-padded to 3 digits)

3. **Create sprint directory:**
   ```
   docs/roadmap/sprints/sprint-NNN/
   ├── _SPRINT_META.json       # Sprint metadata (created in Phase 4)
   ├── stories/                # Individual story files
   │   ├── NNN-001.md
   │   ├── NNN-002.md
   │   └── ...
   └── research/               # Sprint-specific research (from Phase 2)
   ```

4. **GitHub sync:**
   - Check for existing GitHub milestone: `gh api repos/lasswellt/claudeHQ/milestones --jq '.[] | select(.title | startswith("Sprint"))'`
   - If no milestone exists for this sprint, create one:
     ```bash
     gh api repos/lasswellt/claudeHQ/milestones -f title="Sprint NNN" -f description="<sprint-description>"
     ```

---

## Phase 2: RESEARCH

Spawn 3-4 named research agents to gather implementation intelligence.

### Team Composition:

Create a team with `TeamCreate`:

**Agent A: Library Researcher**
- **Name:** `library-researcher`
- **Task:** For each epic in the unblocked set, research the primary libraries involved:
  - Use Context7 (`mcp__plugin_context7_context7__resolve-library-id` then `mcp__plugin_context7_context7__query-docs`) for official API documentation
  - Focus on: API surfaces needed, configuration patterns, version compatibility, known limitations
  - Targets by package:
    - Agent stories → research `node-pty`, `ws`, `commander`
    - Hub stories → research `fastify`, `@fastify/websocket`, `better-sqlite3`
    - Dashboard stories → research `xterm`, `vuetify`, `pinia`, `@nuxt/test-utils`
    - Shared stories → research `zod` schema patterns
- **Output:** Structured findings per library with API examples and gotchas.

**Agent B: Codebase Analyst**
- **Name:** `codebase-analyst`
- **Task:** Analyze the current codebase to understand:
  - What already exists that stories can build on
  - Module boundaries and integration points
  - Existing patterns to follow (coding style, error handling, naming)
  - Files that will need modification for each epic
- **Output:** Per-epic file impact analysis and pattern reference.

**Agent C: Web Researcher**
- **Name:** `web-researcher`
- **Task:** Search for:
  - Real-world implementation examples of similar systems
  - Performance benchmarks and scaling considerations
  - Common pitfalls and best practices for the technologies involved
  - Relevant GitHub issues or discussions in dependency repos
- **Output:** Curated findings with source URLs.

**Agent D: Infrastructure Analyst** (optional — include if sprint involves Tailscale, systemd, PTY platform concerns, or deployment)
- **Name:** `infra-analyst`
- **Task:** Research:
  - Tailscale ACL patterns for service-to-service communication
  - systemd unit file best practices for Node.js daemons
  - node-pty platform-specific behavior (Linux vs macOS vs WSL2)
  - Deployment and update strategies for multi-machine systems
- **Output:** Platform compatibility notes and deployment recommendations.

### Coordination:
- Send each agent its specific research questions based on the unblocked epics.
- Wait for all agents to complete.
- Collect and cross-reference findings.

---

## Phase 3: GENERATE STORIES

Produce 5-15 implementation stories per epic, informed by research.

### Story file format:

Each story is a markdown file at `docs/roadmap/sprints/sprint-NNN/stories/NNN-XXX.md`:

```markdown
---
id: NNN-XXX
title: "<Story Title>"
epic: "<epic-id>"
package: "<agent|hub|dashboard|shared|protocol>"
priority: <1-5>
points: <1|2|3|5|8>
dependencies: [<story-ids-this-depends-on>]
status: ready
assignee: "<agent-dev|hub-dev|dashboard-dev|test-writer>"
---

# NNN-XXX: <Story Title>

## Context
<1-2 paragraphs explaining why this story exists and how it fits into the epic>

## Requirements
1. <Specific requirement>
2. <Specific requirement>
...

## Acceptance Criteria
- [ ] <Testable criterion>
- [ ] <Testable criterion>
- [ ] Type check passes (`pnpm type-check`)
- [ ] Tests pass (`npx vitest run`)
- [ ] Build succeeds (`pnpm turbo build`)

## Technical Notes
<Implementation guidance from research, API references, patterns to follow>

## Files Likely Affected
- `packages/<pkg>/src/<file>.ts` — <what changes>
- ...

## Research References
- <Link to research document or external source>
```

### Story generation rules:

1. **One concern per story.** Each story should be implementable independently (given its dependencies are met).

2. **Dependency ordering:**
   - Shared type/schema stories come first (other stories depend on them)
   - Backend stories (agent, hub) before frontend stories (dashboard)
   - Core functionality before polish/enhancement

3. **Assignee mapping:**
   | Content Type | Assignee | Notes |
   |---|---|---|
   | Zod schemas, protocol types, shared utilities | agent-dev | Blocking — others depend on these |
   | Agent daemon, PTY, queue, recorder, WS client | agent-dev | After shared types |
   | Hub routes, DB schema, WS relay, notifications | hub-dev | After shared types |
   | Dashboard pages, components, composables, stores | dashboard-dev | After hub API exists |
   | Unit tests, integration tests | test-writer | After implementation |

4. **Points estimation:**
   - 1: Trivial (type definition, simple utility)
   - 2: Small (single function, simple component)
   - 3: Medium (module with multiple functions, component with state)
   - 5: Large (complex module, integration work)
   - 8: Very large (full subsystem, cross-package coordination)

5. **Include research findings** in Technical Notes. Don't just link — summarize the relevant API details, patterns, and gotchas.

---

## Phase 4: VALIDATE AND PUBLISH

Ensure stories are complete and publish them.

1. **Acceptance criteria coverage:** Every requirement in each story must have at least one acceptance criterion that validates it.

2. **Dependency graph validation:**
   - No circular dependencies between stories
   - All dependency references point to valid story IDs
   - Stories with no dependencies can start immediately

3. **Package partition check:** Verify that stories are well-distributed:
   - At least some shared/protocol stories if new types are needed
   - Agent and Hub stories roughly balanced
   - Dashboard stories exist for any new backend endpoints
   - Test stories cover the implemented functionality

4. **Write sprint summary** at `docs/roadmap/sprints/sprint-NNN/_SPRINT_META.json`:
   ```json
   {
     "sprintId": "sprint-NNN",
     "number": NNN,
     "createdDate": "YYYY-MM-DD",
     "epics": ["<epic-ids>"],
     "storyCount": N,
     "totalPoints": N,
     "breakdown": {
       "agent": { "stories": N, "points": N },
       "hub": { "stories": N, "points": N },
       "dashboard": { "stories": N, "points": N },
       "shared": { "stories": N, "points": N },
       "tests": { "stories": N, "points": N }
     },
     "status": "planned"
   }
   ```

5. **Create GitHub issues** for each story:
   ```bash
   gh issue create --repo lasswellt/claudeHQ \
     --title "NNN-XXX: <Story Title>" \
     --body "<story-content>" \
     --label "<package>" \
     --milestone "Sprint NNN"
   ```
   Record the GitHub issue number back in the story frontmatter.

6. **Commit the sprint plan:**
   ```bash
   git add docs/roadmap/sprints/sprint-NNN/
   git commit -m "$(cat <<'EOF'
   plan(sprint-NNN): generate sprint stories from epics

   Epics: <epic-ids>
   Stories: N stories, N total points
   EOF
   )"
   ```

---

## Phase Final: REGISTER

Update tracking files after sprint planning.

1. **Update `docs/roadmap/epics/_EPIC_REGISTRY.json`:**
   - Set status to `in-progress` for epics included in this sprint
   - Add `currentSprint: "sprint-NNN"` to each included epic

2. **Update `.claude/shared/registry.json`:**
   - Set `lastSprint`: `{ "number": NNN, "id": "sprint-NNN", "date": "<YYYY-MM-DD>", "storyCount": N, "epics": ["<epic-ids>"] }`
   - Set `lastExecution`: `{ "skill": "sprint-plan", "date": "<YYYY-MM-DD>", "status": "complete" }`

3. **Report to user:**
   - Sprint number and epic(s) covered
   - Story count and point total
   - Package breakdown
   - Key research findings that influenced the stories
   - GitHub milestone link
   - Suggested next step: "Run `/sprint-dev` to begin implementing this sprint."
