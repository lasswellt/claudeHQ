---
title: "Docs Audit: Architecture Documents Analysis & Validation"
date: 2026-03-15
tags: [architecture, validation, docs, libraries, hooks, agent-sdk]
status: complete
related: []
packages: [agent, hub, dashboard, shared]
---

# Docs Audit: Architecture Documents Analysis & Validation

## Summary

The `docs/` directory contains two files — a comprehensive architecture design (v0.2) and a validation report proposing v0.3 improvements. The architecture is well-designed but implementation has not started (zero source code exists). The validation report's claims about Claude Code HTTP hooks are **partially inaccurate** (several events don't support HTTP hooks), and the xterm.js import paths in the architecture and project rules are **outdated** (must use `@xterm/` scoped packages since v5.4).

## Research Questions

1. What documents exist in `docs/` and what do they cover?
2. How much of the architecture has been implemented?
3. Are the validation report's claims about Claude Code features accurate?
4. Are the specified library versions and APIs current?
5. What inconsistencies or gaps need attention before implementation?

## Findings

### Document Inventory

| File | Size | Purpose |
|------|------|---------|
| `claude-hq-architecture.md` | 770 lines, v0.2.0 | Full system design: components, protocol, schema, API routes, data flows, phases |
| `claude-hq-validation-report.md` | 350 lines, v1.0 | Validates v0.2 against March 2026 Claude Code features; proposes v0.3 changes |

The architecture doc is thorough and covers all four packages (agent, hub, dashboard, shared) with detailed specifications for WebSocket protocol, SQLite schema, REST API routes, recording format, notification system, and a 4-phase implementation plan.

The validation report proposes three key improvements: HTTP hooks for state detection, Agent SDK for session management, and the `-n` flag for session naming.

### Implementation Status: Zero

- No `packages/` directory exists
- No `package.json`, `pnpm-workspace.yaml`, or `turbo.json` at root
- No `.ts`, `.vue`, or `.js` source files anywhere in the repo
- Git history: single commit with `.gitignore` only
- The `.claude/` directory has comprehensive project configuration (8 rules, 6 agents, 11 skills, 4 commands, hooks) — ready for AI-assisted development

### HTTP Hooks Claims — Partially Inaccurate

The validation report claims HTTP hooks fire for: `SessionStart`, `Stop`, `Notification`, `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop`, `PreCompact`.

**Reality:** HTTP hooks are only supported on a subset of events:
- **HTTP-capable:** `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `TaskCompleted`
- **Command-hook-only (no HTTP):** `SessionStart`, `SessionEnd`, `Notification`, `SubagentStart`, `PreCompact`, `PostCompact`, `InstructionsLoaded`, `ConfigChange`

**Impact on architecture:**
- The `Notification` hook **cannot** be used as an HTTP hook — the proposed "input needed" detection via HTTP POST won't work as described. A command hook could write to a file or call curl, but it's not a native HTTP hook.
- `SessionStart` as an HTTP hook also won't work. Session registration must rely on the agent daemon reporting session start via WebSocket (the v0.2 approach was correct).
- `SubagentStart` is command-hook-only. Sub-agent tracking via HTTP hooks requires using `SubagentStop` (which is HTTP-capable) combined with the agent daemon's own tracking.
- `Stop`, `PreToolUse`, `PostToolUse`, and `SubagentStop` HTTP hooks work as described.

**Additional events not mentioned in the report:** `PostToolUseFailure`, `PermissionRequest`, `UserPromptSubmit`, `TaskCompleted`, `TeammateIdle`, `Elicitation`, `ElicitationResult`, `WorktreeCreate`, `WorktreeRemove` — several of these are valuable for the dashboard.

### Agent SDK — Confirmed with Extras

`@anthropic-ai/claude-agent-sdk` is confirmed on npm. The `query()` and `listSessions()` APIs match the report's description. Additional functions not mentioned: `tool()`, `createSdkMcpServer()`, `getSessionMessages()`. The V2 preview API with `send()`/`stream()` is also available.

### CLI Flags — All Confirmed

- `-n`/`--name`: Sets display name, usable with `--resume <name>`
- `--output-format stream-json`: Emits NDJSON in print mode
- Both work as described in the validation report

### Competitive Landscape — Confirmed

OpenClaw and runCLAUDErun are real third-party tools (not Anthropic products). The competitive analysis table is accurate — nothing in the ecosystem covers multi-machine orchestration with live terminal streaming.

### Library Version Issues

| Library | Architecture Assumes | Current | Breaking Change? |
|---------|---------------------|---------|-----------------|
| xterm.js | `xterm` (unscoped) | `@xterm/xterm` v6.0.0 | **Yes** — imports must use `@xterm/` scope; canvas renderer removed (DOM fallback only) |
| @fastify/websocket | Not specified | v11.2.0 | Requires Fastify 5.x; handler receives raw WebSocket (not stream) |
| better-sqlite3 | Not specified | v12.8.0 | Requires Node.js v20+ |
| node-pty | Not specified | v1.1.0 stable | Stable; WSL2 uses Linux codepath (no issues) |

**Critical:** The `.claude/rules/xterm-integration.md` rule file uses outdated imports:
```typescript
// Current (wrong)
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebglAddon } from 'xterm-addon-webgl';

// Correct
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
```

The `/* canvas fallback */` comment should note fallback is now to the DOM renderer (canvas addon was removed in v6.0.0).

## Analysis

### Strengths

1. **Architecture quality is high.** The v0.2 design covers protocol, schema, data flows, and security comprehensively. Design decisions are documented with rationale.
2. **Validation report adds real value.** The hooks-based approach (where it works) is genuinely better than regex parsing. The SDK recommendation for session discovery is sound.
3. **Project tooling is ready.** The `.claude/` configuration with agents, skills, and rules provides a strong foundation for AI-assisted development.

### Gaps and Inconsistencies

1. **Hooks architecture needs revision.** The v0.3 proposal assumes all hook events support HTTP, which is false. A hybrid approach is needed: HTTP hooks for supported events + agent-daemon reporting for the rest.
2. **xterm.js imports are wrong everywhere.** Both the architecture doc and the rules file use deprecated unscoped package names.
3. **Node.js version floor undefined.** better-sqlite3 requires v20+, which should be documented as the project minimum.
4. **Fastify version unspecified.** @fastify/websocket v11.x requires Fastify 5.x — this should be locked in.
5. **No shared/ package spec.** The architecture lists types.ts, events.ts, protocol.ts but doesn't detail the Zod schemas or type definitions.

## Recommendations

1. **Update the validation report's hooks section** to distinguish HTTP-capable vs command-only events. Revise the proposed hub hook routes to only cover events that actually support HTTP hooks. For `Notification` and `SessionStart` events, use agent-daemon WebSocket reporting (the v0.2 approach).

2. **Fix xterm.js references immediately.** Update `.claude/rules/xterm-integration.md` and the architecture doc to use `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`, `@xterm/addon-serialize`. Note DOM fallback instead of canvas.

3. **Set project minimums:** Node.js >= 20, Fastify 5.x, pnpm 9.x. Document in the root `package.json` `engines` field.

4. **Add `PermissionRequest` and `TaskCompleted` HTTP hooks** to the architecture — these are valuable events the validation report missed.

5. **Begin Phase 1 implementation.** The architecture is validated (with corrections above). The scaffolding (monorepo structure, shared types, protocol) should come first per the build order in `.claude/shared/build-order.md`.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| HTTP hooks limitations undermine v0.3 state detection plan | High | Use hybrid approach: HTTP hooks where supported, agent WS for the rest |
| xterm.js v6 breaking changes if old imports are used | High | Update all references before any dashboard code is written |
| node-pty native compilation on deployment targets | Medium | Test build on all target platforms early; pin stable v1.1.0 |
| better-sqlite3 skipped SQLite 3.52.0 due to WAL bug | Low | Using v12.8.0 with SQLite 3.51.3 avoids the issue |
| Fastify 5.x may have breaking changes vs Fastify 4 examples online | Low | Use official Fastify 5 docs; most patterns are compatible |

## Sources

- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) — HTTP vs command hook event support
- [Claude Agent SDK - TypeScript](https://platform.claude.com/docs/en/agent-sdk/typescript) — SDK API reference
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference) — `-n`/`--name` flag
- [@xterm/xterm v6.0.0 Release](https://github.com/xtermjs/xterm.js/releases) — breaking changes, scoped packages
- [node-pty GitHub](https://github.com/microsoft/node-pty) — platform support, v1.1.0 stable
- [@fastify/websocket v11.x](https://github.com/fastify/fastify-websocket) — Fastify 5 requirement
- [better-sqlite3 v12.8.0](https://github.com/WiseLibs/better-sqlite3) — Node.js 20+ requirement
- [OpenClaw](https://medium.com/@hugolu87/openclaw-vs-claude-code-in-5-mins-1cf02124bc08) — third-party tool validation
- [runCLAUDErun](https://runclauderun.com/) — macOS scheduler validation

## Appendix

### Full HTTP Hook Event Support Matrix

| Event | HTTP Hook | Command Hook | Relevant to claudeHQ |
|-------|-----------|-------------|---------------------|
| PreToolUse | Yes | Yes | Live tool activity feed |
| PostToolUse | Yes | Yes | Tool results, file changes |
| PostToolUseFailure | Yes | Yes | Error tracking |
| PermissionRequest | Yes | Yes | "Input needed" detection |
| UserPromptSubmit | Yes | Yes | Input logging |
| Stop | Yes | Yes | Session idle, notifications |
| SubagentStop | Yes | Yes | Sub-agent completion |
| TaskCompleted | Yes | Yes | Task tracking |
| SessionStart | No | Yes | — (use agent WS) |
| SessionEnd | No | Yes | — (use agent WS) |
| Notification | No | Yes | — (use command hook + agent) |
| SubagentStart | No | Yes | — (use agent WS) |
| PreCompact | No | Yes | — (use command hook) |
| PostCompact | No | Yes | — (not critical) |
| TeammateIdle | No | Yes | — (use SubagentStop instead) |
