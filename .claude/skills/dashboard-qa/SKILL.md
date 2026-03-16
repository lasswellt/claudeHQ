---
name: dashboard-qa
description: |
  Automated browser QA for the claudeHQ dashboard. Navigates pages, captures
  console/network errors, tests interactions. Auto-fixes issues.
  Use when: "test dashboard", "check pages", "smoke test", "browse"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, ToolSearch, AskUserQuestion
disable-model-invocation: true
model: opus
argument-hint: "[mode] [target] -- modes: full | smoke | page <path> | fix"
---

# Dashboard QA: Automated Browser Testing for claudeHQ

Automated browser QA for the claudeHQ dashboard. Navigates all routes, captures
console and network errors, tests safe interactions, validates xterm.js rendering,
and optionally auto-fixes discovered issues.

## Phase 0: PARSE ARGUMENTS

Parse `$ARGUMENTS` to determine mode and target:

| Mode | Description | Routes |
|---|---|---|
| `full` (default) | Crawl all routes, full interaction testing | All routes |
| `smoke` | Quick health check of key routes | Smoke test set (~6 routes) |
| `page <path>` | Test a single specific route | The specified path |
| `fix` | Re-test previously failed routes and auto-fix | Routes from last report |

If no arguments provided, default to `smoke` mode.

Store parsed mode and target for use in subsequent phases.

## Phase 1: PREREQUISITES

### 1.1 Verify Dev Server

Check if the Nuxt dev server is running:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```

If not running:
- Check if `packages/dashboard/` exists
- Suggest: `cd packages/dashboard && pnpm dev`
- Ask user if they want to start the server
- STOP if server is not available — browser testing requires a running server

### 1.2 Load Playwright MCP Tools

Use ToolSearch to find and load Playwright MCP tools:
- `mcp__plugin_playwright_playwright__browser_navigate`
- `mcp__plugin_playwright_playwright__browser_snapshot`
- `mcp__plugin_playwright_playwright__browser_take_screenshot`
- `mcp__plugin_playwright_playwright__browser_click`
- `mcp__plugin_playwright_playwright__browser_console_messages`
- `mcp__plugin_playwright_playwright__browser_network_requests`
- `mcp__plugin_playwright_playwright__browser_press_key`
- `mcp__plugin_playwright_playwright__browser_wait_for`
- `mcp__plugin_playwright_playwright__browser_evaluate`
- `mcp__plugin_playwright_playwright__browser_resize`

If Playwright MCP is not available, STOP and inform the user that browser-based
QA requires the Playwright MCP server to be configured.

### 1.3 Load Route Manifest

Use the built-in route manifest for test navigation:

**Full Route Set:**

| Route | Description | Key Elements |
|---|---|---|
| `/` | Overview | Machine cards, session list, system health indicators |
| `/machines/:id` | Machine Detail | Session list, queue, metrics, machine info card |
| `/sessions/:id` | Live Session | xterm.js terminal, session info bar, action buttons |
| `/sessions/:id/replay` | Session Replay | xterm.js terminal, timeline controls, speed selector |
| `/sessions/grid` | Session Grid | 2x2 or 1x4 terminal grid, focus indicators |
| `/queues` | Queue Manager | Cross-machine queue table, drag handles, action buttons |

**Smoke Test Set (~6 routes):**

| Route | Why Included |
|---|---|
| `/` | Entry point, loads all stores, WebSocket connection |
| `/machines/:id` | First available machine (or mock ID) |
| `/sessions/:id` | First available session (or mock ID) |
| `/sessions/:id/replay` | Replay view (tests recording loading) |
| `/sessions/grid` | Grid layout (tests multi-terminal) |
| `/queues` | Queue manager (tests table rendering) |

For routes with `:id` parameters, discover valid IDs from the overview page
or use sensible defaults if data isn't available.

## Phase 2: VERIFY AUTH

### 2.1 Check Access

Navigate to `/` and verify:
- Page loads without 401/403 errors
- No Tailscale auth redirect (if auth is configured)
- Content is visible (not a login page)

If auth is required:
- Check for Tailscale authentication headers
- Inform user about access requirements
- STOP if access is denied

### 2.2 Establish Baseline

On the overview page:
- Take a screenshot as baseline
- Record initial console messages (filter out noise)
- Record initial network requests
- Note WebSocket connection status indicators

## Phase 3: ROUTE CRAWL

For each route in the target set (determined by mode):

### 3.1 Navigate

```
Navigate to route
Wait for page load (network idle or specific element)
Record load time
```

### 3.2 Capture Console Errors

Check console messages for:
- **Critical:** Uncaught exceptions, unhandled promise rejections
- **Error:** Console.error calls, Vue warnings, component errors
- **Warning:** Deprecation warnings, missing props, invalid handlers
- **Info:** General console.log (record but don't flag)

Classify each by severity and source (Vue, Vuetify, xterm.js, WebSocket, app code).

### 3.3 Capture Network Requests

Check network requests for:
- **Failed requests** (4xx, 5xx status codes)
- **WebSocket connection failures**
- **Slow requests** (> 3 seconds)
- **CORS errors**
- **Missing resources** (404 for assets, fonts, etc.)

### 3.4 Content Quality

Take a snapshot (accessibility tree) and verify:
- Page has meaningful content (not empty/blank)
- Key UI elements are present per route manifest
- Text is readable (no raw HTML, no template syntax leaking)
- Loading states resolve within reasonable time
- Error states show user-friendly messages

### 3.5 Safe Interactions

Test safe UI interactions on each page.

**SAFETY RULES (NON-NEGOTIABLE):**

```
============================================================
              INTERACTION SAFETY RULES
============================================================

NEVER click:
  - "Kill Session" / "Kill" / "Stop" / "Terminate"
  - "Delete" / "Remove" (when it would delete data)
  - "Stop Agent" / "Force Kill" / "Force Stop"
  - "Confirm" in any destructive confirmation dialog
  - "Submit" on forms that start sessions or queue tasks
  - Any button with text matching: kill|delete|remove|stop|
    terminate|destroy|force|submit|start|create|launch

NEVER do:
  - Submit forms that would start sessions or queue tasks
  - Send PTY/terminal input to active sessions
  - Interact with confirmation dialogs — press Escape immediately
  - Modify queue order or priority
  - Change agent configuration

SAFE to interact with:
  - Tabs and tab switches
  - Sort controls (column headers in tables)
  - Pagination controls (next, previous, page numbers)
  - Expand/collapse toggles (accordions, tree nodes)
  - View mode toggles (grid/list, layout switches)
  - Theme toggles (dark/light mode)
  - Search/filter inputs (type text, don't submit)
  - Breadcrumb navigation
  - Sidebar navigation links
  - Tooltip triggers (hover)
  - Info/help icons
============================================================
```

For each safe interaction:
1. Identify the element
2. Click/interact
3. Verify the UI responds appropriately
4. Check for new console errors after interaction
5. Navigate back if needed

### 3.6 xterm.js Specific Checks

On pages with terminal views (`/sessions/:id`, `/sessions/:id/replay`, `/sessions/grid`):

1. **Terminal renders content:**
   - Check that the terminal container has a canvas or DOM element
   - Evaluate: `document.querySelector('.xterm-screen')` exists
   - Verify terminal is not just a blank black box (has text content)

2. **No ANSI artifacts:**
   - Check visible text for raw escape sequences (`\x1b[`, `\033[`)
   - Verify color rendering (text should have color, not escape codes)

3. **Fit addon works:**
   - Resize the browser window
   - Verify terminal re-fits to container
   - No horizontal scrollbar on the terminal
   - No content clipping

4. **WebGL addon status:**
   - Check for WebGL context creation (evaluate JS to check)
   - If WebGL fails, verify canvas fallback renders correctly

### 3.7 WebSocket Health Checks

On every page:
1. Look for WebSocket connection indicators (status badges, icons)
2. Verify indicator shows correct state:
   - Connected: green indicator
   - Disconnected: red indicator with reconnect attempt
   - Reconnecting: yellow/orange indicator
3. Check that WebSocket messages are flowing (network tab)

## Phase 4: ERROR CLASSIFICATION

Classify all discovered issues:

### Critical (must fix before release)
- Uncaught exceptions that crash the page
- Blank/white pages (render failure)
- WebSocket connection completely broken
- Terminal views showing nothing
- Data loss scenarios

### Error (should fix)
- Console errors from application code
- Failed API/network requests
- Components not rendering correctly
- Missing data on pages
- Broken interactions

### Warning (nice to fix)
- Vue warnings (missing props, invalid handlers)
- Deprecation notices
- Slow load times (> 3 seconds)
- Minor layout issues
- Accessibility gaps

### Info (for awareness)
- Console.log statements (should be removed for production)
- Network requests that could be optimized
- Unused CSS or JavaScript
- Performance suggestions

## Phase 5: AUTO-FIX (fix mode only)

Only execute in `fix` mode. For each Critical and Error issue:

### 5.1 Diagnose

1. Read the error message and stack trace
2. Identify the source file and line number
3. Read the source file
4. Understand the root cause

### 5.2 Fix

For each fixable issue:
1. Determine the minimal fix
2. Apply the fix using Edit tool
3. Wait for HMR (Hot Module Replacement) to update
4. Re-navigate to the affected route
5. Verify the fix resolves the issue
6. Record the fix in the report

### 5.3 Fix Categories

Common fixes to apply:

- **Missing null checks:** Add optional chaining or v-if guards
- **Missing imports:** Add import statements
- **Type errors:** Fix TypeScript type mismatches
- **Missing props:** Add default values or required props
- **Lifecycle issues:** Move code to correct lifecycle hook
- **Dispose issues:** Add onUnmounted cleanup for terminals
- **WebSocket errors:** Add connection error handling

### 5.4 Limits

- Only fix issues with clear, unambiguous solutions
- Do not refactor or restructure code
- Do not change behavior, only fix bugs
- If a fix is unclear, add it to the report as "needs manual review"
- Maximum 10 auto-fixes per run

## Phase 6: REPORT

Write the QA report to `docs/reports/dashboard-qa-YYYY-MM-DD.md`:

```markdown
# Dashboard QA Report — YYYY-MM-DD

## Summary

| Metric | Value |
|---|---|
| Mode | full / smoke / page / fix |
| Routes tested | N |
| Total issues | N |
| Critical | N |
| Errors | N |
| Warnings | N |
| Auto-fixed | N (fix mode only) |
| Duration | Nm Ns |

## Route Results

### / (Overview)
- **Status:** PASS / FAIL
- **Load time:** Nms
- **Console errors:** N
- **Network failures:** N
- **Issues:**
  - [CRITICAL] Description...
  - [ERROR] Description...

### /machines/:id (Machine Detail)
- ...

## xterm.js Report

| Check | Status |
|---|---|
| Terminal renders content | PASS/FAIL |
| No ANSI artifacts | PASS/FAIL |
| Fit addon resize | PASS/FAIL |
| WebGL rendering | PASS/FAIL/FALLBACK |

## WebSocket Report

| Check | Status |
|---|---|
| Connection established | PASS/FAIL |
| Indicator state correct | PASS/FAIL |
| Messages flowing | PASS/FAIL |

## Issues Detail

### Critical Issues
1. **[route]** Description
   - File: `path/to/file.vue:NN`
   - Error: `error message`
   - Fix: (auto-fixed / needs manual review)

### Errors
...

### Warnings
...

## Auto-Fixes Applied (fix mode only)

| # | File | Issue | Fix |
|---|---|---|---|
| 1 | path/to/file.vue | Missing null check | Added optional chaining |
| ... | | | |

## Recommendations

1. ...
2. ...
```

## Phase Final: REGISTER

1. **Register findings as incompletes:**
   - Each Critical and Error issue becomes an incomplete entry
   - Include file path, line number, description
   - Link to QA report

2. **Log execution:**
   - Record skill invocation, mode, route count, issue count
   - Record duration and timestamp
   - Note auto-fixes applied (if fix mode)
