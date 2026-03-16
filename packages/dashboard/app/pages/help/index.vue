<script setup lang="ts">
import { ref } from 'vue';

definePageMeta({ layout: 'default' });

const openPanels = ref<number[]>([0]);

const sections = [
  {
    title: 'Getting Started',
    icon: 'mdi-rocket-launch',
    content: [
      {
        q: 'What is Claude HQ?',
        a: 'Claude HQ is a self-hosted platform for managing Claude Code AI sessions across multiple machines. It provides a web dashboard for monitoring, controlling, and orchestrating Claude Code agents — like Portainer for AI coding sessions.',
      },
      {
        q: 'How do I start my first session?',
        a: `1. Make sure the **Hub** is running (you're seeing this page, so it is)\n2. Start an **Agent** on a machine with Claude Code installed:\n   \`\`\`\n   cd packages/agent && node dist/cli.js agent start\n   \`\`\`\n3. The machine will appear on the **Overview** page\n4. Click **+ New Session**, select the machine, enter a prompt and working directory\n5. Watch the live terminal output in your browser`,
      },
      {
        q: 'How do I connect an agent on a remote machine?',
        a: `Create \`~/.chq/config.json\` on the remote machine:\n\`\`\`json\n{\n  "machineId": "my-remote-pc",\n  "displayName": "Remote PC",\n  "hubUrl": "ws://YOUR_HUB_IP:7700"\n}\n\`\`\`\nIf both machines are on the same **Tailscale** network, use the Tailscale IP (100.x.x.x). Then start the agent:\n\`\`\`\nnode dist/cli.js agent start\n\`\`\``,
      },
    ],
  },
  {
    title: 'Sessions',
    icon: 'mdi-console',
    content: [
      {
        q: 'How do I send input to a running session?',
        a: 'Open the session detail page and use the **input bar** at the bottom. Type text and press Enter. Quick action buttons send common responses:\n- **Yes** sends `y\\n`\n- **No** sends `n\\n`\n- **Ctrl+C** sends the interrupt signal to stop the current operation',
      },
      {
        q: 'How do I resume a completed session?',
        a: 'On the session detail page for a completed session, click **Resume**. Enter a follow-up prompt and a new session will start, continuing the conversation using Claude Code\'s `--resume` flag. The sessions are linked via parent/child chain.',
      },
      {
        q: 'What do the session statuses mean?',
        a: '- **Queued** — waiting for a PTY slot on the machine\n- **Running** — Claude Code is actively working\n- **Completed** — exited successfully (exit code 0)\n- **Failed** — exited with an error (non-zero exit code)\n- **Cancelled** — terminated by user or system',
      },
      {
        q: 'How does replay work?',
        a: 'Every session\'s terminal output is recorded as JSONL. Click **Replay** on a completed session to play it back with:\n- **Play/Pause** (spacebar)\n- **Speed controls** (1x, 2x, 4x, 8x)\n- **Timeline scrubber** — click anywhere to jump\n\nRecordings are stored on the Hub and retained per the configured retention policy.',
      },
      {
        q: 'What is the Session Grid?',
        a: 'Navigate to **Sessions > Grid View** to see multiple live sessions in a 2x2 or 1x4 layout. Each cell shows a mini terminal view. Click any cell to expand to the full session detail.',
      },
    ],
  },
  {
    title: 'Jobs & Repositories',
    icon: 'mdi-briefcase-outline',
    content: [
      {
        q: 'What is a Job vs a Session?',
        a: 'A **Session** is a single Claude Code PTY process. A **Job** is a higher-level unit of work that encompasses the full lifecycle:\n1. Clone/update repository\n2. Create feature branch\n3. Install dependencies\n4. Run Claude Code session\n5. Commit changes\n6. Create PR\n\nJobs automate the entire workflow from "I want this done" to "PR is ready for review."',
      },
      {
        q: 'How do I register a repository?',
        a: 'Go to **Repos** and click **+ Add Repo**. Paste a GitHub URL (HTTPS or SSH) and Claude HQ will auto-detect the name and owner. You can then configure:\n- Default package manager\n- Setup commands (`pnpm install`)\n- Pre-flight checks (`pnpm test`)\n- Preferred machine',
      },
      {
        q: 'How do batch jobs work?',
        a: 'Use `POST /api/jobs/batch` to run the same prompt against multiple repositories. The Hub creates individual jobs for each repo and tracks them together. Useful for:\n- Dependency updates across all repos\n- Security patches\n- Documentation generation\n- Linting rule changes',
      },
    ],
  },
  {
    title: 'Approvals & Security',
    icon: 'mdi-shield-check',
    content: [
      {
        q: 'How does the approval system work?',
        a: 'When Claude Code needs to use a tool (edit a file, run a command), Claude HQ\'s **policy engine** evaluates it:\n\n1. **Auto-approve** — read-only operations, safe bash commands, code file edits\n2. **Auto-deny** — dangerous patterns (`rm -rf /`, `sudo`, `curl | bash`)\n3. **Require approval** — everything else waits for human decision\n\nPending approvals appear in the **Approvals** page with risk badges (low/medium/high/critical).',
      },
      {
        q: 'How do I customize approval policies?',
        a: 'Go to **Settings > Approval Policies**. You can:\n- View the 6 default rules\n- Delete rules you don\'t want\n- Create new rules via `POST /api/approval-policies`\n\nRules are evaluated in **priority order** (lowest number first). First match wins.',
      },
      {
        q: 'What happens when an approval times out?',
        a: 'By default, pending approvals **auto-deny after 5 minutes**. This is the safe default — no unattended session can execute risky operations. You can configure timeout per session or per policy rule.',
      },
      {
        q: 'Is --dangerously-skip-permissions enabled by default?',
        a: '**No.** The default agent config has empty flags (`[]`). You must explicitly set `"defaultFlags": ["--dangerously-skip-permissions"]` in your agent config if you want to bypass all permission checks. This is intentional — safety by default.',
      },
    ],
  },
  {
    title: 'GitHub Integration',
    icon: 'mdi-github',
    content: [
      {
        q: 'How do I connect to GitHub?',
        a: 'Go to **Settings > GitHub**. Two options:\n\n**GitHub App (Recommended):**\n1. Click "Create GitHub App"\n2. GitHub creates the app via the manifest flow\n3. Install it on your repos\n4. Done — tokens rotate automatically\n\n**Personal Access Token:**\n1. Create a fine-grained PAT on GitHub\n2. Grant: Contents (write), Pull Requests (write), Issues (write)\n3. Paste in the dashboard\n\nNote: PATs don\'t support webhooks or the Checks API.',
      },
      {
        q: 'How are PRs created?',
        a: 'When a job completes, Claude HQ can auto-create a PR if `autoPr: true` was set. The PR body includes:\n- The original prompt\n- Diff summary (files changed, lines added/removed)\n- Cost and duration\n- Link back to the session recording\n\nYou can also manually trigger PR creation from the job detail page.',
      },
    ],
  },
  {
    title: 'Queue & Scheduling',
    icon: 'mdi-clock-outline',
    content: [
      {
        q: 'How does the task queue work?',
        a: 'Each machine has its own queue. When all PTY slots are full, new tasks are added to the queue. When a session completes, the next queued task auto-starts.\n\nOn the **Queue** page you can:\n- Add tasks with prompt + working directory\n- Reorder tasks (up/down buttons)\n- Remove tasks\n- View queue depth per machine',
      },
      {
        q: 'How do scheduled tasks work?',
        a: 'Go to **Scheduled Tasks** and create a task with a cron expression:\n- `0 * * * *` — every hour\n- `0 9 * * 1-5` — 9am weekdays\n- `*/30 * * * *` — every 30 minutes\n\nConcurrency policy options:\n- **Forbid** — skip if a previous run is still active\n- **Allow** — run concurrently\n- **Replace** — cancel the previous run',
      },
    ],
  },
  {
    title: 'Costs & Budget',
    icon: 'mdi-currency-usd',
    content: [
      {
        q: 'How is cost tracked?',
        a: 'Claude Code reports `total_cost_usd` and token usage in its output. Claude HQ stores this per session and aggregates it:\n- **Today / Week / Month** summary\n- **By repository** breakdown\n- **By machine** breakdown\n\nView the **Costs** page for the full dashboard.',
      },
      {
        q: 'How do budgets work?',
        a: 'Configure budgets via `PUT /api/costs/budget`:\n- **Per-session max** — kills session if cost exceeds limit\n- **Per-machine daily** — stops scheduling on that machine\n- **Global daily** — stops all new sessions\n\nAlerts fire at 50%, 75%, 90%, and 100% thresholds.',
      },
    ],
  },
  {
    title: 'Notifications',
    icon: 'mdi-bell',
    content: [
      {
        q: 'How do I set up notifications?',
        a: 'Claude HQ sends webhook notifications for:\n- Session completed\n- Session failed\n- Session stalled (no output for 5 min)\n- Queue empty\n- Agent offline\n- Input needed\n\nConfigure webhooks via the API:\n```\nPUT /api/notifications/config\n{\n  "webhooks": [{\n    "url": "https://discord.com/api/webhooks/...",\n    "format": "discord"\n  }],\n  "events": ["session_completed", "session_failed"],\n  "enabled": true\n}\n```\n\nSupported formats: `json`, `discord` (embeds), `slack` (Block Kit).',
      },
      {
        q: 'Where is the notification bell?',
        a: 'The bell icon in the top-right of the app bar shows real-time notifications from the Hub via WebSocket. Click it to see the notification feed. Unread count shows as a badge.',
      },
    ],
  },
  {
    title: 'Deployment & Operations',
    icon: 'mdi-docker',
    content: [
      {
        q: 'How do I deploy with Docker?',
        a: '```bash\ncp .env.example .env\n# Edit .env with your settings\ndocker compose build\ndocker compose up -d\n```\n\nThe Hub serves the dashboard on port 7700. Data persists in `./data/db/` and `./data/recordings/`.',
      },
      {
        q: 'How do I back up the database?',
        a: '```bash\nmake backup\n# Or manually:\ndocker compose exec hub sqlite3 /app/data/db/chq.db ".backup /app/data/db/backup.db"\n```\n\nSQLite with WAL mode supports backup while the Hub is running.',
      },
      {
        q: 'How do I update?',
        a: '```bash\ngit pull\ndocker compose build --pull\ndocker compose up -d\n```\n\nMigrations run automatically on startup.',
      },
      {
        q: 'What about Tailscale?',
        a: 'Tailscale provides a zero-config mesh VPN. All machines on your tailnet can reach each other directly.\n\n- Install Tailscale on each machine\n- Agents connect to the Hub using its Tailscale IP\n- No port forwarding or firewall rules needed\n- Traffic is encrypted via WireGuard\n\nFor the Hub in Docker, run Tailscale on the host or use the sidecar container pattern (see docker-compose.yml).',
      },
    ],
  },
];
</script>

<template>
  <div>
    <div class="d-flex align-center ga-3 mb-6">
      <v-icon size="large" color="primary">mdi-help-circle</v-icon>
      <div>
        <h1 class="text-h4 font-weight-bold">Help Guide</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Everything you need to know about Claude HQ
        </p>
      </div>
    </div>

    <v-expansion-panels v-model="openPanels" multiple variant="accordion">
      <v-expansion-panel v-for="(section, i) in sections" :key="i">
        <v-expansion-panel-title>
          <div class="d-flex align-center ga-3">
            <v-icon :icon="section.icon" color="primary" />
            <span class="text-h6">{{ section.title }}</span>
          </div>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <v-card
            v-for="(item, j) in section.content"
            :key="j"
            variant="flat"
            class="mb-3"
          >
            <v-card-item>
              <v-card-title class="text-subtitle-1 font-weight-bold">
                {{ item.q }}
              </v-card-title>
            </v-card-item>
            <v-card-text>
              <!-- eslint-disable-next-line vue/no-v-html -->
              <div class="help-content" v-html="renderMarkdown(item.a)" />
            </v-card-text>
          </v-card>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <v-card class="mt-6 pa-4" variant="tonal" color="primary">
      <div class="d-flex align-center ga-3">
        <v-icon>mdi-api</v-icon>
        <div>
          <div class="font-weight-bold">API Reference</div>
          <div class="text-body-2">
            The Hub exposes a full REST API. Check
            <code>GET /health</code> to verify the Hub is running, then explore
            endpoints at <code>/api/sessions</code>, <code>/api/machines</code>,
            <code>/api/jobs</code>, <code>/api/repos</code>, etc.
          </div>
        </div>
      </div>
    </v-card>

    <v-card class="mt-3 pa-4" variant="tonal" color="secondary">
      <div class="d-flex align-center ga-3">
        <v-icon>mdi-github</v-icon>
        <div>
          <div class="font-weight-bold">Source Code & Issues</div>
          <div class="text-body-2">
            Report bugs and request features at
            <a href="https://github.com/lasswellt/claudeHQ" target="_blank" class="text-secondary">
              github.com/lasswellt/claudeHQ
            </a>
          </div>
        </div>
      </div>
    </v-card>
  </div>
</template>

<script lang="ts">
// Simple markdown-to-HTML for FAQ answers
function renderMarkdown(text: string): string {
  return text
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-surface-variant pa-3 rounded my-2 overflow-x-auto"><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-surface-variant px-1 rounded">$1</code>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Numbered lists
    .replace(/^(\d+)\.\s+(.+)$/gm, '<div class="ml-4">$1. $2</div>')
    // Bullet lists
    .replace(/^-\s+(.+)$/gm, '<div class="ml-4">&bull; $1</div>')
    // Line breaks
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}
</script>

<style scoped>
.help-content :deep(pre) {
  font-size: 0.85rem;
  line-height: 1.5;
}
.help-content :deep(code) {
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 0.85em;
}
</style>
