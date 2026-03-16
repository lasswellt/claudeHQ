<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMachinesStore } from '../../stores/machines';
import { useSessionsStore } from '../../stores/sessions';
import NewSessionModal from '../../components/session/NewSessionModal.vue';
import MachineHealth from '../../components/machine/MachineHealth.vue';

definePageMeta({ layout: 'default' });

const route = useRoute();
const router = useRouter();
const machinesStore = useMachinesStore();
const sessionsStore = useSessionsStore();
const machineId = computed(() => route.params.id as string);
const machine = computed(() => machinesStore.machineById.get(machineId.value));
const showNewSession = ref(false);

const machineSessions = computed(() =>
  sessionsStore.sessions.filter((s) => s.machine_id === machineId.value),
);

const activeSessions = computed(() =>
  machineSessions.value.filter((s) => s.status === 'running' || s.status === 'queued'),
);

const completedSessions = computed(() =>
  machineSessions.value.filter((s) => s.status === 'completed' || s.status === 'failed'),
);

onMounted(() => {
  machinesStore.fetchMachines();
  sessionsStore.fetchSessions();
});

const statusColor: Record<string, string> = {
  running: 'success',
  completed: 'default',
  failed: 'error',
  queued: 'info',
};
</script>

<template>
  <div>
    <div class="d-flex align-center ga-3 mb-4">
      <v-btn icon="mdi-arrow-left" variant="text" @click="router.back()" />
      <h1 class="text-h5 font-weight-bold">{{ machine?.display_name || machineId }}</h1>
      <v-chip v-if="machine" :color="machine.status === 'online' ? 'success' : 'error'" size="small">
        {{ machine.status }}
      </v-chip>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="showNewSession = true">
        New Session
      </v-btn>
    </div>

    <v-alert v-if="!machine && !machinesStore.loading" type="warning" variant="tonal">
      Machine not found.
    </v-alert>

    <template v-else-if="machine">
      <!-- Machine info -->
      <v-card class="mb-6">
        <v-card-text>
          <v-row dense>
            <v-col cols="6" sm="3">
              <div class="text-caption text-medium-emphasis">Status</div>
              <v-chip :color="machine.status === 'online' ? 'success' : 'error'" size="small">
                {{ machine.status }}
              </v-chip>
            </v-col>
            <v-col cols="6" sm="3">
              <div class="text-caption text-medium-emphasis">Max Sessions</div>
              <div>{{ machine.max_sessions }}</div>
            </v-col>
            <v-col cols="6" sm="3">
              <div class="text-caption text-medium-emphasis">OS</div>
              <div>{{ machine.meta?.os ?? 'Unknown' }}</div>
            </v-col>
            <v-col cols="6" sm="3">
              <div class="text-caption text-medium-emphasis">Last Seen</div>
              <div>{{ new Date(machine.last_seen * 1000).toLocaleTimeString() }}</div>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>

      <!-- Health charts -->
      <MachineHealth :machine-id="machineId" class="mb-6" />

      <!-- Active sessions -->
      <h2 class="text-h6 mb-3">Active Sessions ({{ activeSessions.length }})</h2>
      <v-alert v-if="activeSessions.length === 0" type="info" variant="tonal" class="mb-6">
        No active sessions.
      </v-alert>
      <v-list v-else class="mb-6">
        <v-list-item
          v-for="session in activeSessions"
          :key="session.id"
          :to="`/sessions/${session.id}`"
        >
          <template #prepend>
            <v-chip :color="statusColor[session.status]" size="x-small" class="mr-2">
              {{ session.status }}
            </v-chip>
          </template>
          <v-list-item-title>{{ session.prompt }}</v-list-item-title>
        </v-list-item>
      </v-list>

      <!-- Completed sessions -->
      <h2 class="text-h6 mb-3">Recent Completed ({{ completedSessions.length }})</h2>
      <v-list v-if="completedSessions.length > 0">
        <v-list-item
          v-for="session in completedSessions.slice(0, 10)"
          :key="session.id"
          :to="`/sessions/${session.id}`"
        >
          <template #prepend>
            <v-chip :color="statusColor[session.status]" size="x-small" class="mr-2">
              {{ session.status }}
            </v-chip>
          </template>
          <v-list-item-title>{{ session.prompt }}</v-list-item-title>
        </v-list-item>
      </v-list>
    </template>

    <NewSessionModal
      v-model="showNewSession"
      :default-machine-id="machineId"
      @created="(id: string) => router.push(`/sessions/${id}`)"
    />
  </div>
</template>
