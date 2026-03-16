---
name: research
description: |
  Deep research skill for investigating libraries, APIs, architecture patterns,
  and implementation approaches. Produces structured research documents.
  Use when: "research X", "investigate how to", "compare options for"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, SendMessage, TeamCreate, WebSearch, WebFetch, ToolSearch
model: opus
---

# Research Skill

Conducts deep, multi-agent research on topics relevant to the claudeHQ project. Produces structured research documents in `docs/_research/`.

---

## Phase 0: CONTEXT

Load project context before any research activity.

1. **Read registry:**
   - Read `docs/_research/research-index.json` (list of all prior research documents with metadata)
   - Read `.claude/shared/registry.json` (cross-skill state registry)
   - If either file does not exist, note it and proceed (first run)

2. **Stack context:** This project uses:
   - **Agent:** Node.js, node-pty, ws (WebSocket client), commander (CLI), pino (logging)
   - **Hub:** Fastify, @fastify/websocket, better-sqlite3, pino
   - **Dashboard:** Nuxt 3 (SPA mode), Vuetify 3 UI framework, xterm.js + addons, Pinia stores, custom WebSocket composables
   - **Shared:** Zod schemas, TypeScript protocol types
   - **Infrastructure:** Tailscale mesh networking, systemd services, cross-platform PTY (Linux/macOS/WSL2)
   - **Build:** pnpm workspaces, Turborepo, Vitest

3. **Understand the research output format:** Each research document is a standalone markdown file at `docs/_research/YYYY-MM-DD_<topic-slug>.md` with YAML frontmatter containing `title`, `date`, `tags`, `status` (draft|complete), and `related` (array of related research slugs).

---

## Phase 1: SCOPE

Define the research scope before spawning agents.

1. **Parse the user's research request.** Identify:
   - The core topic or question
   - Which packages/components are affected (agent, hub, dashboard, shared, protocol)
   - Whether this is a library investigation, architecture decision, API exploration, or comparison

2. **Formulate 3-5 specific research questions** that the final document must answer.

3. **Check existing research:** Search `docs/_research/research-index.json` for prior research on the same or adjacent topics. If relevant prior research exists:
   - Read those documents
   - Identify gaps the new research should fill
   - Note findings to avoid duplicating work

4. **Determine topic slug:** Generate a URL-safe slug from the topic (e.g., `xterm-webgl-performance`, `fastify-ws-scaling`, `node-pty-windows-support`).

5. **Determine agent composition** (Phase 2 will spawn these):
   - **Agent A "Library Docs"** — always included. Fetches official documentation via Context7 or WebFetch.
   - **Agent B "Web Researcher"** — always included. Searches for blog posts, GitHub issues, Stack Overflow answers, benchmarks.
   - **Agent C "Codebase Analyst"** — always included. Analyzes existing claudeHQ code for current patterns, usage, and integration points.
   - **Agent D "Infrastructure Analyst"** — optional. Include when the topic involves Tailscale networking, systemd service management, PTY platform compatibility (Linux vs macOS vs WSL2), or deployment patterns.

---

## Phase 2: RESEARCH

Spawn 2-4 named research agents in a team. Each agent has a focused mandate.

### Agent A: Library Docs
- **Name:** `library-docs`
- **Task:** Fetch and summarize official documentation for the library/API being researched.
- **Sources:** Context7 (via `mcp__plugin_context7_context7__resolve-library-id` then `mcp__plugin_context7_context7__query-docs`), official docs sites via WebFetch, GitHub README files.
- **Output:** Structured summary of relevant API surfaces, configuration options, known limitations, version requirements.

### Agent B: Web Researcher
- **Name:** `web-researcher`
- **Task:** Search for community knowledge, real-world usage patterns, known issues, and performance characteristics.
- **Sources:** WebSearch for blog posts, GitHub issues/discussions, Stack Overflow, benchmarks, migration guides.
- **Output:** Curated list of findings with source URLs, relevance assessment, and key takeaways.

### Agent C: Codebase Analyst
- **Name:** `codebase-analyst`
- **Task:** Analyze the existing claudeHQ codebase for current patterns, integration points, and impact assessment.
- **Sources:** Grep/Glob/Read across `packages/` directory. Check `package.json` files for current dependencies and versions.
- **Output:** Current usage analysis, affected files list, compatibility assessment, migration effort estimate if applicable.

### Agent D: Infrastructure Analyst (optional)
- **Name:** `infra-analyst`
- **Task:** Research infrastructure concerns — Tailscale ACL patterns, systemd unit file best practices, node-pty platform-specific behavior, deployment strategies.
- **Sources:** WebSearch, WebFetch for Tailscale docs, systemd man pages, node-pty GitHub issues.
- **Output:** Platform compatibility matrix, deployment recommendations, infrastructure prerequisites.

### Team coordination:
- Create the team with `TeamCreate` using descriptive names.
- Send each agent its specific research questions via `SendMessage`.
- Wait for all agents to complete.
- Collect outputs via `SendMessage` result retrieval.

---

## Phase 3: ANALYZE AND SYNTHESIZE

After all agents report back:

1. **Cross-reference findings.** Look for:
   - Agreements across agents (high-confidence findings)
   - Contradictions that need resolution
   - Gaps where no agent found information

2. **Answer each research question** from Phase 1 using the combined findings.

3. **Assess confidence level** for each answer:
   - **High:** Multiple sources agree, official docs confirm
   - **Medium:** Single reliable source or community consensus
   - **Low:** Limited information, extrapolated from adjacent topics

4. **Identify risks and tradeoffs** relevant to claudeHQ's architecture.

5. **Formulate recommendations** with clear rationale tied to findings.

---

## Phase 4: WRITE RESEARCH DOCUMENT

Create the research document at `docs/_research/YYYY-MM-DD_<topic-slug>.md`.

### Document structure:

```markdown
---
title: "<Research Title>"
date: YYYY-MM-DD
tags: [<relevant-tags>]
status: complete
related: [<slugs-of-related-research>]
packages: [<affected-packages>]
---

# <Research Title>

## Summary
<2-3 sentence executive summary of findings and recommendation>

## Research Questions
1. <Question 1>
2. <Question 2>
...

## Findings

### <Finding Area 1>
<Detailed findings with source citations>

### <Finding Area 2>
<Detailed findings with source citations>

## Analysis
<Cross-cutting analysis, tradeoffs, compatibility assessment>

## Recommendations
<Numbered recommendations with rationale>

## Risks
| Risk | Severity | Mitigation |
|------|----------|------------|
| ... | ... | ... |

## Sources
- [Source 1](url) — <brief description>
- [Source 2](url) — <brief description>

## Appendix
<Raw data, code samples, benchmark results if applicable>
```

---

## Phase 5: REPORT

Present findings to the user:

1. **Summary:** 2-3 sentence overview of what was researched and the key finding.
2. **Key recommendations:** Bulleted list of actionable recommendations.
3. **Confidence assessment:** Overall confidence in findings (high/medium/low) with reasoning.
4. **Follow-up suggestions:** Topics that emerged during research that warrant separate investigation.
5. **File path:** Absolute path to the research document.

---

## Phase Final: REGISTER

Update tracking files to record this research.

1. **Update `docs/_research/research-index.json`:**
   - Add entry with: `slug`, `title`, `date`, `tags`, `packages`, `status`, `path`
   - If file doesn't exist, create it as a JSON array with this first entry

2. **Update `.claude/shared/registry.json`:**
   - Record under `lastResearch`: `{ slug, date, topic }`
   - If file doesn't exist, create it with initial structure:
     ```json
     {
       "lastResearch": { "slug": "...", "date": "...", "topic": "..." },
       "lastExecution": {},
       "incompletes": []
     }
     ```

3. **Verify** both files are valid JSON after writing.
