<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionsStore } from '../stores/sessions';
import { useMachinesStore } from '../stores/machines';
import MachineCard from '../components/machine/MachineCard.vue';
import NewSessionModal from '../components/session/NewSessionModal.vue';

definePageMeta({ layout: 'default' });

const router = useRouter();
const sessionsStore = useSessionsStore();
const machinesStore = useMachinesStore();
const showNewSession = ref(false);

onMounted(() => {
  sessionsStore.fetchSessions();
  machinesStore.fetchMachines();
});

function goToMachine(id: string): void {
  router.push(`/machines/${id}`);
}

function goToSession(id: string): void {
  router.push(`/sessions/${id}`);
}

function onSessionCreated(id: string): void {
  router.push(`/sessions/${id}`);
}

const statusColor: Record<string, string> = {
  running: 'success',
  completed: 'default',
  failed: 'error',
  queued: 'info',
};
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-6">
      <h1 class="text-h4 font-weight-bold">Overview</h1>
      <v-btn color="primary" prepend-icon="mdi-plus" @click="showNewSession = true">
        New Session
      </v-btn>
    </div>

    <!-- Machines -->
    <h2 class="text-h6 mb-3">Machines</h2>
    <v-skeleton-loader v-if="machinesStore.loading" type="card" />
    <v-alert v-else-if="machinesStore.error" type="error" variant="tonal">
      {{ machinesStore.error }}
      <template #append>
        <v-btn variant="text" size="small" @click="machinesStore.fetchMachines()">Retry</v-btn>
      </template>
    </v-alert>
    <v-alert v-else-if="machinesStore.machines.length === 0" type="info" variant="tonal">
      No machines registered. Start an agent with <code>chq agent start</code>.
    </v-alert>
    <v-row v-else>
      <v-col v-for="machine in machinesStore.machines" :key="machine.id" cols="12" sm="6" md="4" lg="3">
        <MachineCard :machine="machine" @select="goToMachine" />
      </v-col>
    </v-row>

    <!-- Sessions -->
    <h2 class="text-h6 mt-8 mb-3">Recent Sessions</h2>
    <v-skeleton-loader v-if="sessionsStore.loading" type="table" />
    <v-alert v-else-if="sessionsStore.error" type="error" variant="tonal">
      {{ sessionsStore.error }}
      <template #append>
        <v-btn variant="text" size="small" @click="sessionsStore.fetchSessions()">Retry</v-btn>
      </template>
    </v-alert>
    <v-alert v-else-if="sessionsStore.sessions.length === 0" type="info" variant="tonal">
      No sessions yet. Start one with the button above.
    </v-alert>
    <v-data-table
      v-else
      :items="sessionsStore.sessions"
      :headers="[
        { title: 'Status', key: 'status', width: '100px' },
        { title: 'Prompt', key: 'prompt' },
        { title: 'Machine', key: 'machine_id', width: '150px' },
        { title: 'Created', key: 'created_at', width: '150px' },
        { title: '', key: 'actions', width: '100px', sortable: false },
      ]"
      density="comfortable"
      hover
      @click:row="(_: unknown, row: { item: { id: string } }) => goToSession(row.item.id)"
    >
      <template #item.status="{ value }">
        <v-chip :color="statusColor[value as string] ?? 'default'" size="small">
          {{ value }}
        </v-chip>
      </template>
      <template #item.prompt="{ value }">
        <span class="text-truncate d-inline-block" style="max-width: 400px">{{ value }}</span>
      </template>
      <template #item.created_at="{ value }">
        {{ new Date((value as number) * 1000).toLocaleTimeString() }}
      </template>
      <template #item.actions="{ item }">
        <v-btn icon="mdi-console" size="small" variant="text" @click.stop="goToSession((item as { id: string }).id)" />
      </template>
    </v-data-table>

    <NewSessionModal v-model="showNewSession" @created="onSessionCreated" />
  </div>
</template>
