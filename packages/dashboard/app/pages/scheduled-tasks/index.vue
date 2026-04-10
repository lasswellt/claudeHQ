<script setup lang="ts">
import { ref, onMounted } from 'vue';

definePageMeta({ layout: 'default' });

interface ScheduledTask {
  id: string;
  name: string;
  cron_expression: string;
  prompt: string;
  cwd: string;
  enabled: number;
  last_run_at: number | null;
  next_run_at: number | null;
  successful_runs: number;
  failed_runs: number;
}

const tasks = ref<ScheduledTask[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const showCreate = ref(false);
const newName = ref('');
const newCron = ref('');
const newPrompt = ref('');
const newCwd = ref('');
const creating = ref(false);

onMounted(fetchTasks);

async function fetchTasks(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch('/api/scheduled-tasks');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    tasks.value = (await res.json()) as ScheduledTask[];
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load scheduled tasks';
  } finally {
    loading.value = false;
  }
}

async function createTask(): Promise<void> {
  if (!newName.value || !newCron.value || !newPrompt.value || !newCwd.value) return;
  creating.value = true;
  error.value = null;
  try {
    const res = await fetch('/api/scheduled-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName.value,
        cronExpression: newCron.value,
        prompt: newPrompt.value,
        cwd: newCwd.value,
      }),
    });
    if (!res.ok) throw new Error(`Failed to create task: HTTP ${res.status}`);
    showCreate.value = false;
    newName.value = '';
    newCron.value = '';
    newPrompt.value = '';
    newCwd.value = '';
    await fetchTasks();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to create task';
  } finally {
    creating.value = false;
  }
}

async function toggleEnabled(task: ScheduledTask): Promise<void> {
  try {
    const res = await fetch(`/api/scheduled-tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !task.enabled }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await fetchTasks();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to update task';
  }
}

async function deleteTask(id: string): Promise<void> {
  try {
    const res = await fetch(`/api/scheduled-tasks/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await fetchTasks();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to delete task';
  }
}
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-6">
      <h1 class="text-h4 font-weight-bold">Scheduled Tasks</h1>
      <v-btn color="primary" prepend-icon="mdi-plus" @click="showCreate = true">New Task</v-btn>
    </div>

    <v-skeleton-loader v-if="loading" type="table" />
    <v-alert v-else-if="error" type="error" variant="tonal">
      {{ error }}
      <template #append>
        <v-btn variant="text" @click="fetchTasks">Retry</v-btn>
      </template>
    </v-alert>
    <v-alert v-else-if="tasks.length === 0" type="info" variant="tonal">
      No scheduled tasks. Create one to run prompts on a cron schedule.
    </v-alert>

    <v-data-table
      v-else
      :items="tasks"
      :headers="[
        { title: 'Name', key: 'name' },
        { title: 'Schedule', key: 'cron_expression', width: '140px' },
        { title: 'Runs', key: 'runs', width: '100px', sortable: false },
        { title: 'Last Run', key: 'last_run_at', width: '160px' },
        { title: 'Enabled', key: 'enabled', width: '80px' },
        { title: '', key: 'actions', width: '100px', sortable: false },
      ]"
      density="comfortable"
    >
      <template #item.cron_expression="{ value }">
        <code class="text-caption">{{ value }}</code>
      </template>
      <template #item.runs="{ item }">
        <span class="text-success">{{ (item as ScheduledTask).successful_runs }}</span>
        <span class="text-medium-emphasis">/</span>
        <span class="text-error">{{ (item as ScheduledTask).failed_runs }}</span>
      </template>
      <template #item.last_run_at="{ value }">
        {{ value ? new Date((value as number) * 1000).toLocaleString() : 'Never' }}
      </template>
      <template #item.enabled="{ item }">
        <v-switch
          :model-value="!!(item as ScheduledTask).enabled"
          hide-details
          density="compact"
          color="success"
          @update:model-value="toggleEnabled(item as ScheduledTask)"
        />
      </template>
      <template #item.actions="{ item }">
        <v-btn icon="mdi-delete" size="x-small" variant="text" color="error" @click="deleteTask((item as ScheduledTask).id)" />
      </template>
    </v-data-table>

    <v-dialog v-model="showCreate" max-width="500">
      <v-card>
        <v-card-title>New Scheduled Task</v-card-title>
        <v-card-text>
          <v-text-field v-model="newName" label="Name" class="mb-3" />
          <v-text-field v-model="newCron" label="Cron Expression" placeholder="0 * * * *" hint="minute hour day month weekday" persistent-hint class="mb-3" />
          <v-textarea v-model="newPrompt" label="Prompt" rows="3" class="mb-3" />
          <v-text-field v-model="newCwd" label="Working Directory" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showCreate = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" :loading="creating" :disabled="!newName || !newCron || !newPrompt || !newCwd" @click="createTask">
            Create
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
