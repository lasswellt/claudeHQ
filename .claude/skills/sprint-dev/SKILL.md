---
name: sprint-dev
description: |
  Autonomous sprint developer. Spawns agent-dev, hub-dev, dashboard-dev, and
  test-writer agents. Distributes stories with dependency ordering.
  Use when: "implement sprint", "develop stories", "start coding"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, TaskCreate, TaskUpdate, TaskList, TaskGet, TaskOutput, TaskStop, SendMessage, TeamCreate, WebSearch, WebFetch, ToolSearch, AskUserQuestion
disable-model-invocation: true
user-invocable: false
model: opus
---

# Sprint Dev Skill

Autonomous multi-agent sprint implementation for the claudeHQ project. Orchestrates 4 developer agents across git worktrees, distributes stories in dependency order, monitors progress, and integrates results.

**This skill is not directly user-invocable.** It is triggered by the sprint workflow after `/sprint-plan` completes.

---

## Phase 0: CONTEXT

Load sprint context and validate readiness.

1. **Read sprint files:**
   - `.claude/shared/registry.json` — get `lastSprint.id` for the current sprint
   - `docs/roadmap/sprints/<sprint-id>/_SPRINT_META.json` — sprint metadata, story count, point breakdown
   - Read all story files in `docs/roadmap/sprints/<sprint-id>/stories/*.md`
   - `.claude/shared/codebase-inventory.json` — current codebase state

2. **Build the story dependency graph:**
   - Parse each story's `dependencies` frontmatter
   - Topological sort stories into execution waves
   - Wave 0: Stories with no dependencies (typically shared types)
   - Wave 1: Stories depending only on Wave 0
   - Wave N: Stories depending on Waves 0..N-1

3. **Validate readiness:**
   - All stories have `status: ready`
   - No unresolved dependency references
   - Sprint meta exists and is valid
   - Git working tree is clean: `git status --porcelain` should be empty

4. **Create worktree branches:**
   ```bash
   git branch sprint-<NNN>/agent main 2>/dev/null || true
   git branch sprint-<NNN>/hub main 2>/dev/null || true
   git branch sprint-<NNN>/dashboard main 2>/dev/null || true
   git branch sprint-<NNN>/tests main 2>/dev/null || true
   ```

---

## Phase 1: SPAWN DEVELOPMENT TEAM

Create a team of 4 developer agents via `TeamCreate`.

### Agent Roster:

**agent-dev**
- **Responsibility:** Shared types (Zod schemas, protocol definitions) + Agent package (daemon, PTY, queue, recorder, WS client, CLI, config)
- **Branch:** `sprint-<NNN>/agent`
- **Priority stories:** Shared type stories first (blocking), then agent stories
- **Build verification:** `pnpm --filter @chq/shared build && pnpm --filter @chq/agent build`

**hub-dev**
- **Responsibility:** Hub package (Fastify routes, DB schema/queries, WS handlers, relay, notifications, recordings)
- **Branch:** `sprint-<NNN>/hub`
- **Priority stories:** After shared types are complete
- **Build verification:** `pnpm --filter @chq/shared build && pnpm --filter @chq/hub build`

**dashboard-dev**
- **Responsibility:** Dashboard package (Nuxt pages, Vue components, Pinia stores, composables, xterm.js integration)
- **Branch:** `sprint-<NNN>/dashboard`
- **Priority stories:** After Hub API endpoints exist
- **Build verification:** `pnpm --filter @chq/shared build && pnpm --filter @chq/dashboard build`

**test-writer**
- **Responsibility:** Unit tests and integration tests for all packages
- **Branch:** `sprint-<NNN>/tests`
- **Priority stories:** After implementation stories in the same wave
- **Build verification:** `npx vitest run`

### Story Distribution Table:

| Content Type | Agent | Priority |
|---|---|---|
| Shared types (Zod schemas, protocol types) | agent-dev | Blocking (others depend) |
| Agent daemon, PTY, queue, recorder | agent-dev | After shared types |
| Hub routes, DB schema, relay, notifications | hub-dev | After shared types |
| Dashboard pages, components, composables | dashboard-dev | After hub API exists |
| Unit tests, integration tests | test-writer | After implementation |

---

## Phase 2: DISTRIBUTE AND EXECUTE

Send stories to agents in dependency-ordered waves.

### Wave execution loop:

```
For each wave W in topological order:
  1. Identify stories in wave W
  2. Group by assignee (agent-dev, hub-dev, dashboard-dev, test-writer)
  3. Send each agent its stories for this wave via SendMessage
  4. Monitor progress (Phase 2.5)
  5. Wait for all agents in this wave to complete
  6. Verify wave W builds: pnpm turbo build
  7. If build fails, trigger circuit breaker (Phase 2.7)
  8. Proceed to wave W+1
```

### Story assignment message format:

When sending a story to an agent, include:

```
STORY: NNN-XXX
TITLE: <title>
BRANCH: sprint-<NNN>/<pkg>
PACKAGE: <package>

REQUIREMENTS:
<full requirements section from story>

ACCEPTANCE CRITERIA:
<full AC section from story>

TECHNICAL NOTES:
<full technical notes section from story>

FILES TO MODIFY:
<files section from story>

INSTRUCTIONS:
1. Check out branch: git checkout sprint-<NNN>/<pkg>
2. Implement the requirements
3. Ensure all acceptance criteria are met
4. Run: pnpm --filter @chq/<pkg> type-check
5. Run: pnpm --filter @chq/<pkg> test (if tests exist)
6. Run: pnpm --filter @chq/<pkg> build
7. Commit with message: "feat(<pkg>): NNN-XXX <title>"
8. Report completion with: files changed, verification results
```

---

## Phase 2.5: ORCHESTRATOR MONITORING LOOP

The orchestrator (this skill) continuously monitors agent progress.

### Monitoring cycle (every 30 seconds):

1. **Check agent status:** Use `TaskList` / `TaskGet` to check each agent's current state.

2. **Progress tracking:**
   - Track stories completed per agent
   - Track stories in-progress
   - Track stories blocked (dependency not met)
   - Estimate completion percentage per wave

3. **Dependency unblocking:**
   - When agent-dev completes a shared type story, immediately notify hub-dev and dashboard-dev that the dependency is resolved
   - When hub-dev completes an API endpoint story, notify dashboard-dev
   - Send unblocking messages via `SendMessage`

4. **Stall detection:**
   - If an agent produces no output for 5 minutes, check its status
   - If an agent has been on one story for > 20 minutes, send a status check message
   - Log stall events for the sprint report

5. **Error detection:**
   - Watch for build failures in agent output
   - Watch for test failures
   - Watch for type errors
   - If detected, send corrective guidance to the agent

---

## Phase 2.7: CIRCUIT BREAKER

If a wave fails to build after agent completion:

1. **Identify the failure:**
   - Run `pnpm turbo build 2>&1` and parse error output
   - Determine which package and file(s) caused the failure

2. **Attempt auto-fix (up to 2 attempts):**
   - Send the error output to the responsible agent
   - Ask it to fix the build error
   - Re-verify after fix

3. **If auto-fix fails:**
   - Log the failure in sprint report
   - Mark the story as `blocked`
   - Ask the user (via `AskUserQuestion`) whether to:
     a. Skip this story and continue with the next wave
     b. Pause the sprint for manual intervention
     c. Abort the sprint

4. **Never let a broken wave propagate.** Subsequent waves depend on prior waves building successfully.

---

## Phase 3: INTEGRATION

After all waves complete, integrate the branches.

1. **Merge shared types first:**
   ```bash
   git checkout main
   git merge sprint-<NNN>/agent --no-ff -m "feat(sprint-NNN): merge agent + shared types"
   ```

2. **Merge hub:**
   ```bash
   git merge sprint-<NNN>/hub --no-ff -m "feat(sprint-NNN): merge hub changes"
   ```

3. **Merge dashboard:**
   ```bash
   git merge sprint-<NNN>/dashboard --no-ff -m "feat(sprint-NNN): merge dashboard changes"
   ```

4. **Merge tests:**
   ```bash
   git merge sprint-<NNN>/tests --no-ff -m "test(sprint-NNN): merge test suite"
   ```

5. **Handle merge conflicts:**
   - If conflicts arise, analyze the conflicting changes
   - Resolve conflicts preserving both changes where possible
   - For genuine conflicts, prefer the more recent implementation
   - After resolution, verify the build

---

## Phase 3.5: UI/UX INTEGRATION CHECK

After merging, verify Dashboard-specific integration concerns.

1. **Vuetify component usage:**
   - Verify Vuetify components are imported correctly (auto-import or explicit)
   - Check that Vuetify plugins needed by components are registered in `nuxt.config.ts`
   - Verify Vuetify icon sets are configured if icons are used

2. **xterm.js integration:**
   - Verify `TerminalView.vue` correctly initializes xterm.js Terminal instance
   - Check that xterm addons (fit, webgl, serialize) are loaded properly
   - Verify terminal resize handling with `xterm-addon-fit`
   - Check that terminal data flows correctly: WebSocket message -> xterm.write()

3. **WebSocket composable wiring:**
   - Verify `useWebSocket` composable connects to the correct Hub URL
   - Check message type handling matches the protocol definitions in `packages/shared/`
   - Verify reconnection logic (exponential backoff)
   - Check that session subscription/unsubscription works correctly

4. **Notification toast patterns:**
   - Verify `useNotifications` composable handles all notification types
   - Check Vuetify `$q.notify()` integration for toast display
   - Verify notification sound option (if implemented)
   - Check notification feed component renders correctly

5. **Pinia store integration:**
   - Verify stores are properly initialized via `defineStore`
   - Check that store actions correctly call the Hub API
   - Verify reactive state updates propagate to components
   - Check store persistence (if using `pinia-plugin-persistedstate`)

6. **If any UI/UX issue is found:**
   - Fix it directly (if small)
   - Or create an incomplete for follow-up

---

## Phase 4: FULL BUILD VERIFICATION

Run comprehensive verification after integration.

1. **Type check all packages:**
   ```bash
   pnpm type-check
   ```

2. **Run all tests:**
   ```bash
   npx vitest run
   ```

3. **Full Turborepo build:**
   ```bash
   pnpm turbo build
   ```

4. **Lint all packages:**
   ```bash
   pnpm lint
   ```

5. **If any check fails:**
   - Identify the failing file and trace it to the responsible story/agent
   - Fix the issue
   - Re-run verification
   - Repeat until clean

6. **Final commit** (if any fixes were applied during integration):
   ```bash
   git add -A
   git commit -m "$(cat <<'EOF'
   fix(sprint-NNN): integration fixes after merge

   Resolved type errors and test failures from branch integration.
   EOF
   )"
   ```

---

## Follow-up Skills

After sprint development completes:

1. **sprint-review** — always run after sprint-dev:
   > "Run `/sprint-review` to validate code quality, security, and patterns."

2. **dashboard-qa** — if dashboard changes were made:
   > "Run `/dashboard-qa` to visually verify the Dashboard UI changes."

3. **test-gen** — if test coverage is insufficient:
   > "Run `/test-gen` targeting uncovered modules from this sprint."

---

## Phase Final: REGISTER

Update all tracking files after sprint development.

1. **Update sprint meta** (`docs/roadmap/sprints/<sprint-id>/_SPRINT_META.json`):
   - Set `status: "implemented"`
   - Add `implementedDate: "<YYYY-MM-DD>"`
   - Add `storiesCompleted: <count>`
   - Add `storiesBlocked: [<blocked-story-ids>]` (if any)

2. **Update story statuses:**
   - Set completed stories to `status: complete`
   - Set blocked stories to `status: blocked` with `blockedReason`

3. **Update GitHub issues:**
   ```bash
   # For each completed story with a GitHub issue number:
   gh issue close <issue-number> --repo lasswellt/claudeHQ --comment "Implemented in sprint-NNN"
   ```

4. **Update `.claude/shared/registry.json`:**
   - Set `lastExecution`: `{ "skill": "sprint-dev", "sprint": "sprint-NNN", "date": "<YYYY-MM-DD>", "storiesCompleted": N, "storiesBlocked": N, "status": "complete" }`

5. **Log incompletes** in `.claude/shared/incompletes.json`:
   - Any blocked stories
   - Any integration issues deferred
   - Any test coverage gaps discovered

6. **Report to user:**
   - Sprint ID and stories completed/blocked
   - Build verification status
   - Integration issues encountered and resolutions
   - Files changed (count by package)
   - Suggested next step: "Run `/sprint-review` to validate quality."

7. **Clean up worktree branches** (only if fully merged and verified):
   ```bash
   git branch -d sprint-<NNN>/agent sprint-<NNN>/hub sprint-<NNN>/dashboard sprint-<NNN>/tests
   ```
