---
date: 2026-03-16
status: fail
scope: full-codebase
reviewers: security, backend, dashboard, pattern
automated_checks: type-check, lint, test, build
---

# Codebase Quality Review — 2026-03-16

## Summary

Comprehensive quality review of the full claudeHQ monorepo (73 source files across 4 packages). Automated checks all pass (types, lint, tests, build). Manual review by 4 specialized agents uncovered **2 critical**, **7 high**, **24 medium**, **14 low**, and **4 info** findings across security, backend correctness, dashboard reactivity, and cross-cutting patterns.

**Verdict: FAIL** — 2 critical + 7 high issues must be resolved before production deployment.

## Automated Checks

| Check | Status | Details |
|-------|--------|---------|
| Type Check | PASS | All 4 packages (shared, hub, agent, dashboard) |
| Lint | PASS | 0 errors, 8 warnings (console.log in CLI + composable) |
| Tests | PASS | 36/36 passing across 4 test files |
| Build | PASS | All 4 packages built successfully |

## Metrics

- Source files reviewed: 73
- Packages: 4 (agent, hub, dashboard, shared)
- Lines changed (recent 3 commits): +1081 / -39
- Test coverage: 36 tests passing (no coverage % configured)
- Review findings: 2 critical, 7 high, 24 medium, 14 low, 4 info

---

## Critical Findings (must fix immediately)

### CR-01: GitHub webhook HMAC verification is completely broken
- **File:** `packages/hub/src/routes/github.ts:177-183`
- **Category:** Security — Authentication
- **Reviewers:** Security, Backend
- **Description:** The HMAC is computed over `JSON.stringify(req.body)` — a re-serialized copy of the already-parsed JSON. GitHub signs the **raw request bytes**. Re-serialization changes key ordering and whitespace, so the comparison always fails for legitimate webhooks. Additionally, `timingSafeEqual` throws `RangeError` if buffers differ in length (unhandled), causing a 500 on crafted requests.
- **Impact:** All valid GitHub webhooks rejected (401). Trivial DoS via 500 with length-mismatched signature. Signature verification is non-functional.
- **Remediation:** Use `@fastify/rawbody` to capture raw request bytes. Compute HMAC over `request.rawBody`. Add buffer length check before `timingSafeEqual`.

### CR-02: Webhook endpoint accepts unauthenticated requests when no secret configured
- **File:** `packages/hub/src/routes/github.ts:184-187`
- **Category:** Security — Authentication
- **Reviewers:** Security
- **Description:** When `webhookSecret` is absent, the handler logs a warning and continues processing. Any unauthenticated caller can send fake `pull_request`, `check_run`, and `pull_request_review` events, manipulating PR and CI status records.
- **Impact:** Unauthenticated manipulation of CI status, PR merge state, and review approvals. In auto-merge scenarios, could trigger unintended code promotions.
- **Remediation:** Reject with 403 when no `webhookSecret` is configured. Require explicit `ALLOW_UNSIGNED_WEBHOOKS=true` for dev environments.

---

## High Findings (fix before merge)

### HI-01: PTY `write()` accepts unsanitized terminal escape sequences from API
- **File:** `packages/agent/src/session.ts:95-99`, `packages/agent/src/pty-pool.ts:101-104`
- **Category:** Security — Injection
- **Reviewers:** Security, Backend
- **Description:** `PtySession.write()` passes data directly to `ptyProcess.write()` with no filtering. OSC title injection (`\x1b]0;payload\x07`), bracketed paste bypass, SIGINT (`\x03`), and EOF (`\x04`) sequences are all accepted. Input originates from `POST /api/sessions/:id/input` with only `z.string()` validation (no max length, no escape filtering).
- **Impact:** API users can inject terminal escape sequences, terminate running Claude processes, or exploit xterm.js vulnerabilities in connected dashboard clients.
- **Remediation:** Add `z.string().max(4096)` at the route layer. Strip OSC/DCS/APC sequences before `ptyProcess.write()`.

### HI-02: Recording file paths vulnerable to path traversal
- **File:** `packages/hub/src/recordings.ts:10,19,26`
- **Category:** Security — Path Traversal
- **Reviewers:** Security
- **Description:** `path.join(recordingsPath, sessionId + '.jsonl')` constructs file paths from user-controlled `sessionId` (URL parameter) without verifying the result stays inside `recordingsPath`. While `path.join` normalizes `..` segments, edge cases with URL decoding could navigate outside the recordings directory.
- **Impact:** Read arbitrary `.jsonl` files or write JSONL content to paths outside recordings directory.
- **Remediation:** After constructing `filePath`, assert `path.resolve(filePath).startsWith(path.resolve(recordingsPath) + path.sep)`. Validate `sessionId` as UUID at the route layer with `z.string().uuid()`.

### HI-03: Hub binds `0.0.0.0` with zero API authentication
- **File:** `packages/shared/src/config.ts:22`, `packages/hub/src/server.ts`
- **Category:** Security — Network Exposure
- **Reviewers:** Security
- **Description:** All `/api/*`, `/ws/*`, and `/hooks/*` endpoints have no authentication middleware. The Hub defaults to binding on all interfaces. The Tailscale sidecar is the only protection but is not enforced at the application level.
- **Impact:** In misconfigured deployments, the entire API surface is exposed — sessions, recordings, GitHub credentials, queue management — all unauthenticated.
- **Remediation:** Add shared-secret middleware (`X-API-Key` header) for all `/api/*` routes. Default binding to `127.0.0.1`. Document Tailscale dependency.

### HI-04: Docker workspace mount path check bypassable via symlinks
- **File:** `packages/agent/src/container-pool.ts:74-78`
- **Category:** Security — Container Escape
- **Reviewers:** Security
- **Description:** Forbidden-path check uses string prefix comparison without resolving symlinks. A symlink at an allowed path pointing to `/etc` or `/root` bypasses the check.
- **Impact:** Potential container escape or sensitive data exposure via symlinked workspace paths.
- **Remediation:** Use `fs.realpathSync()` to resolve the workspace path before applying the forbidden-prefix check.

### HI-05: `insertQueueTask` TOCTOU race on queue position
- **File:** `packages/hub/src/dal.ts:256-266`
- **Category:** Correctness — Data Integrity
- **Reviewers:** Backend
- **Description:** `getMaxPositionStmt.get()` and `insertQueueTaskStmt.run()` are two separate statements outside a transaction. Concurrent insertions get the same `maxPos`, producing duplicate position values.
- **Impact:** Queue ordering becomes non-deterministic; tasks may execute in wrong order.
- **Remediation:** Wrap both in `db.transaction()` or use `INSERT ... SELECT MAX(position)+1`.

### HI-06: `create-pr` endpoint: PR insert and job update not atomic
- **File:** `packages/hub/src/routes/github.ts:154-159`
- **Category:** Correctness — Data Integrity
- **Reviewers:** Backend
- **Description:** `INSERT INTO pull_requests` and `UPDATE jobs SET pr_number` are separate statements with no transaction. A crash between them leaves permanent data inconsistency.
- **Impact:** Job records permanently missing PR links despite PR existing in the database.
- **Remediation:** Wrap both in `db.transaction()`.

### HI-07: `db.prepare()` called inline in hot paths across 16 files (107 occurrences)
- **File:** `packages/hub/src/dal.ts:188`, `routes/jobs.ts:23`, `routes/github.ts:104`, `scheduler.ts:17,36,48`, `approvals/engine.ts:21`, `github/client.ts:59,71`, and 8 other files
- **Category:** Performance — SQLite
- **Reviewers:** Backend
- **Description:** `db.prepare(sql)` inside function bodies forces SQLite to re-parse and re-compile the query on every request. This contradicts the project's own SQLite pattern rules (module-level prepared statements).
- **Impact:** Measurable CPU overhead under load; statement compilation cost compounds across all affected hot paths.
- **Remediation:** Hoist all `db.prepare()` calls to module/constructor scope. For dynamic queries like `listSessions`, pre-prepare a statement matrix or use a keyed cache.

---

## Medium Findings (fix in next sprint)

### ME-01: Terminal output never scrubbed — `Scrubber` class defined but not wired in
- **File:** `packages/agent/src/scrubber.ts`, `session.ts:72-81`, `recorder.ts:28-31`
- **Category:** Security — Data Exposure
- **Description:** `Scrubber` class exists with patterns for `sk-ant-*`, `ghp_*`, `Bearer *`, etc. but `scrubber.scrub()` is never called. Raw terminal output including API keys goes directly into recordings and dashboard WebSocket broadcasts.
- **Remediation:** Wire `Scrubber` into the output pipeline in `PtyPool` before emitting `session:output` and before passing chunks to `Recorder`.

### ME-02: Hook endpoints have no authentication and accept unvalidated payloads
- **File:** `packages/hub/src/routes/hooks.ts:7-52`
- **Category:** Security — Authentication
- **Description:** `/hooks/stop`, `/hooks/pre-tool-use`, `/hooks/post-tool-use`, `/hooks/subagent-stop` accept POST requests with no auth and no Zod schema. Raw `req.body` is cast and inserted into `session_events`.
- **Remediation:** Add `X-Hook-Token` verification. Validate `session_id` as UUID. Apply Zod schemas.

### ME-03: Repo URL passed to `git clone` without URL format validation — git argument injection
- **File:** `packages/agent/src/container-worktree.ts:29`, `packages/hub/src/routes/repos.ts`
- **Category:** Security — Injection
- **Description:** `createBody` validates repo URL with `z.string().min(1)`, not `z.string().url()`. A URL like `--upload-pack=/bin/bash` is interpreted as a git argument.
- **Remediation:** Validate with `z.string().url()`. Restrict to `https://` or `ssh://` schemes. Use `--` separator: `git clone -- repoUrl repoDir`.

### ME-04: Agent-to-Hub WebSocket has no authentication
- **File:** `packages/hub/src/ws/agent-handler.ts:31-65`, `packages/hub/src/server.ts:75-77`
- **Category:** Security — Authentication
- **Description:** `/ws/agent` accepts any connection. An attacker can register a fake machine, receive `hub:session:start` commands, exfiltrate prompts.
- **Remediation:** Require HMAC-signed registration token in the WebSocket connection.

### ME-05: `getConfig()` returns raw GitHub App private key and PAT
- **File:** `packages/hub/src/github/client.ts:58-68`
- **Category:** Security — Secret Exposure
- **Description:** Full `GitHubConfig` including `privateKey` and `patToken` returned to all callers. Risk of accidental logging or API exposure.
- **Remediation:** Create `getSafeConfig()` without sensitive fields. Use dedicated secret accessors.

### ME-06: Anthropic API key exposed in `docker exec` command-line arguments
- **File:** `packages/agent/src/spawn-docker.ts:37-39,85-87`
- **Category:** Security — Secret Exposure
- **Description:** `-e ANTHROPIC_API_KEY=...` is visible in `ps aux`, `/proc/<pid>/cmdline`, and Docker inspect output.
- **Remediation:** Pass secrets via Docker secrets or mounted credentials file.

### ME-07: `timingSafeEqual` throws on buffer length mismatch — unhandled exception
- **File:** `packages/hub/src/routes/github.ts:180`
- **Category:** Security — Error Handling
- **Description:** Crafted signature header of different length causes `RangeError`, returning 500 instead of 401.
- **Remediation:** Check buffer lengths before calling `timingSafeEqual`.

### ME-08: `broadcastToDashboard` sends possibly-undefined machine record
- **File:** `packages/hub/src/ws/agent-handler.ts:123,77`
- **Category:** WebSocket Protocol — Correctness
- **Description:** `getMachine()` returns `undefined` on miss; result sent without null-guard, producing malformed protocol message.
- **Remediation:** Guard: `if (machine) this.broadcastToDashboard(...)`.

### ME-09: `agent:queue:updated` messages silently dropped — dashboard queue never refreshes
- **File:** `packages/hub/src/ws/agent-handler.ts:59-61`
- **Category:** Architecture — Correctness
- **Description:** Queue changes from agent are only logged at debug level, never forwarded to dashboard subscribers.
- **Remediation:** Forward to dashboard: `this.broadcastToDashboard({ type: 'queue:updated', ... })`.

### ME-10: `sendInitialState` calls `socket.send()` without readyState guard
- **File:** `packages/hub/src/ws/dashboard-handler.ts:103-128`
- **Category:** WebSocket — Error Handling
- **Description:** Socket may close between subscribe receipt and synchronous `sendInitialState`, causing uncaught exception.
- **Remediation:** Add `if (client.socket.readyState !== 1) return;` at top of `sendInitialState`.

### ME-11: Wildcard session subscription (`session:*`) sends zero initial state
- **File:** `packages/hub/src/ws/dashboard-handler.ts:101-109`
- **Category:** Correctness — UX
- **Description:** Missing `else` branch for session wildcard. Dashboard session list is empty on initial connection.
- **Remediation:** Add `else` branch calling `this.dal.listSessions()` and sending each session.

### ME-12: `healthHistoryRoutes` monkey-patches Fastify instance
- **File:** `packages/hub/src/routes/health.ts:29-39`
- **Category:** Architecture — Design
- **Description:** `Object.assign(app, { recordHealthData(...) {} })` bypasses TypeScript typing and is order-dependent.
- **Remediation:** Use `app.decorate()` with `declare module 'fastify'` augmentation.

### ME-13: Job creation flow — 5 sequential DB writes + agent command not atomic
- **File:** `packages/hub/src/routes/jobs.ts:72-103`
- **Category:** Data Integrity
- **Description:** Multiple DB writes without transaction wrapper. Crash at any step leaves orphaned records.
- **Remediation:** Wrap all DB mutations in `db.transaction()`; send agent message only after commit.

### ME-14: `listSessions` `status` filter lacks enum validation
- **File:** `packages/hub/src/dal.ts:188-210`, `packages/hub/src/routes/sessions.ts:28`
- **Category:** Security — Input Validation
- **Description:** Status from `req.query.status` flows into parameterized query without enum restriction. Pattern is fragile if extended.
- **Remediation:** Add `z.enum(['queued','running','completed','failed']).optional()` at route layer.

### ME-15: `useNotifications` — `JSON.parse` on unvalidated payload may throw silently
- **File:** `packages/dashboard/app/composables/useNotifications.ts:28`
- **Category:** Dashboard — Error Handling
- **Description:** `JSON.parse(msg.notification.payload)` called without try/catch. Malformed payloads silently discard the notification.
- **Remediation:** Wrap in try/catch or parse with Zod.

### ME-16: `useNotifications` — `unreadCount` desyncs from `notifications` array
- **File:** `packages/dashboard/app/composables/useNotifications.ts:34-39`
- **Category:** Dashboard — Reactivity
- **Description:** Separate `ref` incremented manually; not adjusted when array is capped at 50 entries.
- **Remediation:** Replace with `computed(() => notifications.value.filter(n => !n.read).length)`.

### ME-17: `useNotifications` registers lifecycle hooks — breaks if called outside component
- **File:** `packages/dashboard/app/composables/useNotifications.ts:56-57`
- **Category:** Dashboard — Lifecycle
- **Description:** `onMounted`/`onUnmounted` called internally; if used from store/plugin, Vue warns and cleanup leaks.
- **Remediation:** Document usage constraint or refactor to return `init`/`teardown` functions.

### ME-18: `useReplay` — no `onUnmounted` cleanup
- **File:** `packages/dashboard/app/composables/useReplay.ts:101-105`
- **Category:** Dashboard — Memory Leak
- **Description:** `dispose()` exists but is never called on unmount. Replay `setTimeout` chain continues after navigation.
- **Remediation:** Add `onUnmounted(() => dispose())`.

### ME-19: `useReplay` — unbounded recursive `setTimeout` chain
- **File:** `packages/dashboard/app/composables/useReplay.ts:83-98`
- **Category:** Dashboard — Performance
- **Description:** Burst-heavy recordings create synchronous-feeling timer chains with 0ms delays, blocking main thread.
- **Remediation:** Batch chunks with `ts` delta = 0 into a single write call.

### ME-20: `queues` store — `fetchQueues()` without `machineId` drops result
- **File:** `packages/dashboard/app/stores/queues.ts:17-22`
- **Category:** Dashboard — Correctness
- **Description:** When `machineId` is absent, fetched data is parsed but never stored.
- **Remediation:** Make `machineId` required, or handle global results.

### ME-21: `approvals` store — `bulkRespond` does not check HTTP response status
- **File:** `packages/dashboard/app/stores/approvals.ts:53-60`
- **Category:** Dashboard — Error Handling
- **Description:** Failed bulk approvals appear successful until re-fetch reveals unchanged state.
- **Remediation:** Add `if (!res.ok) throw new Error(...)` after the fetch call.

### ME-22: `useWebSocket` — `onMessage` loses discriminated-union narrowing
- **File:** `packages/dashboard/app/composables/useWebSocket.ts:154`
- **Category:** Dashboard — TypeScript
- **Description:** Type parameter is plain `string`; callers need manual narrowing guards. No compile-time guarantee.
- **Remediation:** Use generic overload: `onMessage<T extends HubToDashboardMessage['type']>(type: T, handler: ...)`.

### ME-23: `sessions` store — `msg.session` accessed without null-safety guard
- **File:** `packages/dashboard/app/stores/sessions.ts:37-38`
- **Category:** Dashboard — Correctness
- **Description:** `msg.session.id` accessed after `&&` check but without TypeScript narrowing guarantee.
- **Remediation:** Verify Zod schema ensures `session` is always present, or add explicit null-check.

### ME-24: `machines` store — same `msg.machine` access pattern without guard
- **File:** `packages/dashboard/app/stores/machines.ts:37-38`
- **Category:** Dashboard — Correctness
- **Description:** Same pattern as sessions store; runtime TypeError risk on malformed messages.
- **Remediation:** Same as ME-23.

---

## Low Findings

### LO-01: `console.log` in production WebSocket composable
- **File:** `packages/dashboard/app/composables/useWebSocket.ts:86`
- Remove or gate behind `import.meta.dev`.

### LO-02: No rate limiting on any API endpoint
- **File:** `packages/hub/src/server.ts`
- Add `@fastify/rate-limit` for session creation, queue, and recording upload paths.

### LO-03: `getRecordingMeta` returns absolute filesystem path in API response
- **File:** `packages/hub/src/recordings.ts:19-22`
- Remove `path` field from response or replace with relative identifier.

### LO-04: SSRF blocklist bypassable via IPv6 and substring hostname matching
- **File:** `packages/hub/src/notifications.ts:56-72`
- Expand IPv6 blocklist. Use exact domain matching. Check resolved IP post-DNS.

### LO-05: `DashboardHandler.dispose()` does not close open sockets
- **File:** `packages/hub/src/ws/dashboard-handler.ts:131-133`
- Iterate and `socket.terminate()` each client before clearing.

### LO-06: Server shutdown never calls `dashboardHandler.dispose()`
- **File:** `packages/hub/src/server.ts:117-123`
- Add `dashboardHandler.dispose()` to shutdown sequence.

### LO-07: `PtySession.kill()` setTimeout has no stored reference — leaks session object
- **File:** `packages/agent/src/session.ts:113-117`
- Store timer in `this.killTimer` and clear in `cleanup()`.

### LO-08: `queueRoutes` uses undeclared global `crypto.randomUUID()`
- **File:** `packages/hub/src/routes/queues.ts:31`
- Import from `node:crypto`.

### LO-09: Session resume redundant `updateSession` call; `parent_session_id` never persisted
- **File:** `packages/hub/src/routes/sessions.ts:120`
- Remove redundant call. Add proper `parentSessionId` persistence.

### LO-10: `queues` store — `Map` in `ref` breaks Vue reactivity
- **File:** `packages/dashboard/app/stores/queues.ts:6`
- Use `reactive(new Map())` or plain object `ref<Record<string, QueueTask[]>>({})`.

### LO-11: `useTerminal` — `ResizeObserver` not cleared if container element changes
- **File:** `packages/dashboard/app/composables/useTerminal.ts:48-52`
- Disconnect and re-observe in a `watch(containerRef, ...)`.

### LO-12: `useWebSocket` — singleton `initialized` flag not reset in `disconnect()`
- **File:** `packages/dashboard/app/composables/useWebSocket.ts:174`
- Also set `_global.__chq_ws_init = false` inside `disconnect()`.

### LO-13: `useWebSocket` — `_global` mirror not kept in sync with local variables
- **File:** `packages/dashboard/app/composables/useWebSocket.ts:25-28`
- Assign back to `_global` whenever local variables change.

### LO-14: `approvals` store — URL parameter interpolated without encoding
- **File:** `packages/dashboard/app/stores/approvals.ts:17`
- Use `URLSearchParams` for safe URL construction.

---

## Info

### IN-01: `readonlyRootfs: true` may conflict with Claude Code filesystem writes
- **File:** `packages/agent/src/container-security.ts:44`
- Document explicitly. Verify all write paths are covered by tmpfs/workspace mount.

### IN-02: `--dangerously-skip-permissions` always active in PTY pool
- **File:** `packages/agent/src/pty-pool.ts:55`, `packages/agent/src/container-pool.ts:82`
- For non-containerized PTY sessions, document the security assumption.

### IN-03: `hub:session:start` reused as job orchestration command — semantic mismatch
- **File:** `packages/hub/src/routes/jobs.ts:93-99`
- Dedicated `hub:container:create` type exists in `@chq/shared/workforce` but is never used.

### IN-04: `console.error` in Hub entry point
- **File:** `packages/hub/src/index.ts:14`
- Pre-create pino logger for structured fatal error logging.

---

## Findings Summary

| Severity | Count | Packages Affected |
|----------|-------|-------------------|
| Critical | 2 | hub |
| High | 7 | hub, agent, shared |
| Medium | 24 | hub, agent, dashboard |
| Low | 14 | hub, agent, dashboard |
| Info | 4 | agent, hub |
| **Total** | **51** | |

### By Category

| Category | Count |
|----------|-------|
| Security (auth, injection, exposure) | 16 |
| Data Integrity (transactions, atomicity) | 4 |
| Performance (SQLite, rendering) | 5 |
| Correctness (logic, protocol) | 10 |
| Architecture (patterns, design) | 5 |
| Lifecycle (cleanup, leaks) | 7 |
| Dashboard Reactivity | 4 |

---

## Recommended Fix Priority

### Sprint N+1: Security & Critical Fixes
1. **CR-01 + CR-02:** Fix GitHub webhook HMAC (rawBody plugin + deny unsigned)
2. **HI-01:** PTY input sanitization + size limit
3. **HI-02:** Recording path traversal validation
4. **HI-03:** API authentication middleware
5. **ME-01:** Wire scrubber into output pipeline
6. **ME-02:** Hook endpoint authentication
7. **ME-03:** Git clone URL validation
8. **ME-04:** Agent WebSocket authentication

### Sprint N+2: Data Integrity & Correctness
9. **HI-04:** Symlink resolution for container paths
10. **HI-05:** Queue insert atomicity
11. **HI-06:** PR creation atomicity
12. **HI-07:** Hoist all `db.prepare()` to module scope
13. **ME-08 through ME-14:** Backend correctness fixes

### Sprint N+3: Dashboard Quality
14. **ME-15 through ME-24:** Dashboard reactivity, lifecycle, error handling
15. **LO-01 through LO-14:** Low-priority cleanup

---

## Recommendation

**Do not deploy to production** until CR-01, CR-02, HI-01, HI-02, HI-03, and ME-01 are resolved. The GitHub webhook HMAC is completely non-functional, the entire API surface is unauthenticated, PTY input is unsanitized, and the scrubber (designed to prevent secret leakage) is implemented but never called.
