---
title: "Implementation Deep Dives: GitHub App, Docker Spawn, Cost Estimation & Rivet Evaluation"
date: 2026-03-15
tags: [github, docker, costs, pricing, tokens, rivet, sdk, spawn, budget]
status: complete
related: [workforce-management-platform, docs-audit]
packages: [hub, agent, dashboard, shared]
---

# Implementation Deep Dives: GitHub App, Docker Spawn, Cost Estimation & Rivet Evaluation

## Summary

Four implementation topics researched in depth: (1) GitHub App setup can be fully automated via the Manifest flow — user clicks one button, GitHub creates the app, returns credentials, and the Hub stores them; minimum 5 permissions needed. (2) `spawnClaudeCodeProcess` works with Docker via `child_process.spawn('docker', ['exec', '-i', ...])` — `ChildProcess` directly satisfies the `SpawnedProcess` interface with zero adapter code; no TTY needed since the SDK uses JSON-lines over stdin/stdout. (3) Claude Code reports exact cost via `SDKResultMessage.total_cost_usd` and `modelUsage`; Opus 4.6 costs $5/$25 per MTok input/output; `--max-budget-usd` enforces per-session limits natively. (4) Rivet Sandbox Agent SDK should NOT be adopted as a dependency (runs Claude Code in `--print` mode, losing interactive PTY) but three patterns are worth learning: structured event parsing alongside PTY, normalized event schema, and permission reply typing.

## Research Questions

1. How should the dashboard guide users through GitHub App setup?
2. What's the exact implementation for routing `spawnClaudeCodeProcess` into Docker?
3. How do we estimate and track costs for budget controls?
4. Should Claude HQ adopt or learn from Rivet's Sandbox Agent SDK?

## Findings

### 1. GitHub App Setup

#### The Manifest Flow (Recommended)

GitHub's App Manifest flow enables one-click app creation. The Hub submits a JSON manifest to GitHub, the user confirms, GitHub creates the app and redirects back with full credentials:

```
Dashboard "Connect to GitHub" button
  → POST form to github.com/settings/apps/new with manifest JSON
  → User confirms on GitHub
  → GitHub redirects to Hub callback with temporary code
  → Hub exchanges code: POST /app-manifests/{code}/conversions
  → Response: { id, slug, pem, client_id, client_secret, webhook_secret }
  → Hub stores credentials encrypted in SQLite
  → Dashboard redirects to github.com/apps/{slug}/installations/new
  → User installs on repos/orgs
  → GitHub redirects to Hub setup URL with installation_id
  → Hub verifies with test API call
  → Done
```

#### Manifest JSON

```json
{
  "name": "Claude HQ",
  "url": "https://hub.example.ts.net",
  "hook_attributes": {
    "url": "https://hub.example.ts.net/webhooks/github",
    "active": true
  },
  "redirect_url": "https://hub.example.ts.net/github/callback",
  "setup_url": "https://hub.example.ts.net/github/setup",
  "setup_on_update": true,
  "public": false,
  "default_permissions": {
    "contents": "write",
    "pull_requests": "write",
    "issues": "write",
    "checks": "write",
    "actions": "read",
    "metadata": "read"
  },
  "default_events": [
    "pull_request", "push", "check_run",
    "check_suite", "issue_comment", "installation"
  ]
}
```

#### Permission Mapping

| Claude HQ Operation | GitHub Permission | Level |
|---------------------|------------------|-------|
| Clone repos | `contents` | read |
| Create branches, push commits | `contents` | write |
| Create/update/merge PRs | `pull_requests` | write |
| Add labels | `issues` | write |
| Request reviewers | `pull_requests` | write |
| Read issues, link sessions | `issues` | read (write already includes) |
| Create check runs | `checks` | write |
| Read Actions status | `actions` | read |
| Metadata (always granted) | `metadata` | read |

**Minimum: 5 explicit permissions** (contents:write, pull_requests:write, issues:write, checks:write, actions:read).

#### Authentication with `@octokit/auth-app`

```typescript
import { App } from "@octokit/app";
const app = new App({ appId, privateKey });
// Per-installation client with auto-rotating tokens (60min, cached)
const octokit = await app.getInstallationOctokit(installationId);
```

Tokens are LRU-cached (up to 15,000) and auto-refreshed at 59 minutes. JWT iat is set 30 seconds in the past for clock drift protection.

#### Webhook URL for Tailscale Networks

GitHub webhooks require a public HTTPS URL. **Tailscale Funnel** is the natural choice: `sudo tailscale funnel 3000` exposes the Hub as `https://<hostname>.<tailnet>.ts.net`. Free, TLS-terminated, no firewall changes.

Alternatives: Cloudflare Tunnel (production), smee.io (dev only), ngrok (paid).

#### Fine-Grained PAT Fallback

For simpler single-user setup: fine-grained PAT with matching permissions. **Limitations:** no webhooks (must poll), no Checks API (must use Commit Statuses instead), tied to user account, 5K req/hr rate limit.

#### Dashboard Setup Wizard (7 steps)

1. **Welcome** — "Connect Claude HQ to GitHub"
2. **Choose method** — "Create new GitHub App" (manifest) or "Use existing credentials"
3. **Create on GitHub** — Manifest POST triggers GitHub UI
4. **Callback** — Hub exchanges code for credentials, stores encrypted
5. **Install** — Link to GitHub's app installation page
6. **Setup redirect** — Hub receives `installation_id`
7. **Verify** — Test API call, show accessible repos

### 2. Docker `spawnClaudeCodeProcess` Implementation

#### SpawnedProcess Interface

```typescript
interface SpawnedProcess {
  stdin: Writable;
  stdout: Readable;
  readonly killed: boolean;
  readonly exitCode: number | null;
  kill(signal: NodeJS.Signals): boolean;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  once(...): void;
  off(...): void;
}
```

**Key findings:**
- **`ChildProcess` directly satisfies `SpawnedProcess`** — zero adapter code needed
- **No TTY required** — SDK uses `--output-format stream-json --input-format stream-json` (JSON-lines over plain pipes)
- **No stderr on SpawnedProcess** — SDK reads stderr via separate callback, not from SpawnedProcess
- SDK communicates bidirectionally: user messages on stdin, control requests/responses on stdout

#### Recommended Implementation: `docker exec` into Pre-Running Container

```typescript
import { spawn } from 'child_process';

const dockerSpawn = ({ command, args, cwd, env, signal }) => {
  const containerCwd = cwd ? `/workspace${cwd}` : '/workspace';

  const dockerArgs = [
    'exec', '-i',                    // interactive stdin, NO -t (no TTY!)
    '-w', containerCwd,
    ...Object.entries(env)
      .filter(([, v]) => v !== undefined)
      .flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    'claude-worker-1',               // pre-running container name
    'claude',                        // container's claude binary
    ...args
  ];

  const proc = spawn('docker', dockerArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  signal.addEventListener('abort', () => proc.kill('SIGTERM'));
  return proc;  // ChildProcess satisfies SpawnedProcess
};

// Usage with SDK
const result = query({
  prompt: "Fix the bug",
  options: {
    spawnClaudeCodeProcess: dockerSpawn,
    cwd: "/path/to/repo",
    permissionMode: "bypassPermissions",
  }
});
```

**Critical: Do NOT use `-t` (TTY flag).** It corrupts the JSON-lines protocol.

#### Alternative: `docker run` Per Session

```typescript
const dockerRunSpawn = ({ command, args, cwd, env, signal }) => {
  const proc = spawn('docker', [
    'run', '--rm', '-i',
    '-v', `${cwd}:/workspace`,
    '-w', '/workspace',
    ...Object.entries(env)
      .filter(([, v]) => v !== undefined)
      .flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    '--cpus', '2', '--memory', '2g',
    'claude-code-image:latest',
    'claude', ...args
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  signal.addEventListener('abort', () => proc.kill('SIGTERM'));
  return proc;
};
```

Adds 2-5s container startup. Use for isolated, one-shot jobs.

#### SSH Spawn (Bonus Pattern)

Same interface works for remote execution:

```typescript
const sshSpawn = ({ command, args, cwd, env, signal }) => {
  const envExports = Object.entries(env)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `export ${k}='${v}'`).join('; ');

  const proc = spawn('ssh', [
    '-o', 'BatchMode=yes',          // no interactive prompts
    'user@remote-host',
    `${envExports}; cd ${cwd} && ${command} ${args.join(' ')}`
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  signal.addEventListener('abort', () => proc.kill('SIGTERM'));
  return proc;
};
```

Do NOT use `-tt` (pseudo-TTY) — same JSON corruption issue as Docker's `-t`.

#### Performance

| Approach | Added Latency | Notes |
|----------|--------------|-------|
| `docker exec` (pre-running) | ~0.1-0.5s | Best for interactive use |
| `docker run --rm` | ~2-5s | Best for isolated jobs |
| SSH | ~0.5-2s | Depends on network |
| SDK base overhead | ~12s first query | Process init + API warmup |

**No public implementation of `spawnClaudeCodeProcess` with Docker exists.** All existing Docker approaches run the SDK *inside* the container. Claude HQ's implementation would be novel.

### 3. Cost Estimation & Budget Controls

#### Current Pricing (March 2026, per million tokens)

| Model | Input | Output | Cache Write | Cache Read |
|-------|-------|--------|-------------|------------|
| **Opus 4.6** | $5.00 | $25.00 | $6.25 | $0.50 |
| **Opus 4 (legacy)** | $15.00 | $75.00 | $18.75 | $1.50 |
| **Sonnet 4.6** | $3.00 | $15.00 | $3.75 | $0.30 |
| **Sonnet 4** | $3.00 | $15.00 | $3.75 | $0.30 |
| **Haiku 4.5** | $1.00 | $5.00 | $1.25 | $0.10 |

- **Extended thinking tokens billed as output tokens** at the output rate
- **Long context premium** (>200K input): 2x input, 1.5x output
- **Batch API**: 50% discount on both input and output
- **Prompt caching**: 5-min TTL cache read is 90% cheaper than uncached

#### Cost Formula

```
cost_usd = (input_tokens × input_price / 1M)
         + (output_tokens × output_price / 1M)
         + (thinking_tokens × output_price / 1M)
         + (cache_write_tokens × cache_write_price / 1M)
         + (cache_read_tokens × cache_read_price / 1M)
```

#### How Claude Code Reports Costs

| Source | When | Fields |
|--------|------|--------|
| `--output-format json` | After completion | `cost_usd`, `usage` |
| `stream-json` result message | End of stream | `total_cost_usd`, `usage`, `modelUsage` |
| SDK `SDKResultMessage` | Query completion | `total_cost_usd`, `usage`, `modelUsage`, `duration_ms`, `num_turns` |
| `/cost` command | Interactive | Total cost, duration, code changes |
| Stop hook | Session idle | Does NOT include cost (use SDK result) |

The `modelUsage` field provides per-model breakdown:
```typescript
modelUsage: {
  "claude-opus-4-6": {
    inputTokens, outputTokens, cacheReadInputTokens,
    cacheCreationInputTokens, costUSD, contextWindow, maxOutputTokens
  }
}
```

Sub-agent and teammate costs roll up into the parent session's totals.

#### Native Budget Enforcement

- **`--max-budget-usd N`** — CLI flag, headless mode only, API key auth only
- **SDK `maxBudgetUsd`** — in `query()` options
- On exceed: graceful stop, returns `SDKResultMessage` with `subtype: "error_max_budget_usd"`
- Per-day/month budgets: NOT native — must be Hub-side enforcement

#### Token Counting Tools

- **`@anthropic-ai/tokenizer`** — official npm package for local counting (text only, beta)
- **`POST /v1/messages/count_tokens`** — API endpoint, counts full message payloads including tools/images, **free to use**
- **tiktoken (OpenAI)** — does NOT work accurately for Claude's tokenizer
- **Rule of thumb**: ~4 chars/token, ~0.75 words/token

#### Cost Data Schema

```sql
CREATE TABLE session_costs (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  thinking_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0.0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  num_turns INTEGER NOT NULL DEFAULT 0,
  stop_reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

#### Observability Options

- **Anthropic Admin APIs**: `/v1/organizations/usage_report/claude_code` for org-wide analytics
- **OpenTelemetry**: `CLAUDE_CODE_ENABLE_TELEMETRY=1` + `OTEL_EXPORTER_OTLP_ENDPOINT` exports events natively
- **Langfuse** (open-source, self-hostable): Full tracing with cost attribution per user/session/model
- **Helicone** (open-source): <1ms overhead, production-ready, Rust-based

**Recommendation:** Use SDK's built-in `total_cost_usd` as primary source. Store per-session in Hub SQLite. Implement Hub-side daily/monthly budgets with notification at 50/75/90/100% thresholds. Optionally enable OTEL for deeper observability.

### 4. Rivet Sandbox Agent SDK Evaluation

#### What It Is

A Rust HTTP daemon (~15MB binary) that normalizes multiple coding agent CLIs (Claude Code, Codex, OpenCode, Amp, Cursor, Pi) behind a universal REST/SSE API. Write one integration, swap agents via config.

- **Language**: Core in Rust (Axum/Tokio), client SDKs in TypeScript
- **License**: Apache 2.0
- **Stars**: 1,081 | **Contributors**: 12 | **Age**: 7 weeks | **Latest**: v0.3.2
- **Pre-1.0**, breaking changes every 2-3 weeks

#### Fundamental Architectural Difference

Rivet runs Claude Code in `--print --output-format stream-json` mode (**non-interactive**). Claude HQ uses **full interactive PTY** via node-pty. This is irreconcilable:

| Aspect | Rivet | Claude HQ |
|--------|-------|-----------|
| Claude Code mode | `--print` (headless) | Interactive PTY |
| Output | Structured JSON events | Raw ANSI terminal stream |
| Input | Per-turn prompts via HTTP | Live keystroke input via PTY |
| Sub-agent interaction | Not possible (no stdin) | Full stdin interaction |
| Terminal rendering | Not applicable | xterm.js with live ANSI |
| AskUser prompts | Normalized as `questionAsked` event | Interactive terminal prompt |

#### Feature Gap Analysis

| Feature | Rivet Has? | Claude HQ Needs? |
|---------|-----------|-------------------|
| Multi-agent backends | Yes (6 agents) | No (Claude Code only) |
| Interactive PTY | No | **Yes (core feature)** |
| Multi-machine orchestration | No (single daemon) | **Yes (Tailscale mesh)** |
| Queue/scheduling | No | **Yes** |
| Cost tracking | No (open issue #257) | **Yes** |
| Session persistence | In-memory only | **Yes (SQLite + JSONL)** |
| Session replay | No | **Yes** |
| Dashboard | Debug Inspector only | **Yes (production Nuxt 3)** |
| Notifications | No | **Yes** |
| Git/repo management | No (out of scope) | **Yes** |

#### Verdict: Learn, Don't Adopt

**Do NOT adopt as dependency.** The `--print` mode vs PTY mode difference is the dealbreaker. Plus: no multi-machine, no queues, no persistence, no notifications, pre-1.0 instability, Rust binary dependency in a Node.js monorepo.

**DO learn three patterns:**

1. **Dual-stream parsing:** Parse Claude Code's `stream-json` structured output *alongside* the PTY stream. Get structured events (tool calls, permissions, state) from JSON, terminal rendering from ANSI. Best of both worlds.

2. **Universal event envelope:** Rivet's `UniversalEvent` pattern (id, timestamp, session_id, typed data) is a clean schema for internal messaging. Adopt for the Hub's WebSocket protocol.

3. **Permission reply typing:** Rivet normalizes permissions as `permissionAsked` with typed replies (`once | always | reject`). Cleaner than binary approve/deny — adopt for the approval system.

**Monitor the project.** Issue #199 ("Streaming full CLI terminal output") suggests the community wants interactive terminal support. If Rivet adds PTY mode and multi-machine support, re-evaluate.

## Analysis

### GitHub App: Manifest Flow Eliminates Setup Friction

The biggest risk in GitHub integration is the setup UX. Users dropping off during a 15-step manual configuration would kill adoption. The Manifest flow reduces it to: click button → confirm on GitHub → install on repos → done. The Hub handles credential storage and token rotation transparently.

**Tailscale Funnel** for webhooks is the elegant solution for a Tailscale-based private network. No need for ngrok or Cloudflare Tunnel — it's built into the tool the system already requires.

### Docker Spawn: Simpler Than Expected

The `spawnClaudeCodeProcess` → Docker routing is surprisingly straightforward because `ChildProcess` from `spawn('docker', ['exec', '-i', ...])` already satisfies the `SpawnedProcess` interface. No adapter, no dockerode, no stream bridging — just shell out to Docker. The critical insight is **no `-t` flag** — the SDK uses JSON-lines, not terminal escape sequences.

**Pre-running containers** (`docker exec`) are recommended over per-session containers (`docker run`) for latency reasons (0.1s vs 2-5s added on top of the SDK's ~12s startup). The Agent daemon can manage a pool of warm containers.

### Cost Tracking: SDK Does the Heavy Lifting

The SDK's `total_cost_usd` and `modelUsage` provide exact cost data — no need for external tokenizers or pricing tables. Store the SDK's reported values per session. Hub-side logic handles daily/monthly budgets, threshold alerts, and cost aggregation. The `--max-budget-usd` flag provides native per-session hard stops.

**Average cost**: ~$6/developer/day, 90th percentile under $12/day (per Anthropic's docs). For fire-and-forget queued jobs, per-session `maxBudgetUsd` is essential to prevent runaways.

### Rivet: Wrong Abstraction for Our Problem

Rivet optimizes for "swap agents via config" — a multi-agent horizontal problem. Claude HQ optimizes for "deep, rich management of Claude Code specifically" — a single-agent vertical problem. These are different products solving different problems. The overlap is small (subprocess management, event streaming) and the mismatch is large (PTY vs headless, single-machine vs multi-machine, ephemeral vs persistent).

## Recommendations

1. **Implement the GitHub App Manifest flow as the primary setup path.** Ship the manifest JSON with the Hub. Offer PAT as a simplified fallback with clear warnings about limitations (no webhooks, no checks).

2. **Use Tailscale Funnel for the webhook endpoint.** Zero extra infrastructure, built into the existing Tailscale dependency.

3. **Implement `spawnClaudeCodeProcess` with `spawn('docker', ['exec', '-i', ...])`** as the Docker execution backend. Pre-running containers, no TTY flag, `ChildProcess` satisfies the interface directly.

4. **Track costs using `SDKResultMessage.total_cost_usd` and `modelUsage`.** Store per-session in Hub SQLite. Implement Hub-side daily/monthly budgets with `--max-budget-usd` as per-session enforcement.

5. **Do NOT adopt Rivet Sandbox Agent SDK.** Learn from its event schema and permission patterns instead.

6. **Parse Claude Code's stream-json output alongside PTY** (Rivet-inspired dual-stream pattern) to get structured events without losing interactive terminal capability.

7. **Store the GitHub App private key encrypted in SQLite** or as an environment variable. Never in source code. Auto-rotate installation tokens via `@octokit/auth-app`.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| GitHub Manifest flow requires public URL | Medium | Tailscale Funnel provides this; PAT fallback if Funnel unavailable |
| Docker exec command injection via env vars | Medium | Sanitize env values; use dockerode for programmatic control if needed |
| SDK `total_cost_usd` lags behind pricing changes | Low | Anthropic updates SDK with pricing; monitor release notes |
| Docker container pool management complexity | Medium | Start with single pre-running container; add pool in later phase |
| Rivet-inspired dual-stream adds parsing complexity | Low | Use existing `stream-json` format; well-documented message types |
| GitHub App private key compromise | High | Encrypt at rest; restrict file permissions; rotate periodically |

## Sources

### GitHub App
- [Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
- [Registering from a manifest](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
- [Choosing permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [About authentication with a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app)
- [@octokit/auth-app.js](https://github.com/octokit/auth-app.js/)
- [@octokit/webhooks.js](https://github.com/octokit/webhooks.js/)
- [Tailscale Funnel](https://tailscale.com/kb/1223/funnel)
- [Webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
- [Fine-grained PATs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

### Docker Spawn
- [Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Agent SDK Hosting Guide](https://platform.claude.com/docs/en/agent-sdk/hosting)
- [SDK GitHub (anthropics/claude-agent-sdk-typescript)](https://github.com/anthropics/claude-agent-sdk-typescript)
- [Inside the Claude Agent SDK (architecture deep dive)](https://buildwithaws.substack.com/p/inside-the-claude-agent-sdk-from)
- [Docker Sandboxes for Claude Code](https://docs.docker.com/ai/sandboxes/agents/claude-code/)
- [claude-code-sdk-docker (cabinlab)](https://github.com/cabinlab/claude-code-sdk-docker)
- [claude-agent-server (dzhng)](https://github.com/dzhng/claude-agent-server)

### Cost Estimation
- [Claude API Pricing](https://docs.anthropic.com/en/docs/about-claude/pricing)
- [Manage costs effectively](https://docs.anthropic.com/en/docs/claude-code/costs)
- [Token counting](https://docs.anthropic.com/en/docs/build-with-claude/token-counting)
- [Count tokens API](https://docs.anthropic.com/en/api/messages-count-tokens)
- [@anthropic-ai/tokenizer](https://www.npmjs.com/package/@anthropic-ai/tokenizer)
- [Extended thinking](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking)
- [Claude Code Analytics API](https://docs.anthropic.com/en/api/claude-code-analytics-api)
- [Langfuse - Cost Tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking)

### Rivet
- [Rivet Sandbox Agent SDK (GitHub)](https://github.com/rivet-dev/sandbox-agent)
- [ARCHITECTURE.md](https://github.com/rivet-dev/sandbox-agent/blob/main/server/ARCHITECTURE.md)
- [Announcement (Jan 2026)](https://www.rivet.dev/changelog/2026-01-28-sandbox-agent-sdk/)
- [InfoQ Coverage (Feb 2026)](https://www.infoq.com/news/2026/02/rivet-agent-sandbox-sdk/)
- [Documentation](https://sandboxagent.dev/)
