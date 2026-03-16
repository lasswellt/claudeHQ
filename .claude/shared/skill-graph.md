# Skill Graph

Canonical source for skill routing and follow-up chains. Used by:

- `/ask` command (routing table for task intake)
- All skills (follow-up chain definitions)

---

## Routing Table

Used by `/ask` to classify vague requests and dispatch to the right skill(s).

| Intent Keywords | Primary Skill | Follow-up Chain |
|---|---|---|
| "fix bug", "broken", "issue #N", "error on", "not working" | `fix-issue` | → `test-gen` → `dashboard-qa` |
| "build UI", "new page", "dashboard view", "terminal view" | `dashboard-build` | → `dashboard-qa` |
| "new feature", "add [noun]", "build [noun]" | `sprint-plan` | → `sprint-dev` → `sprint-review` |
| "add tests", "test coverage", "generate tests" | `test-gen` | → `dashboard-qa` (if UI) |
| "refactor", "extract", "simplify", "decompose", "clean up" | `refactor` | → `test-gen` |
| "research", "how should we", "compare", "investigate" | `research` | → (context-dependent) |
| "sprint", "next sprint", "implement stories" | `/sprint` cmd | — |
| "check dashboard", "console errors", "smoke test", "browse" | `dashboard-qa` | → `fix-issue` (per finding) |
| "plan phases", "generate epics", "roadmap", "what to build" | `phase-plan` | → `sprint-plan` |
| "protocol", "WebSocket messages", "message types" | `protocol-gen` | → `test-gen` |

---

## Follow-up Chain Map

Defines what each skill should suggest after completing its work.

### fix-issue

After fixing an issue:

- **Always**: `/test-gen <modified-files>` — add regression tests for the fix
- **If dashboard affected**: `/dashboard-qa page <route>` — verify the fix visually

### refactor

After refactoring:

- **Always**: `/test-gen <refactored-files>` — verify coverage wasn't lost

### test-gen

After generating tests:

- **If dashboard component**: `/dashboard-qa page <route>` — visual smoke test
- **If coverage partial**: register incomplete with `suggestedSkill: "test-gen"`

### research

After completing research:

- **"We should build X"**: `/sprint-plan` — create implementation stories
- **"Existing gap found"**: `/fix-issue` or `/refactor`
- **"UI decision resolved"**: `/dashboard-build` — implement the recommendation
- **"Architecture answered"**: `/sprint-plan` if it unblocks an epic

### sprint-dev

After implementing sprint stories:

- **If dashboard stories implemented**: `/dashboard-qa smoke` — validate new pages
- **Always**: `/sprint-review` — run quality gates (automatic via `/sprint` command)

### sprint-review

After review:

- **If PASS**: `/dashboard-qa smoke` if no browser validation has been run
- **If needs-fixes**: `/fix-issue` for each Critical finding

### dashboard-build

After building or polishing dashboard UI:

- **Always**: `/dashboard-qa page <route>` — visual validation

### dashboard-qa

After a QA run:

- For each Critical/Error: registered in incompletes with `suggestedSkill: "fix-issue"`
- No additional action needed unless user wants immediate chaining

### phase-plan

After generating epics:

- **Always**: `/sprint-plan` — select next unblocked epics

### protocol-gen

After generating protocol types:

- **Always**: `/test-gen` — protocol compliance tests

### sprint-plan

After planning:

- **Always**: `/sprint-dev` — implement the planned stories
- **When standalone**: confirm with user before dispatching (implementation is long-running)
