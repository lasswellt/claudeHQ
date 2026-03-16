<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { WorkspaceRecord } from '@chq/shared';

definePageMeta({ layout: 'default' });

const workspaces = ref<WorkspaceRecord[]>([]);
const loading = ref(true);

onMounted(async () => {
  loading.value = true;
  // Workspaces are fetched via repos/:id detail, but we can list all
  // For now, show a placeholder that will be populated from job detail views
  loading.value = false;
});

const statusColor: Record<string, string> = {
  creating: 'info',
  preparing: 'warning',
  ready: 'success',
  active: 'primary',
  stale: 'default',
  cleanup: 'warning',
  deleted: 'error',
};
</script>

<template>
  <div>
    <h1 class="text-h4 font-weight-bold mb-6">Workspaces</h1>

    <v-alert v-if="workspaces.length === 0" type="info" variant="tonal">
      Workspaces are created automatically when jobs run. View workspace details from job pages.
    </v-alert>
  </div>
</template>
