<script setup lang="ts">
import { onMounted } from 'vue';
import { useMachinesStore } from '../../stores/machines';
import { useQueuesStore } from '../../stores/queues';

definePageMeta({ layout: 'default' });

const machinesStore = useMachinesStore();
const queuesStore = useQueuesStore();

onMounted(async () => {
  await machinesStore.fetchMachines();
  for (const machine of machinesStore.machines) {
    queuesStore.fetchQueues(machine.id);
  }
});
</script>

<template>
  <div>
    <h1 class="text-h4 font-weight-bold mb-6">Queue</h1>

    <v-skeleton-loader v-if="machinesStore.loading" type="card" />
    <v-alert v-else-if="machinesStore.machines.length === 0" type="info" variant="tonal">
      No machines registered.
    </v-alert>

    <template v-else>
      <v-card v-for="machine in machinesStore.machines" :key="machine.id" class="mb-4">
        <v-card-title>
          <v-icon size="small" :color="machine.status === 'online' ? 'success' : 'error'" class="mr-2">
            mdi-circle
          </v-icon>
          {{ machine.display_name || machine.id }}
        </v-card-title>
        <v-card-text>
          <v-list v-if="(queuesStore.queuesByMachine.get(machine.id) ?? []).length > 0" density="compact">
            <v-list-item
              v-for="task in queuesStore.queuesByMachine.get(machine.id)"
              :key="task.id"
            >
              <template #prepend>
                <v-chip size="x-small" color="info" class="mr-2">
                  #{{ task.position + 1 }}
                </v-chip>
              </template>
              <v-list-item-title>{{ task.prompt }}</v-list-item-title>
              <v-list-item-subtitle>{{ task.cwd }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>
          <div v-else class="text-medium-emphasis text-body-2">
            Queue empty.
          </div>
        </v-card-text>
      </v-card>
    </template>
  </div>
</template>
