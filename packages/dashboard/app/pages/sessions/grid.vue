<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionsStore } from '../../stores/sessions';
import TerminalView from '../../components/terminal/TerminalView.vue';

definePageMeta({ layout: 'default' });

const router = useRouter();
const sessionsStore = useSessionsStore();
const layout = ref<'2x2' | '1x4'>('2x2');
const selectedIds = ref<string[]>([]);

onMounted(() => sessionsStore.fetchSessions());

const activeSessions = computed(() => sessionsStore.activeSessions);

const displaySessions = computed(() => {
  if (selectedIds.value.length > 0) {
    return selectedIds.value
      .map((id) => sessionsStore.sessionById.get(id))
      .filter((s) => s !== undefined);
  }
  return activeSessions.value.slice(0, layout.value === '2x2' ? 4 : 4);
});

const gridCols = computed(() => (layout.value === '2x2' ? 6 : 12));

function expandSession(id: string): void {
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
    <div class="d-flex align-center justify-space-between mb-4">
      <h1 class="text-h4 font-weight-bold">Session Grid</h1>
      <div class="d-flex ga-2 align-center">
        <v-btn-toggle v-model="layout" mandatory density="compact" variant="outlined">
          <v-btn value="2x2" size="small">2x2</v-btn>
          <v-btn value="1x4" size="small">1x4</v-btn>
        </v-btn-toggle>
      </div>
    </div>

    <v-alert v-if="activeSessions.length === 0" type="info" variant="tonal">
      No active sessions to display.
    </v-alert>

    <v-row v-else>
      <v-col
        v-for="session in displaySessions"
        :key="session.id"
        :cols="gridCols"
      >
        <v-card class="grid-terminal-card" @click="expandSession(session.id)">
          <v-card-item density="compact">
            <template #prepend>
              <v-chip :color="statusColor[session.status]" size="x-small">
                {{ session.status }}
              </v-chip>
            </template>
            <v-card-title class="text-body-2 text-truncate">
              {{ session.prompt }}
            </v-card-title>
            <v-card-subtitle class="text-caption">
              {{ session.machine_id }}
            </v-card-subtitle>
          </v-card-item>
          <div style="height: 250px">
            <TerminalView :session-id="session.id" :readonly="true" />
          </div>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<style scoped>
.grid-terminal-card {
  cursor: pointer;
  transition: outline 0.15s;
}
.grid-terminal-card:hover {
  outline: 2px solid rgb(var(--v-theme-primary));
}
</style>
