<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import type { JobRecord } from '@chq/shared/browser';

definePageMeta({ layout: 'default' });

const router = useRouter();
const jobs = ref<JobRecord[]>([]);
const loading = ref(true);

onMounted(async () => {
  loading.value = true;
  const res = await fetch('/api/jobs');
  jobs.value = (await res.json()) as JobRecord[];
  loading.value = false;
});

const statusColor: Record<string, string> = {
  pending: 'info',
  provisioning: 'warning',
  preparing: 'warning',
  running: 'success',
  post_processing: 'info',
  completed: 'success',
  failed: 'error',
  cancelled: 'default',
};
</script>

<template>
  <div>
    <h1 class="text-h4 font-weight-bold mb-6">Jobs</h1>

    <v-skeleton-loader v-if="loading" type="table" />
    <v-alert v-else-if="jobs.length === 0" type="info" variant="tonal">
      No jobs yet. Launch one from the Repos page.
    </v-alert>

    <v-data-table
      v-else
      :items="jobs"
      :headers="[
        { title: 'Status', key: 'status', width: '120px' },
        { title: 'Title', key: 'title' },
        { title: 'Machine', key: 'machine_id', width: '140px' },
        { title: 'Cost', key: 'cost_usd', width: '80px' },
        { title: 'Files', key: 'files_changed', width: '80px' },
        { title: 'Created', key: 'created_at', width: '160px' },
      ]"
      density="comfortable"
      hover
      @click:row="(_: unknown, row: { item: { id: string } }) => router.push(`/jobs/${row.item.id}`)"
    >
      <template #item.status="{ value }">
        <v-chip :color="statusColor[value as string] ?? 'default'" size="small">
          {{ value }}
        </v-chip>
      </template>
      <template #item.cost_usd="{ value }">
        ${{ ((value as number) ?? 0).toFixed(2) }}
      </template>
      <template #item.created_at="{ value }">
        {{ new Date((value as number) * 1000).toLocaleString() }}
      </template>
    </v-data-table>
  </div>
</template>
