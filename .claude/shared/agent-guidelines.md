# Agent Spawning Guidelines

> **Quick version**: For the essential rules only (~60 lines), read
> `agent-guidelines-quick.md` instead. Use this full version when you need
> templates, examples, or the detailed context budget table.

Shared reference for all skills that spawn subagents. These guidelines maximize
agent effectiveness within context window limits.

## Core Principles

### 1. Narrow Scope Per Agent

Never give a single agent a broad mandate like "review all security across the
whole codebase." Split into focused agents with clear boundaries:

**Bad**: "Review security, performance, and architecture"
**Good**: "Review PTY input sanitization" + "Review SQLite query safety" + "Review WS protocol validation"

Each agent should have:
- A single, well-defined area of focus
- A bounded set of files to examine (ideally < 15)
- Clear criteria for what constitutes a finding

### 2. Write As You Go

Every research or review agent MUST write findings incrementally. Include this
in every agent prompt:

```
WRITE-AS-YOU-GO: After examining each file or area, immediately append
findings to `{findings_file}`. Do NOT wait until the end.
```

### 3. Cap Research Depth

Every agent prompt MUST include explicit limits:

```
RESEARCH LIMITS:
- Read no more than {N} files (default: 15)
- Prioritize index/entry files first, then drill into specifics
- Skim files > 200 lines — read first 50 lines, grep for patterns
- Stop after finding 10+ issues in a single area
```

Adjust the file cap: narrow 8-12, medium 12-18, broad 15-25.

### 4. Provide Entry Points

Give explicit starting points:

```
START HERE:
1. `packages/agent/src/pty-pool.ts` — PTY management
2. `packages/agent/src/session.ts` — session lifecycle
3. `packages/agent/src/ws-client.ts` — WebSocket client
Then examine related files as needed.
```

## Agent Prompt Template

```markdown
You are a [role]. Your task is to [specific objective].

## Scope
[Exactly what to examine — specific directories, file patterns, or modules]

## Entry Points
[2-5 specific files to start with]

## RESEARCH LIMITS
- Read no more than {N} files
- Skim files > 200 lines

## WRITE-AS-YOU-GO
After examining each file, immediately append findings to `{findings_file}`.

## What to Look For
[Specific checklist items]

## Output
When done, write a 3-5 line summary at the end of `{findings_file}`.
```

## Named Agents

**Always name agents** for tracking, resume, and messaging:

```
Agent(name="agent-impl", subagent_type="agent-dev", team_name="sprint-NNN-dev", ...)
Agent(name="hub-impl", subagent_type="hub-dev", team_name="sprint-NNN-dev", ...)
Agent(name="dashboard-impl", subagent_type="dashboard-dev", team_name="sprint-NNN-dev", ...)
```

**Naming conventions**:
- Implementation: `agent-impl`, `hub-impl`, `dashboard-impl`, `tester`
- Research: `domain-researcher`, `library-researcher`, `codebase-analyst`
- Review: `security-reviewer`, `backend-reviewer`, `frontend-reviewer`

## Permission Modes

| Mode | When to Use | Examples |
|------|-------------|---------|
| `"auto"` | Trusted agents in worktrees | agent-dev, hub-dev, dashboard-dev, test-writer |
| `"acceptEdits"` | Agents that write files but confirm other actions | dashboard-build agents |
| `"default"` | Read-heavy agents that occasionally write findings | reviewer, research agents |

## Worktree Isolation

When agents write to the repo in parallel, use worktree isolation:

```
Agent(prompt=..., subagent_type="agent-dev", isolation="worktree")
```

**When to use**: Multiple agents writing simultaneously (sprint-dev).
**When NOT to use**: Read-only agents, agents writing to `/tmp/`, single agents.

## Error Handling and Resume

```
# Spawn agent, capture ID
result = Agent(name="hub-impl", subagent_type="hub-dev", prompt=...)

# If agent fails:
result = Agent(resume="<agentId>")

# If resume fails: restart with narrower scope
```

## Context Budget Guidelines

### Implementation Agents (agent-dev, hub-dev, dashboard-dev, test-writer)

| Activity | Token Budget |
|----------|-------------|
| Agent prompt | ~5k |
| CLAUDE.md auto-loaded | ~2k |
| File reads (20 files) | ~100k |
| File writes + tool overhead | ~30k |
| Agent reasoning | ~50k |
| Safety margin | ~50k |
| **Total per agent** | **~230k** |

### Research/Review Agents

| Activity | Token Budget |
|----------|-------------|
| Agent prompt | ~3k |
| File reads (12 files) | ~60k |
| Findings writes | ~10k |
| Reasoning | ~30k |
| Safety margin | ~20k |
| **Total per agent** | **~125k** |

### Budget Rules

- **Implementation**: max 3-4 agents at ~230k each
- **Research/Review**: max 4-5 agents at ~125k each
- Always leave ~200k for the orchestrating skill
