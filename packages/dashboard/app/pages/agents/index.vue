<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { SpawnedAgentRecord } from '@chq/shared/browser';
import type { RepoRecord } from '@chq/shared/browser';
import StatusIndicator from '../../components/StatusIndicator.vue';

definePageMeta({ layout: 'default' });

const agents = ref<SpawnedAgentRecord[]>([]);
const repos = ref<RepoRecord[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const statusFilter = ref<string | null>(null);

// Spawn dialog state
const showSpawn = ref(false);
const spawnRepoUrl = ref('');
const spawnBranch = ref('main');
const spawnDisplayName = ref('');
const spawning = ref(false);
const spawnError = ref<string | null>(null);

// Confirm dialog state
const confirmDialog = ref(false);
const confirmAction = ref<'stop' | 'remove'>('stop');
const confirmAgentId = ref('');
const confirmAgentLabel = ref('');
const actionLoading = ref(false);

let pollTimer: ReturnType<typeof setInterval> | null = null;

const filteredAgents = computed(() => {
  if (!statusFilter.value) return agents.value;
  return agents.value.filter((a) => a.status === statusFilter.value);
});

const activeCount = computed(() =>
  agents.value.filter((a) =>
    ['creating', 'starting', 'running'].includes(a.status),
  ).length,
);

async function fetchAgents(): Promise<void> {
  try {
    const res = await fetch('/api/agents');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    agents.value = (await res.json()) as SpawnedAgentRecord[];
    if (loading.value) loading.value = false;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load agents';
    loading.value = false;
  }
}

async function fetchRepos(): Promise<void> {
  try {
    const res = await fetch('/api/repos');
    if (!res.ok) return;
    repos.value = (await res.json()) as RepoRecord[];
  } catch {
    // Non-critical — spawn dialog falls back to manual URL
  }
}

async function spawnAgent(): Promise<void> {
  if (!spawnRepoUrl.value) return;
  spawning.value = true;
  spawnError.value = null;
  try {
    const body: Record<string, string> = { repoUrl: spawnRepoUrl.value };
    if (spawnBranch.value && spawnBranch.value !== 'main') body.branch = spawnBranch.value;
    if (spawnDisplayName.value) body.displayName = spawnDisplayName.value;

    // If the URL matches a known repo, include repo ID
    const matchedRepo = repos.value.find((r) => r.url === spawnRepoUrl.value);
    if (matchedRepo) body.repoId = matchedRepo.id;

    const res = await fetch('/api/agents/spawn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    showSpawn.value = false;
    spawnRepoUrl.value = '';
    spawnBranch.value = 'main';
    spawnDisplayName.value = '';
    await fetchAgents();
  } catch (e) {
    spawnError.value = e instanceof Error ? e.message : 'Failed to spawn agent';
  } finally {
    spawning.value = false;
  }
}

function openConfirm(action: 'stop' | 'remove', agent: SpawnedAgentRecord): void {
  confirmAction.value = action;
  confirmAgentId.value = agent.id;
  confirmAgentLabel.value = agent.repo_url.replace(/.*\//, '') + '/' + agent.branch;
  confirmDialog.value = true;
}

async function executeConfirm(): Promise<void> {
  actionLoading.value = true;
  try {
    const url = confirmAction.value === 'stop'
      ? `/api/agents/${confirmAgentId.value}/stop`
      : `/api/agents/${confirmAgentId.value}`;
    const method = confirmAction.value === 'stop' ? 'POST' : 'DELETE';
    const res = await fetch(url, { method });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    confirmDialog.value = false;
    await fetchAgents();
  } catch (e) {
    error.value = e instanceof Error ? e.message : `Failed to ${confirmAction.value} agent`;
  } finally {
    actionLoading.value = false;
  }
}

function repoName(url: string): string {
  return url.replace(/\.git$/, '').replace(/.*\//, '');
}

function timeAgo(ts: number): string {
  const seconds = Math.floor(Date.now() / 1000) - ts;
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

onMounted(async () => {
  await Promise.all([fetchAgents(), fetchRepos()]);
  pollTimer = setInterval(fetchAgents, 10000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-6">
      <div>
        <h1 class="text-h4 font-weight-bold">Agents</h1>
        <p class="text-body-2 text-medium-emphasis mt-1">
          {{ activeCount }} active container{{ activeCount !== 1 ? 's' : '' }}
        </p>
      </div>
      <v-btn color="primary" variant="flat" prepend-icon="mdi-robot" @click="showSpawn = true">
        Spawn Agent
      </v-btn>
    </div>

    <v-chip-group v-model="statusFilter" class="mb-4" selected-class="text-primary">
      <v-chip :value="null" variant="outlined" filter>All</v-chip>
      <v-chip value="running" variant="outlined" filter>Running</v-chip>
      <v-chip value="creating" variant="outlined" filter>Creating</v-chip>
      <v-chip value="stopped" variant="outlined" filter>Stopped</v-chip>
      <v-chip value="error" variant="outlined" filter>Error</v-chip>
    </v-chip-group>

    <!-- Loading -->
    <v-skeleton-loader v-if="loading" type="table" />

    <!-- Error -->
    <v-alert v-else-if="error" type="error" variant="tonal" class="mb-4">
      {{ error }}
      <template #append>
        <v-btn variant="text" @click="error = null; fetchAgents()">Retry</v-btn>
      </template>
    </v-alert>

    <!-- Empty -->
    <v-alert v-else-if="filteredAgents.length === 0" type="info" variant="tonal">
      <template v-if="statusFilter">
        No agents with status "{{ statusFilter }}".
      </template>
      <template v-else>
        No spawned agents. Click <strong>Spawn Agent</strong> to launch a Docker container for a repository.
      </template>
    </v-alert>

    <!-- Agent list -->
    <v-row v-else>
      <v-col v-for="agent in filteredAgents" :key="agent.id" cols="12" md="6" lg="4">
        <v-card>
          <v-card-title class="d-flex align-center ga-2">
            <v-icon size="20" color="primary">mdi-robot</v-icon>
            <span class="text-truncate">{{ repoName(agent.repo_url) }}</span>
            <v-spacer />
            <StatusIndicator :status="agent.status" size="small" />
          </v-card-title>

          <v-card-text>
            <div class="d-flex flex-column ga-1 text-body-2">
              <div class="d-flex align-center ga-1">
                <v-icon size="14" color="medium-emphasis">mdi-source-branch</v-icon>
                <span class="text-medium-emphasis">{{ agent.branch }}</span>
              </div>
              <div class="d-flex align-center ga-1">
                <v-icon size="14" color="medium-emphasis">mdi-clock-outline</v-icon>
                <span class="text-medium-emphasis">Created {{ timeAgo(agent.created_at) }}</span>
              </div>
              <div v-if="agent.started_at" class="d-flex align-center ga-1">
                <v-icon size="14" color="success">mdi-play-circle</v-icon>
                <span class="text-medium-emphasis">Started {{ timeAgo(agent.started_at) }}</span>
              </div>
              <div v-if="agent.error_message" class="d-flex align-center ga-1">
                <v-icon size="14" color="error">mdi-alert-circle</v-icon>
                <span class="text-error text-truncate">{{ agent.error_message }}</span>
              </div>
            </div>
            <div class="mt-2">
              <v-chip size="x-small" variant="outlined" class="text-truncate" style="max-width: 100%">
                {{ agent.id.slice(0, 8) }}
              </v-chip>
            </div>
          </v-card-text>

          <v-card-actions>
            <v-btn
              v-if="['creating', 'starting', 'running'].includes(agent.status)"
              size="small"
              variant="text"
              color="warning"
              prepend-icon="mdi-stop"
              @click="openConfirm('stop', agent)"
            >
              Stop
            </v-btn>
            <v-btn
              v-if="['stopped', 'error'].includes(agent.status)"
              size="small"
              variant="text"
              color="error"
              prepend-icon="mdi-delete"
              @click="openConfirm('remove', agent)"
            >
              Remove
            </v-btn>
            <v-spacer />
            <v-btn
              v-if="agent.status === 'running'"
              size="small"
              variant="text"
              color="primary"
              prepend-icon="mdi-console"
              :to="`/sessions?machine=${agent.id}`"
            >
              Sessions
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <!-- Spawn dialog -->
    <v-dialog v-model="showSpawn" max-width="520" persistent>
      <v-card>
        <v-card-title>Spawn Agent Container</v-card-title>
        <v-card-text>
          <v-alert v-if="spawnError" type="error" variant="tonal" class="mb-4" closable @click:close="spawnError = null">
            {{ spawnError }}
          </v-alert>

          <v-select
            v-if="repos.length > 0"
            v-model="spawnRepoUrl"
            :items="repos.map((r) => ({ title: `${r.owner}/${r.name}`, value: r.url }))"
            label="Repository"
            prepend-inner-icon="mdi-source-repository"
            clearable
            class="mb-2"
          />
          <v-text-field
            v-model="spawnRepoUrl"
            label="Repository URL"
            placeholder="https://github.com/owner/repo.git"
            prepend-inner-icon="mdi-link"
            :hint="repos.length > 0 ? 'Or select from the dropdown above' : ''"
          />
          <v-text-field
            v-model="spawnBranch"
            label="Branch"
            prepend-inner-icon="mdi-source-branch"
          />
          <v-text-field
            v-model="spawnDisplayName"
            label="Display name (optional)"
            prepend-inner-icon="mdi-label"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showSpawn = false; spawnError = null">Cancel</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="spawning"
            :disabled="!spawnRepoUrl"
            @click="spawnAgent"
          >
            Spawn
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Confirm dialog -->
    <v-dialog v-model="confirmDialog" max-width="400">
      <v-card>
        <v-card-title>
          {{ confirmAction === 'stop' ? 'Stop' : 'Remove' }} Agent
        </v-card-title>
        <v-card-text>
          {{ confirmAction === 'stop'
            ? `Stop the running agent for ${confirmAgentLabel}? The container will be gracefully shut down.`
            : `Remove the agent for ${confirmAgentLabel}? This will delete the container and clean up the worktree.`
          }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmDialog = false">Cancel</v-btn>
          <v-btn
            :color="confirmAction === 'stop' ? 'warning' : 'error'"
            variant="flat"
            :loading="actionLoading"
            @click="executeConfirm"
          >
            {{ confirmAction === 'stop' ? 'Stop' : 'Remove' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
