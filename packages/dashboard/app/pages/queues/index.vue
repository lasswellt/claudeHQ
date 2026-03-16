<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useMachinesStore } from '../../stores/machines';
import type { QueueTask } from '@chq/shared/browser';

definePageMeta({ layout: 'default' });

const machinesStore = useMachinesStore();
const queuesByMachine = ref<Record<string, QueueTask[]>>({});
const loading = ref(true);
const showAddTask = ref(false);
const selectedMachine = ref('');
const newPrompt = ref('');
const newCwd = ref('');

onMounted(async () => {
  await machinesStore.fetchMachines();
  await fetchQueues();
});

async function fetchQueues(): Promise<void> {
  loading.value = true;
  try {
    const res = await fetch('/api/queues');
    queuesByMachine.value = (await res.json()) as Record<string, QueueTask[]>;
  } finally {
    loading.value = false;
  }
}

async function addTask(): Promise<void> {
  if (!selectedMachine.value || !newPrompt.value || !newCwd.value) return;
  await fetch(`/api/queues/${selectedMachine.value}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: newPrompt.value, cwd: newCwd.value }),
  });
  showAddTask.value = false;
  newPrompt.value = '';
  newCwd.value = '';
  await fetchQueues();
}

async function removeTask(machineId: string, taskId: string): Promise<void> {
  await fetch(`/api/queues/${machineId}/${taskId}`, { method: 'DELETE' });
  await fetchQueues();
}

async function reorder(machineId: string, tasks: QueueTask[]): Promise<void> {
  await fetch(`/api/queues/${machineId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order: tasks.map((t) => t.id) }),
  });
}

function moveUp(machineId: string, idx: number): void {
  const tasks = [...(queuesByMachine.value[machineId] ?? [])];
  if (idx <= 0) return;
  [tasks[idx - 1], tasks[idx]] = [tasks[idx]!, tasks[idx - 1]!];
  queuesByMachine.value[machineId] = tasks;
  reorder(machineId, tasks);
}

function moveDown(machineId: string, idx: number): void {
  const tasks = [...(queuesByMachine.value[machineId] ?? [])];
  if (idx >= tasks.length - 1) return;
  [tasks[idx], tasks[idx + 1]] = [tasks[idx + 1]!, tasks[idx]!];
  queuesByMachine.value[machineId] = tasks;
  reorder(machineId, tasks);
}
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-6">
      <h1 class="text-h4 font-weight-bold">Queue</h1>
      <v-btn color="primary" prepend-icon="mdi-plus" @click="showAddTask = true">
        Add Task
      </v-btn>
    </div>

    <v-skeleton-loader v-if="loading" type="card" />

    <template v-else>
      <v-card v-for="machine in machinesStore.machines" :key="machine.id" class="mb-4">
        <v-card-title class="d-flex align-center">
          <v-icon size="small" :color="machine.status === 'online' ? 'success' : 'error'" class="mr-2">
            mdi-circle
          </v-icon>
          {{ machine.display_name || machine.id }}
          <v-chip size="x-small" class="ml-2">
            {{ (queuesByMachine[machine.id] ?? []).length }} tasks
          </v-chip>
        </v-card-title>
        <v-card-text>
          <v-list v-if="(queuesByMachine[machine.id] ?? []).length > 0" density="compact">
            <v-list-item v-for="(task, idx) in queuesByMachine[machine.id]" :key="task.id">
              <template #prepend>
                <div class="d-flex flex-column mr-2">
                  <v-btn icon="mdi-chevron-up" size="x-small" variant="text" density="compact"
                    :disabled="idx === 0" @click="moveUp(machine.id, idx)" />
                  <v-btn icon="mdi-chevron-down" size="x-small" variant="text" density="compact"
                    :disabled="idx === (queuesByMachine[machine.id]?.length ?? 0) - 1"
                    @click="moveDown(machine.id, idx)" />
                </div>
                <v-chip size="x-small" color="info" class="mr-2">#{{ idx + 1 }}</v-chip>
              </template>
              <v-list-item-title>{{ task.prompt }}</v-list-item-title>
              <v-list-item-subtitle>{{ task.cwd }}</v-list-item-subtitle>
              <template #append>
                <v-btn icon="mdi-close" size="x-small" variant="text" color="error"
                  @click="removeTask(machine.id, task.id)" />
              </template>
            </v-list-item>
          </v-list>
          <div v-else class="text-medium-emphasis text-body-2 pa-2">Queue empty.</div>
        </v-card-text>
      </v-card>
    </template>

    <v-dialog v-model="showAddTask" max-width="500">
      <v-card>
        <v-card-title>Add Queue Task</v-card-title>
        <v-card-text>
          <v-select v-model="selectedMachine"
            :items="machinesStore.onlineMachines.map(m => ({ title: m.display_name || m.id, value: m.id }))"
            label="Machine" class="mb-3" />
          <v-textarea v-model="newPrompt" label="Prompt" rows="3" class="mb-3" />
          <v-text-field v-model="newCwd" label="Working Directory" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showAddTask = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" :disabled="!selectedMachine || !newPrompt || !newCwd" @click="addTask">
            Add to Queue
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
