---
name: fix-issue
description: |
  GitHub issue resolution workflow. Fetches issue, researches context, identifies
  root cause, implements fix with tests, updates issue.
  Use when: "fix issue #123", "resolve issue", "work on issue"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, WebSearch, WebFetch, ToolSearch
model: opus
argument-hint: "<issue-number>"
---

# Fix Issue Skill

End-to-end GitHub issue resolution for the claudeHQ project (lasswellt/claudeHQ). Fetches the issue, identifies root cause, implements a fix, verifies it builds and passes tests, and updates the issue.

---

## Phase 0: CONTEXT

Load project context before starting work.

1. **Read project state files** (skip any that don't exist yet):
   - `.claude/shared/codebase-inventory.json` — file map, module boundaries, dependency graph
   - `docs/_research/research-index.json` — prior research that may be relevant
   - `.claude/shared/incompletes.json` — unfinished work items from prior skill runs
   - `.claude/shared/registry.json` — cross-skill state

2. **Identify package scopes:** agent, hub, dashboard, shared, protocol — all under `packages/`.

3. **Note build/test commands:**
   - Full build: `pnpm turbo build`
   - Single package build: `pnpm --filter @chq/<pkg> build`
   - Type check: `pnpm type-check` or `pnpm --filter @chq/<pkg> type-check`
   - Tests: `npx vitest run` or `pnpm --filter @chq/<pkg> test`
   - Lint: `pnpm lint` or `pnpm --filter @chq/<pkg> lint`

---

## Step 1: FETCH ISSUE

Retrieve the GitHub issue details.

1. Run: `gh issue view <issue-number> --repo lasswellt/claudeHQ --json title,body,labels,assignees,milestone,comments,state`
2. Parse the issue body for:
   - **Problem description** — what is broken or missing
   - **Reproduction steps** — if provided
   - **Expected vs actual behavior**
   - **Affected packages** — infer from labels, body mentions, or file paths referenced
   - **Acceptance criteria** — explicit or implied
3. Read all issue comments for additional context, clarifications, or related PR links.
4. If the issue references other issues, fetch those too for full context.

---

## Step 2: IDENTIFY AFFECTED FILES

Locate the code relevant to this issue.

1. **Search by keywords:** Grep the codebase for terms from the issue title and body — function names, error messages, component names, route paths.
2. **Search by package:** If the issue labels or body indicate specific packages, focus there:
   - `packages/agent/src/` — PTY, daemon, queue, WebSocket client, CLI
   - `packages/hub/src/` — Fastify routes, DB queries, WS handlers, relay, notifications
   - `packages/dashboard/app/` — Vue components, composables, stores, pages
   - `packages/shared/` — Zod schemas, protocol types, shared utilities
3. **Trace dependencies:** For each affected file, identify imports and dependents. Use `Grep` for import statements.
4. **List affected files** with brief notes on why each is relevant.

---

## Step 3: OPTIONAL RESEARCH

If the issue involves unfamiliar libraries, APIs, or patterns:

1. **Check existing research:** Search `docs/_research/` for prior research on the topic.
2. **Spawn a research agent** (via `Task`) if needed:
   - Give it a focused question related to the issue
   - Provide relevant file paths and code context
   - Wait for it to return findings
3. **Common research needs:**
   - node-pty API behavior for PTY-related issues
   - Fastify plugin/hook lifecycle for Hub route issues
   - xterm.js API for terminal rendering issues
   - better-sqlite3 query patterns for DB issues
   - Nuxt 3 / Vuetify 3 component patterns for Dashboard issues
   - WebSocket protocol edge cases for connectivity issues

---

## Step 4: ROOT CAUSE ANALYSIS

Determine why the issue exists.

1. **Read the affected files** identified in Step 2 thoroughly.
2. **Trace the execution path** from entry point to the point of failure:
   - For Agent issues: CLI entry -> daemon -> PTY pool -> session lifecycle
   - For Hub issues: HTTP request/WS message -> handler -> DB/relay -> response
   - For Dashboard issues: user action -> composable/store -> API call -> render
   - For Shared issues: schema definition -> validation -> consumer usage
3. **Identify the root cause.** Document:
   - What is wrong (the bug or missing functionality)
   - Why it happens (the underlying cause)
   - Where it happens (exact file, function, line range)
4. **Verify the root cause** by checking if the identified issue explains all symptoms described in the GitHub issue.

---

## Step 5: IMPLEMENT FIX

Make the code changes to resolve the issue.

1. **Plan the fix** before writing code:
   - List every file that needs to change
   - Describe the change for each file
   - Identify potential side effects
   - Note if shared types/protocol changes are needed (these must be done first)

2. **Order of changes** (dependency-aware):
   1. `packages/shared/` — Zod schemas, protocol types (if affected)
   2. `packages/agent/src/` or `packages/hub/src/` — backend logic
   3. `packages/dashboard/app/` — frontend components/stores
   4. Test files — alongside or after implementation

3. **Implementation rules:**
   - Follow existing code patterns in each package
   - Use Zod schemas for any new validation
   - Use the existing WebSocket protocol message types
   - Maintain TypeScript strict mode compliance
   - Add JSDoc comments for new public functions
   - Handle errors explicitly (no silent swallowing)

4. **Write the changes** using `Edit` for surgical modifications or `Write` for new files.

---

## Step 6: VERIFY

Run verification to confirm the fix works and nothing is broken.

1. **Type check** (catches type errors from changes):
   ```bash
   pnpm type-check
   ```
   If this fails, fix type errors before proceeding.

2. **Run tests** (catches behavioral regressions):
   ```bash
   npx vitest run
   ```
   Or for targeted testing:
   ```bash
   pnpm --filter @chq/<affected-pkg> test
   ```
   If tests fail, determine if the failure is:
   - A pre-existing failure (not caused by this fix) — note it
   - Caused by this fix — fix it before proceeding
   - A test that needs updating because behavior correctly changed — update the test

3. **Build** (catches compilation and bundling issues):
   ```bash
   pnpm turbo build
   ```
   If build fails, fix before proceeding.

4. **Lint** (catches style issues):
   ```bash
   pnpm lint
   ```
   Fix any lint errors introduced by the changes.

5. **All four checks must pass** before proceeding to Step 7.

---

## Step 7: UPDATE ISSUE

Update the GitHub issue with progress.

1. **Add a comment** to the issue:
   ```bash
   gh issue comment <issue-number> --repo lasswellt/claudeHQ --body "$(cat <<'EOF'
   ## Fix Implemented

   **Root cause:** <1-2 sentence root cause>

   **Changes:**
   - `<file1>`: <what changed>
   - `<file2>`: <what changed>

   **Verification:**
   - [x] Type check passes
   - [x] Tests pass
   - [x] Build succeeds
   - [x] Lint clean
   EOF
   )"
   ```

2. If the fix is complete and verified, note that a PR should be created (but do not create one unless the user asks).

---

## Step 8: COMMIT

Create a well-structured commit.

1. **Stage only the files changed for this fix** (no unrelated changes):
   ```bash
   git add <specific-files>
   ```

2. **Commit with a descriptive message:**
   ```bash
   git commit -m "$(cat <<'EOF'
   fix(<package>): <concise description>

   Resolves #<issue-number>.

   <1-2 sentence explanation of root cause and fix>
   EOF
   )"
   ```

3. Use conventional commit format: `fix(agent):`, `fix(hub):`, `fix(dashboard):`, `fix(shared):`, or `fix:` for cross-cutting changes.

---

## Follow-up Skills

After completing the fix, suggest relevant follow-up skills:

1. **test-gen** — if the fix area lacks test coverage, suggest generating tests:
   > "Run `/test-gen` targeting the files modified in this fix to improve coverage."

2. **dashboard-qa** — if the fix affects Dashboard UI, suggest visual QA:
   > "Run `/dashboard-qa` to verify the UI changes render correctly."

---

## Phase Final: REGISTER

Update tracking files to record this execution.

1. **Resolve incompletes:** If this fix resolves any items in `.claude/shared/incompletes.json`, remove them.

2. **Log execution** in `.claude/shared/registry.json`:
   - Update `lastExecution`: `{ "skill": "fix-issue", "issue": <number>, "date": "<YYYY-MM-DD>", "status": "complete" }`

3. **Add incompletes** if any work remains:
   - If tests are missing, add to `.claude/shared/incompletes.json`:
     ```json
     { "type": "test-coverage", "target": "<file>", "reason": "fix-issue #<N> modified this file but tests are missing", "date": "<YYYY-MM-DD>" }
     ```

4. **Report to user:**
   - Issue number and title
   - Root cause summary
   - Files changed (absolute paths)
   - Verification status
   - Any remaining work items
