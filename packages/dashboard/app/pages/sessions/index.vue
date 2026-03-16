<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionsStore } from '../../stores/sessions';

definePageMeta({ layout: 'default' });

const router = useRouter();
const sessionsStore = useSessionsStore();
const search = ref('');
const statusFilter = ref<string | null>(null);
const machineFilter = ref<string | null>(null);

onMounted(() => sessionsStore.fetchSessions());

const filteredSessions = computed(() => {
  let result = sessionsStore.sessions;

  if (statusFilter.value) {
    result = result.filter((s) => s.status === statusFilter.value);
  }
  if (machineFilter.value) {
    result = result.filter((s) => s.machine_id === machineFilter.value);
  }
  if (search.value) {
    const q = search.value.toLowerCase();
    result = result.filter(
      (s) =>
        s.prompt.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.machine_id.toLowerCase().includes(q),
    );
  }
  return result;
});

const uniqueMachines = computed(() => [
  ...new Set(sessionsStore.sessions.map((s) => s.machine_id)),
]);

const statusColor: Record<string, string> = {
  running: 'success',
  completed: 'default',
  failed: 'error',
  queued: 'info',
  blocked: 'warning',
  cancelled: 'default',
};

function goToSession(id: string): void {
  router.push(`/sessions/${id}`);
}
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-4">
      <h1 class="text-h4 font-weight-bold">Sessions</h1>
      <v-btn variant="tonal" prepend-icon="mdi-grid" to="/sessions/grid">
        Grid View
      </v-btn>
    </div>

    <!-- Filters -->
    <v-row class="mb-4" dense>
      <v-col cols="12" sm="5">
        <v-text-field
          v-model="search"
          prepend-inner-icon="mdi-magnify"
          placeholder="Search prompts, IDs, machines..."
          density="compact"
          variant="outlined"
          hide-details
          clearable
        />
      </v-col>
      <v-col cols="6" sm="3">
        <v-select
          v-model="statusFilter"
          :items="[
            { title: 'All', value: null },
            { title: 'Running', value: 'running' },
            { title: 'Queued', value: 'queued' },
            { title: 'Completed', value: 'completed' },
            { title: 'Failed', value: 'failed' },
          ]"
          label="Status"
          density="compact"
          variant="outlined"
          hide-details
        />
      </v-col>
      <v-col cols="6" sm="3">
        <v-select
          v-model="machineFilter"
          :items="[{ title: 'All', value: null }, ...uniqueMachines.map(m => ({ title: m, value: m }))]"
          label="Machine"
          density="compact"
          variant="outlined"
          hide-details
        />
      </v-col>
    </v-row>

    <v-skeleton-loader v-if="sessionsStore.loading" type="table" />

    <v-data-table
      v-else
      :items="filteredSessions"
      :headers="[
        { title: 'Status', key: 'status', width: '100px' },
        { title: 'Prompt', key: 'prompt' },
        { title: 'Machine', key: 'machine_id', width: '140px' },
        { title: 'Created', key: 'created_at', width: '160px' },
        { title: 'Actions', key: 'actions', width: '120px', sortable: false },
      ]"
      density="comfortable"
      hover
      items-per-page="25"
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
        {{ new Date((value as number) * 1000).toLocaleString() }}
      </template>
      <template #item.actions="{ item }">
        <v-btn icon="mdi-console" size="small" variant="text"
          @click.stop="goToSession((item as { id: string }).id)" />
        <v-btn icon="mdi-replay" size="small" variant="text"
          @click.stop="router.push(`/sessions/${(item as { id: string }).id}/replay`)" />
      </template>
    </v-data-table>
  </div>
</template>
