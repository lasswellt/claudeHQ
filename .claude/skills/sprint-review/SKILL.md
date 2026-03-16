---
name: sprint-review
description: |
  Sprint quality review. Runs type-check, lint, test suite, build validation.
  Spawns reviewer agents for code quality and security. Auto-fixes failures.
  Use when: "review sprint", "check quality", "run review"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, SendMessage, TeamCreate, WebSearch, ToolSearch
model: opus
---

# Sprint Review Skill

Comprehensive quality review for a completed sprint in the claudeHQ project. Runs automated checks, spawns specialized reviewer agents for code quality and security analysis, auto-fixes issues, and produces a quality report.

---

## Phase 0: CONTEXT

Load sprint and project context.

1. **Read project state files:**
   - `.claude/shared/registry.json` — get `lastExecution` to identify the sprint to review
   - `docs/roadmap/sprints/<sprint-id>/_SPRINT_META.json` — sprint metadata
   - Read all story files in `docs/roadmap/sprints/<sprint-id>/stories/*.md` — to know what was implemented
   - `.claude/shared/codebase-inventory.json` — file map and module boundaries
   - `.claude/shared/incompletes.json` — known issues from sprint-dev

2. **Identify changed files since sprint start:**
   ```bash
   git log --name-only --pretty=format: --since="<sprint-start-date>" | sort -u | grep -v '^$'
   ```
   Or if sprint commits are identifiable:
   ```bash
   git diff --name-only main..HEAD
   ```

3. **Categorize changes by package:**
   - Agent changes: `packages/agent/src/**`
   - Hub changes: `packages/hub/src/**`
   - Dashboard changes: `packages/dashboard/app/**`
   - Shared changes: `packages/shared/**`
   - Test changes: `**/__tests__/**`, `**/tests/**`
   - Config changes: root configs, `turbo.json`, `tsconfig.json`, etc.

---

## Phase 1: AUTOMATED CHECKS

Run all automated verification tools.

### 1.1 Type Check
```bash
pnpm type-check 2>&1
```
- Record: pass/fail, error count, specific errors
- If fails: categorize errors by package and severity

### 1.2 Lint
```bash
pnpm lint 2>&1
```
- Record: pass/fail, warning count, error count
- If fails: categorize by rule and package

### 1.3 Test Suite
```bash
npx vitest run 2>&1
```
- Record: pass/fail, test count, suite count, failures, coverage (if configured)
- If fails: list failing tests with error messages

### 1.4 Build
```bash
pnpm turbo build 2>&1
```
- Record: pass/fail, per-package build status
- If fails: identify the failing package and error

### Results matrix:

| Check | Status | Errors | Notes |
|-------|--------|--------|-------|
| Type Check | pass/fail | N | ... |
| Lint | pass/fail | N errors, N warnings | ... |
| Tests | pass/fail | N/M passing | ... |
| Build | pass/fail | N packages | ... |

---

## Phase 2: CODE REVIEW

Spawn 4 specialized reviewer agents via `TeamCreate`.

### Reviewer 1: Security Reviewer
- **Name:** `security-reviewer`
- **Focus areas:**
  - **WebSocket message validation:** All incoming WS messages (both agent->hub and dashboard->hub) must be validated against Zod schemas before processing. No raw JSON parsing without validation.
  - **PTY input sanitization:** Any user input sent to PTY via `pty.write()` must be checked for dangerous sequences (escape sequences that could break the terminal, extremely long inputs, null bytes).
  - **Tailscale ACL verification:** If any new network endpoints were added, verify they are only accessible within the Tailscale mesh. No accidental public binding (`0.0.0.0` without Tailscale guard).
  - **Secret scrubbing:** Verify that `scrubPatterns` are applied to terminal output before storage (recordings) and relay (dashboard streaming). Check that API keys, tokens, and credentials are caught.
  - **No hardcoded credentials:** Grep for API keys, passwords, tokens, connection strings in the changed files. Check `.env` files are in `.gitignore`.
  - **SQLite injection:** All SQL queries in Hub use parameterized statements (`?` placeholders), not string concatenation. Check for any raw string interpolation in SQL.
  - **Path traversal:** File paths received from API requests (recording paths, cwd values) are validated and sandboxed.

- **Output:** List of security findings with severity (critical/high/medium/low/info) and remediation guidance.

### Reviewer 2: Agent/Hub Reviewer
- **Name:** `backend-reviewer`
- **Focus areas:**
  - **Node.js patterns:** Proper async/await usage (no unhandled promises), error propagation, graceful shutdown handling, resource cleanup (PTY instances, DB connections, WS connections).
  - **Fastify route correctness:** Routes use proper HTTP methods, status codes, and response schemas. Route handlers are async. Error responses use Fastify's error handling (not bare `try/catch` with manual response).
  - **SQLite query safety:** Queries use `better-sqlite3` synchronous API correctly. Transactions are used for multi-statement operations. Indexes exist for frequently queried columns. Migration patterns are correct.
  - **WebSocket protocol compliance:** Messages match the protocol types defined in `packages/shared/`. Message handlers cover all expected message types. Connection lifecycle (open, close, error, reconnect) is handled correctly.
  - **PTY lifecycle:** Sessions are properly cleaned up on exit (PTY killed, recording finalized, Hub notified). No zombie processes. Queue auto-advance works after session completion.
  - **Logging:** Uses `pino` logger, not `console.log`. Log levels are appropriate (error for errors, info for lifecycle events, debug for verbose output).

- **Output:** List of findings with severity and specific code references.

### Reviewer 3: Dashboard Reviewer
- **Name:** `dashboard-reviewer`
- **Focus areas:**
  - **Nuxt 3 patterns:** Pages use `definePageMeta` correctly. Components use `<script setup lang="ts">`. Auto-imports are used for composables and utilities. `useFetch`/`useAsyncData` for data fetching (or custom composables for WS data).
  - **Vuetify component usage:** Components are used according to Vuetify docs (correct props, events, slots). Vuetify utilities (`$q.notify`, `$q.dialog`, etc.) are accessed correctly. Responsive design uses Vuetify's grid system.
  - **xterm.js integration:** Terminal instances are properly disposed on component unmount. `FitAddon` is used for responsive sizing. WebGL renderer has fallback for unsupported browsers. Terminal data encoding is handled correctly (UTF-8).
  - **Pinia stores:** Stores follow consistent patterns. Actions handle errors and loading states. Getters are used for derived state. No direct state mutation outside actions.
  - **WebSocket composable patterns:** Reconnection with exponential backoff. Clean disconnection on component unmount. Message type routing follows the protocol. Subscription management (subscribe/unsubscribe to sessions).
  - **Reactivity:** No reactivity pitfalls (`.value` access on refs, proper `watch`/`watchEffect` cleanup, no memory leaks from un-stopped watchers).
  - **Accessibility:** Basic a11y checks (keyboard navigation, ARIA labels on interactive elements, color contrast).

- **Output:** List of findings with severity and remediation.

### Reviewer 4: Pattern Reviewer
- **Name:** `pattern-reviewer`
- **Focus areas:**
  - **Shared types used correctly:** All packages import types from `@chq/shared`, not defining local duplicates. Zod schemas are used for runtime validation at package boundaries.
  - **Protocol messages match schema:** Every WS message sent matches its Zod schema definition. No extra fields, no missing required fields.
  - **Import boundaries respected:** Agent doesn't import from Hub or Dashboard. Dashboard doesn't import from Agent. Both can import from Shared. No circular dependencies.
  - **Naming consistency:** Functions, variables, types, files follow the established conventions in each package. Event names match protocol definitions.
  - **Error handling consistency:** All packages use the same error handling patterns. Errors are typed, not generic strings. Error responses include enough context for debugging.
  - **Configuration patterns:** All configurable values use the config system (not hardcoded). Default values are sensible. Config validation uses Zod.
  - **Code duplication:** Identify code that is duplicated across packages that should be extracted to shared.

- **Output:** List of findings with severity and recommendations.

### Team coordination:
- Create team with `TeamCreate`, assign each reviewer their focus area and the list of changed files.
- Each reviewer reads the changed files and produces findings.
- Wait for all reviewers to complete.
- Collect all findings.

---

## Phase 3: AUTO-FIX

Automatically fix issues that can be safely resolved.

### Auto-fixable categories:

1. **Lint errors:** Run `pnpm lint --fix` for auto-fixable lint rules.

2. **Missing type annotations:** Add explicit return types where TypeScript infers them but the linter requires explicit annotation.

3. **Import sorting/grouping:** Fix import order to match project conventions.

4. **Missing error handling:** Add try/catch where async functions lack error handling (for obvious cases only).

5. **Console.log cleanup:** Replace `console.log` with appropriate `pino` logger calls.

6. **Missing Zod validation:** If a WS message handler processes raw JSON without schema validation, add `schema.parse()` calls.

### Auto-fix rules:

- **Never auto-fix security issues** — these require human review.
- **Never auto-fix logic errors** — these require understanding intent.
- **Never auto-fix test failures** by modifying tests — the implementation may be wrong.
- **Always verify after each auto-fix** batch:
  ```bash
  pnpm type-check && npx vitest run && pnpm turbo build
  ```

### Auto-fix process:

1. Sort findings by category.
2. Apply auto-fixable changes.
3. Run verification after each batch.
4. If verification fails, revert the auto-fix batch and mark as manual-fix-needed.
5. Commit auto-fixes:
   ```bash
   git add -A
   git commit -m "$(cat <<'EOF'
   fix(review): auto-fix lint, formatting, and minor issues

   Sprint review auto-fixes:
   - <summary of fixes>
   EOF
   )"
   ```

---

## Phase 4: REPORT

Produce a comprehensive sprint review report.

### Report file: `docs/roadmap/sprints/<sprint-id>/REVIEW_REPORT.md`

```markdown
---
sprint: <sprint-id>
date: YYYY-MM-DD
status: <pass|pass-with-warnings|fail>
---

# Sprint <NNN> Review Report

## Summary
<2-3 sentence summary of sprint quality>

## Automated Checks

| Check | Status | Details |
|-------|--------|---------|
| Type Check | PASS/FAIL | N errors |
| Lint | PASS/FAIL | N errors, N warnings |
| Tests | PASS/FAIL | N/M passing, N% coverage |
| Build | PASS/FAIL | All N packages |

## Code Review Findings

### Critical (must fix before merge)
- [ ] <finding>

### High (should fix before merge)
- [ ] <finding>

### Medium (fix in next sprint)
- [ ] <finding>

### Low / Info
- <finding>

## Security Review
<summary of security findings, or "No security issues found">

## Auto-Fixes Applied
- <list of auto-fixes with file paths>

## Remaining Issues
<issues that require manual intervention>

## Recommendations
<suggestions for code quality improvement, architectural concerns>

## Metrics
- Files changed: N
- Lines added: N
- Lines removed: N
- Test coverage: N% (if available)
- Stories completed: N/N
- Review findings: N critical, N high, N medium, N low
```

### Report to user:

Present a concise summary:
1. Overall status: pass / pass-with-warnings / fail
2. Critical findings count (if any)
3. Auto-fixes applied count
4. Remaining manual fixes needed
5. Recommendation: merge / fix-then-merge / do-not-merge

---

## Follow-up Skills

After sprint review:

1. **fix-issue** — for critical/high findings that need immediate resolution:
   > "Run `/fix-issue <number>` for review findings filed as GitHub issues."

2. **test-gen** — if test coverage is below threshold:
   > "Run `/test-gen` targeting modules with insufficient coverage."

3. **dashboard-qa** — if Dashboard changes exist:
   > "Run `/dashboard-qa` for visual verification of UI changes."

4. **refactor** — if pattern reviewer found significant code duplication or structural issues:
   > "Run `/refactor` to address the structural issues identified in review."

---

## Phase Final: REGISTER

Update tracking files after review.

1. **Update sprint meta** (`docs/roadmap/sprints/<sprint-id>/_SPRINT_META.json`):
   - Add `reviewDate: "<YYYY-MM-DD>"`
   - Add `reviewStatus: "<pass|pass-with-warnings|fail>"`
   - Add `reviewFindings: { critical: N, high: N, medium: N, low: N }`
   - Add `autoFixesApplied: N`

2. **Update `.claude/shared/registry.json`:**
   - Set `lastExecution`: `{ "skill": "sprint-review", "sprint": "<sprint-id>", "date": "<YYYY-MM-DD>", "status": "<pass|pass-with-warnings|fail>", "findings": N }`

3. **Log incompletes** for manual-fix findings:
   - Add each critical/high finding to `.claude/shared/incompletes.json`:
     ```json
     {
       "type": "review-finding",
       "severity": "<critical|high>",
       "finding": "<description>",
       "file": "<file-path>",
       "sprint": "<sprint-id>",
       "date": "<YYYY-MM-DD>"
     }
     ```

4. **Create GitHub issues** for critical and high findings:
   ```bash
   gh issue create --repo lasswellt/claudeHQ \
     --title "Review: <finding-title>" \
     --body "<finding-details>" \
     --label "review,<severity>"
   ```

5. **Commit the review report:**
   ```bash
   git add docs/roadmap/sprints/<sprint-id>/REVIEW_REPORT.md
   git commit -m "$(cat <<'EOF'
   docs(sprint-NNN): add review report

   Status: <pass|pass-with-warnings|fail>
   Findings: N critical, N high, N medium, N low
   Auto-fixes: N applied
   EOF
   )"
   ```
