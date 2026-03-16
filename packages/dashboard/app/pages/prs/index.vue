<script setup lang="ts">
import { ref, onMounted } from 'vue';

definePageMeta({ layout: 'default' });

interface PRRecord {
  id: string;
  job_id: string;
  repo_id: string;
  github_pr_number: number;
  github_pr_url: string;
  head_branch: string;
  base_branch: string;
  title: string;
  status: string;
  review_status: string;
  ci_status: string;
  additions: number;
  deletions: number;
  changed_files: number;
  created_at: number;
}

const prs = ref<PRRecord[]>([]);
const loading = ref(true);

onMounted(async () => {
  loading.value = true;
  const res = await fetch('/api/prs');
  prs.value = (await res.json()) as PRRecord[];
  loading.value = false;
});

const statusColor: Record<string, string> = {
  open: 'success',
  merged: 'primary',
  closed: 'error',
};

const reviewColor: Record<string, string> = {
  pending: 'warning',
  approved: 'success',
  changes_requested: 'error',
  reviewed: 'info',
};

const ciColor: Record<string, string> = {
  unknown: 'default',
  pending: 'warning',
  passing: 'success',
  failing: 'error',
};
</script>

<template>
  <div>
    <h1 class="text-h4 font-weight-bold mb-6">Pull Requests</h1>

    <v-skeleton-loader v-if="loading" type="table" />
    <v-alert v-else-if="prs.length === 0" type="info" variant="tonal">
      No pull requests yet. PRs are created automatically when jobs complete (if auto_pr is enabled).
    </v-alert>

    <v-data-table
      v-else
      :items="prs"
      :headers="[
        { title: 'PR', key: 'github_pr_number', width: '80px' },
        { title: 'Title', key: 'title' },
        { title: 'Status', key: 'status', width: '100px' },
        { title: 'Review', key: 'review_status', width: '120px' },
        { title: 'CI', key: 'ci_status', width: '100px' },
        { title: '+/-', key: 'changes', width: '100px', sortable: false },
        { title: 'Created', key: 'created_at', width: '160px' },
      ]"
      density="comfortable"
      hover
    >
      <template #item.github_pr_number="{ item, value }">
        <a :href="(item as PRRecord).github_pr_url" target="_blank" class="text-primary" @click.stop>
          #{{ value }}
        </a>
      </template>
      <template #item.status="{ value }">
        <v-chip :color="statusColor[value as string] ?? 'default'" size="small">
          {{ value }}
        </v-chip>
      </template>
      <template #item.review_status="{ value }">
        <v-chip :color="reviewColor[value as string] ?? 'default'" size="x-small">
          {{ (value as string)?.replace('_', ' ') }}
        </v-chip>
      </template>
      <template #item.ci_status="{ value }">
        <v-icon :color="ciColor[value as string] ?? 'default'" size="small">
          {{ (value as string) === 'passing' ? 'mdi-check-circle' : (value as string) === 'failing' ? 'mdi-close-circle' : 'mdi-help-circle' }}
        </v-icon>
      </template>
      <template #item.changes="{ item }">
        <span class="text-success">+{{ (item as PRRecord).additions ?? 0 }}</span>
        <span class="text-error ml-1">-{{ (item as PRRecord).deletions ?? 0 }}</span>
      </template>
      <template #item.created_at="{ value }">
        {{ new Date((value as number) * 1000).toLocaleString() }}
      </template>
    </v-data-table>
  </div>
</template>
