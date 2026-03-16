# Agent Spawning Guidelines (Quick Reference)

Essential rules for skills that spawn subagents. For full templates and examples,
read `agent-guidelines.md` when you are about to spawn agents.

## 5 Rules

1. **Narrow scope**: One focus area per agent, bounded file set (< 15 files),
   clear criteria for findings. Never "review everything."

2. **Write as you go**: Every agent writes findings to its own file incrementally.
   Never accumulate in context for a final dump. Include this in every prompt:
   ```
   WRITE-AS-YOU-GO: After each file, append findings to `{findings_file}`.
   Do NOT wait until the end.
   ```

3. **Cap research depth**: Every prompt MUST include:
   ```
   RESEARCH LIMITS:
   - Read no more than {N} files
   - Skim files > 200 lines (first 50 lines + grep)
   - Stop after 10+ issues in one area
   ```
   Caps: narrow scope 8-12 files, medium 12-18, broad 15-25.

4. **Provide entry points**: Don't make agents discover structure. Give 2-5
   specific files to start with.

5. **Use general-purpose** (not reviewer) for anything that needs Write tool.
   Use Explore only for searches, not analysis.

## Agent Call Best Practices

```
Agent(
  name: "descriptive-name",           # Always name for tracking/resume
  subagent_type: "agent-dev",         # Match to work type
  model: "sonnet",                    # Explicit — don't rely on defaults
  mode: "auto",                       # "auto" for trusted implementation agents
  isolation: "worktree",              # Only when writing to repo in parallel
  run_in_background: true,            # For autonomous agents (no AskUserQuestion)
  prompt: "<under 3k tokens>"         # Move templates to files agents read on demand
)
```

## Resume on Failure

Capture `agentId` from every spawn. On failure:
1. `Agent(resume: "<id>")` — continues with full prior context
2. If resume fails: restart with narrower scope / tighter limits
3. After 3 failures on same work: mark blocked, ask user

## Findings Convention

Write to `/tmp/{skill-name}/{agent-name}.md`.
Backup to `docs/_reports/{context}/` for persistence.
Orchestrator creates dirs before spawning:
```bash
mkdir -p /tmp/{skill-name} docs/_reports/{context}
```
