---
title: Claude HQ - Architecture Validation Report
version: 1.0
date: 2026-03-15
status: complete
---

# Claude HQ Architecture Validation

Research conducted March 15, 2026 to validate the v0.2 architecture against the current Claude Code ecosystem.

## Executive Summary

The core architecture is sound, but three discoveries from March 2026 significantly improve it:

1. **Claude Code HTTP Hooks** should replace terminal output parsing for session state detection
2. **Claude Agent SDK** should be used for programmatic follow-ups (resume mode) instead of CLI `--resume`
3. **Several new CLI features** (`-n/--name`, `/color`, `/loop`, `--output-format stream-json`) can be leveraged directly

The PTY wrapper approach remains correct for the live terminal view feature. No existing tool (Remote Control, OpenClaw, runCLAUDErun) covers our multi-machine orchestration use case.

## Discovery 1: Claude Code HTTP Hooks (Critical Architecture Change)

Claude Code v2.1.71+ (March 2026) supports **HTTP hooks** that POST JSON to endpoints on lifecycle events. This is a game-changer for our state detection and notification system.

### What Hooks Give Us

| Hook Event | Fires When | What We Get |
|---|---|---|
| `SessionStart` | Session starts or resumes | Session ID, model, working directory |
| `Stop` | Claude finishes responding | Session idle notification |
| `Notification` | Permission prompt, idle prompt | "Input needed" detection (no regex parsing!) |
| `PreToolUse` | Before any tool call | Live tool activity feed |
| `PostToolUse` | After tool completes | Tool results, file changes |
| `SubagentStart` | Sub-agent spawns | Multi-agent activity tracking |
| `SubagentStop` | Sub-agent finishes | Sub-agent completion |
| `PreCompact` | Before context compaction | Context health indicator |

### How To Integrate

Configure HTTP hooks in each machine's `~/.claude/settings.json` to POST to the Hub:

```json
{
  "hooks": {
    "Stop": [{
      "matcher": "",
      "hooks": [{
        "type": "http",
        "url": "http://100.x.x.x:7700/hooks/stop",
        "timeout": 5
      }]
    }],
    "Notification": [{
      "matcher": "",
      "hooks": [{
        "type": "http",
        "url": "http://100.x.x.x:7700/hooks/notification",
        "timeout": 5
      }]
    }],
    "PreToolUse": [{
      "matcher": "",
      "hooks": [{
        "type": "http",
        "url": "http://100.x.x.x:7700/hooks/pre-tool-use",
        "timeout": 5
      }]
    }],
    "PostToolUse": [{
      "matcher": "",
      "hooks": [{
        "type": "http",
        "url": "http://100.x.x.x:7700/hooks/post-tool-use",
        "timeout": 5
      }]
    }],
    "SubagentStart": [{
      "matcher": "",
      "hooks": [{
        "type": "http",
        "url": "http://100.x.x.x:7700/hooks/subagent-start",
        "timeout": 5
      }]
    }],
    "SubagentStop": [{
      "matcher": "",
      "hooks": [{
        "type": "http",
        "url": "http://100.x.x.x:7700/hooks/subagent-stop",
        "timeout": 5
      }]
    }]
  }
}
```

### Architecture Impact

**Before (v0.2):** Dashboard parses ANSI terminal output with regex patterns to detect session state (`processing`, `waitingForInput`, `subAgentRunning`). Fragile, version-dependent, and unreliable.

**After (v0.3):** Hub receives structured JSON events directly from Claude Code. Dashboard gets real state from the source of truth. The PTY stream is purely for terminal rendering.

This means:
- **Remove** `SessionStateIndicator` regex-based detection entirely
- **Add** Hub hook receiver endpoints (simple Fastify routes)
- **Add** `session_events` table to store hook events for replay metadata
- **Notifications become trivial:** `Stop` hook fires, Hub checks config, dispatches webhook. No output parsing needed.
- **"Input needed" detection is free:** The `Notification` hook with `notification_type: "permission_prompt"` or `"idle_prompt"` fires exactly when Claude needs attention

**Important caveat:** Hooks snapshot at session startup. The agent daemon should write `.claude/settings.json` hooks config before spawning Claude Code sessions, pointing to the Hub's Tailscale IP.

## Discovery 2: Claude Agent SDK (TypeScript)

The `@anthropic-ai/claude-agent-sdk` package provides programmatic session control with the same capabilities as Claude Code.

### What the SDK Offers

```typescript
import { query, listSessions } from "@anthropic-ai/claude-agent-sdk";

// Start a session programmatically
for await (const msg of query({
  prompt: "Fix the auth bug",
  options: {
    model: "opus",
    permissionMode: "bypassPermissions",
    maxTurns: 250,
  }
})) {
  // Structured messages: system, assistant, tool, result
  if (msg.type === "result") {
    console.log("Session ID:", msg.session_id);
    console.log("Cost:", msg.cost_usd);
    console.log("Tokens:", msg.usage);
  }
}

// Resume a session
for await (const msg of query({
  prompt: "Now add tests",
  options: { resume: sessionId }
})) { ... }

// List past sessions
const sessions = await listSessions({ dir: "/path/to/project", limit: 10 });

// V2 preview: session-based API
const session = unstable_v2_createSession({ model: "claude-opus-4-6" });
await session.send("Fix the bug");
for await (const msg of session.stream()) { ... }
```

### Architecture Impact

**For Resume Mode specifically:** The SDK is cleaner than spawning `claude -p --resume` as a subprocess. It gives us:
- Session ID tracking built-in
- Structured result messages with cost/token data
- Fork capability (branch a session without modifying the original)
- Error handling with typed subtypes (`success`, `error_max_turns`, `error_max_budget_usd`)

**Recommendation:** Use the Agent SDK for resume/follow-up operations while keeping PTY for live interactive sessions. The SDK spawns its own Claude Code subprocess internally, so it handles process lifecycle for us.

**Tradeoff:** SDK resume sessions won't produce raw terminal output for xterm.js. The dashboard would need to render SDK structured messages as a rich UI for follow-up sessions, or fall back to PTY mode for those too. Easiest path: always use PTY, use SDK only for `listSessions()` and session ID discovery.

### Revised Recommendation

Use SDK for:
- Session discovery (`listSessions()`)
- Session ID extraction (read from `~/.claude/projects/` transcripts)
- Cost/token tracking from result messages
- Potentially for queue auto-advance (headless fire-and-forget tasks where terminal view isn't needed)

Keep PTY for:
- All interactive sessions (live terminal view is the core feature)
- Any session the user might want to watch or interact with

## Discovery 3: March 2026 Claude Code Features to Leverage

### `-n / --name` flag (v2.1.76)

Sets a display name for the session at startup. Our agent should use this:

```bash
claude -n "chq:studio-pc:abc123" -p "Fix the auth bug" --dangerously-skip-permissions
```

This makes session identification trivial in `listSessions()` output and in the `/resume` picker.

### `/color` command (v2.1.75)

Sets the prompt bar color per session. When running multiple sessions on one machine, each PTY could use a different color. Not critical for our use case (dashboard handles visual distinction) but worth noting.

### `/loop` and cron scheduling (v2.1.71)

Session-scoped recurring prompt execution. **Our queue system fills a different need** (persistent, cross-machine, survives session restarts). However, we could expose `/loop` functionality through the dashboard for "watch this and tell me when it changes" patterns within a running session by sending it as PTY input.

### `--output-format stream-json` 

NDJSON streaming output in headless mode. Could be useful for queue tasks where terminal fidelity isn't needed. The agent could run queued tasks in stream-json mode for structured output capture, then switch to PTY mode when the user opens the session in the dashboard.

### Agent Teams (experimental)

Agent teams spawn multiple Claude Code processes coordinated by a lead. Key implications:
- One "session" in our system might involve multiple Claude Code processes on the machine
- The lead session is the only one we need to PTY-wrap (teammates are managed by the lead)
- Agent teams don't survive `/resume` (known limitation), which validates our design of treating follow-ups as new sessions
- Each teammate is a full Claude instance with its own context window (token-intensive)

### MCP Elicitation (v2.1.76)

MCP servers can now request structured input mid-task via interactive dialogs. This means our PTY input handling needs to account for MCP elicitation prompts in addition to `AskUserQuestion` prompts.

### Hooks snapshot behavior

Hooks are captured at session startup and don't change mid-session. If hooks are modified externally, Claude Code warns and requires review. This means our agent must write the hooks config BEFORE spawning sessions, and can't update hook URLs mid-session.

## Competitive Landscape Validation

| Tool | Multi-machine | Multi-session | Queue | Terminal View | Replay | Notifications | Self-hosted |
|---|---|---|---|---|---|---|---|
| **Claude HQ** (ours) | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `claude remote-control` | No (1 machine) | No (1 session) | No | Via claude.ai | No | No | N/A |
| OpenClaw | Single server | Limited | Yes (scheduled) | No (chat-based) | No | Yes (messaging) | Yes |
| runCLAUDErun | Single Mac | Limited | Yes (scheduled) | No | No | No | Yes (macOS only) |
| JessyTsui/Claude-Code-Remote | Single machine | No | No | No | No | Yes (email/Discord/Telegram) | Yes |
| n8n + hooks pattern | Single machine | No | Via n8n | No | No | Yes (any channel) | Yes |

**Conclusion:** Nothing in the ecosystem covers our multi-machine orchestration use case. The closest patterns are hooks-based notification systems (n8n, custom webhook servers), but none provide a unified dashboard with live terminal streaming across machines.

## Revised Architecture Recommendations (v0.3 changes)

### 1. Add HTTP Hooks Integration

New component in the Hub: hook receiver routes. Each agent machine configures Claude Code hooks to POST to the Hub over Tailscale.

```
Hub Routes (new):
POST /hooks/stop              -> Update session status, trigger notifications
POST /hooks/notification      -> Forward to dashboard, trigger "input needed" alert
POST /hooks/pre-tool-use      -> Live activity feed
POST /hooks/post-tool-use     -> Tool activity log
POST /hooks/subagent-start    -> Sub-agent tracking
POST /hooks/subagent-stop     -> Sub-agent completion
```

New DB table:
```sql
CREATE TABLE session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT REFERENCES sessions(id),
  event_type TEXT NOT NULL,       -- stop, notification, pre_tool_use, etc.
  payload TEXT NOT NULL,          -- raw JSON from hook
  received_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_events_session ON session_events(session_id, received_at);
```

### 2. Agent Setup Step

The agent daemon should manage Claude Code hooks configuration:
- On `chq agent start`, write/merge hooks config into `~/.claude/settings.json`
- Point hook URLs to the Hub's Tailscale IP
- On `chq agent stop`, optionally clean up hooks config

### 3. Remove Regex State Detection

Replace the `STATE_PATTERNS` regex approach with hook-driven state:

```typescript
// Before: fragile regex on terminal output
const STATE_PATTERNS = { processing: [/spinner/], waitingForInput: [/\(Y\/n\)/] };

// After: structured events from hooks
// Hub receives POST /hooks/notification with:
// { notification_type: "permission_prompt", message: "Allow file write?" }
// Hub broadcasts to dashboard: { type: "session:input_needed", sessionId, prompt }
```

### 4. Dual-Mode Queue Execution

Queued tasks that nobody is watching can run in **SDK headless mode** (structured output, cost tracking, no PTY overhead). When a user opens the session in the dashboard, it could optionally attach to a PTY-mode session instead.

Simpler alternative: always use PTY (consistent behavior, recording always available). The cost tracking from hooks + SDK `listSessions()` is sufficient.

**Recommendation: Always PTY for v1.** Revisit SDK headless mode for queue optimization later.

### 5. Session Naming Convention

Use the `-n` flag when spawning sessions:

```bash
claude -n "chq:${machineId}:${sessionId}" -p "${prompt}" --dangerously-skip-permissions
```

This makes session discovery and correlation trivial.

### 6. Notification System Simplification

Hooks dramatically simplify notifications:

**Before:** Agent parses terminal output for completion patterns, streams to Hub, Hub detects state change, dispatches notification.

**After:** Claude Code fires `Stop` hook -> Hub receives POST -> Hub checks notification config -> Hub dispatches webhook + dashboard push. Three steps, no parsing.

The `Notification` hook with `idle_prompt` type handles "input needed" detection automatically. The `SubagentStop` hook tells us when sub-agents complete.

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Hooks snapshot at startup; can't update URLs mid-session | Medium | Agent writes hooks config before spawning. Sessions must restart to pick up config changes. |
| Agent teams create multiple processes; PTY only wraps the lead | Low | Document that teammate output is managed by the lead. Dashboard shows lead session. |
| SDK V2 is unstable preview | Low | Use V1 stable API for any SDK integration. |
| `node-pty` native module requires per-platform builds | Medium | Provide install instructions per OS. Consider prebuilt binaries. |
| Claude Code version changes could break hooks | Low | Hooks are a stable, documented API. Pin minimum Claude Code version. |
| Large recordings could fill Hub disk | Medium | Retention policy with configurable max age/size. Already planned for Phase 4. |
| Tailscale must be running for agent-hub communication | Low | Assumed. Agent should warn if Tailscale is down. |
| `--dangerously-skip-permissions` doesn't propagate via Remote Control | Info | Not relevant (we're not using Remote Control), but worth knowing. |

## Updated Phase Plan

### Phase 1: Agent + Hub Core (no changes)
Same as v0.2, plus:
- Agent writes hooks config on startup
- Hub adds hook receiver routes

### Phase 2: Dashboard + Notifications (simplified)
- Notifications are now trivial via hooks (no output parsing)
- State detection uses hook events instead of regex
- Add session events timeline to session view

### Phase 3: Replay + Queue + Resume (minor changes)
- Session events from hooks enrich the replay timeline (show tool use markers, sub-agent activity)
- Resume uses SDK `listSessions()` for session discovery
- `-n` flag for session naming

### Phase 4: Polish (unchanged)
Same as v0.2.

## Conclusion

The v0.2 architecture is validated with three improvements:

1. **HTTP Hooks** replace fragile regex state detection and simplify notifications to near-zero effort
2. **Agent SDK** provides clean session discovery and optional headless execution for queued tasks
3. **`-n` flag** enables reliable session correlation between our system and Claude Code's internal tracking

The PTY wrapper approach remains the right choice for the live terminal view. No existing tool covers our multi-machine orchestration use case. The biggest risk (hooks snapshot behavior) is easily mitigated by writing config before session spawn.
