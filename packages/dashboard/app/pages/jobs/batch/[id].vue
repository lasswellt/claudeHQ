<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';

// CAP-055 / CAP-066 / story 016-006: batch detail view.

definePageMeta({ layout: 'default' });

interface BatchSummary {
  batchId: string;
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  jobs: Array<{
    id: string;
    repo_id: string;
    title: string;
    status: string;
    branch: string | null;
    pr_url: string | null;
    cost_usd: number | null;
    started_at: number | null;
    ended_at: number | null;
  }>;
}

const route = useRoute();
const router = useRouter();
const batchId = computed(() => route.params.id as string);

const summary = ref<BatchSummary | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const cancelling = ref(false);
const showCancelConfirm = ref(false);

async function fetchBatch(): Promise<void> {
  try {
    const res = await fetch(`/api/jobs/batch/${batchId.value}`);
    if (!res.ok) {
      if (res.status === 404) throw new Error('Batch not found');
      throw new Error(`HTTP ${res.status}`);
    }
    summary.value = (await res.json()) as BatchSummary;
    error.value = null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load batch';
  } finally {
    loading.value = false;
  }
}

// Poll while any jobs are pending or running.
let pollTimer: ReturnType<typeof setInterval> | null = null;
function startPolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (!summary.value) return;
    const active = summary.value.pending + summary.value.running;
    if (active === 0) {
      stopPolling();
      return;
    }
    await fetchBatch();
  }, 3000);
}
function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

onMounted(async () => {
  await fetchBatch();
  startPolling();
});

onUnmounted(() => stopPolling());

const progress = computed(() => {
  if (!summary.value || summary.value.total === 0) return 0;
  const done = summary.value.completed + summary.value.failed + summary.value.cancelled;
  return Math.round((done / summary.value.total) * 100);
});

async function cancelBatch(): Promise<void> {
  cancelling.value = true;
  try {
    const res = await fetch(`/api/jobs/batch/${batchId.value}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await fetchBatch();
    showCancelConfirm.value = false;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to cancel';
  } finally {
    cancelling.value = false;
  }
}

const statusColor: Record<string, string> = {
  pending: 'default',
  running: 'info',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
};
</script>

<template>
  <div>
    <div class="d-flex align-center mb-4">
      <v-btn icon="mdi-arrow-left" variant="text" @click="router.back()" />
      <h1 class="text-h5 font-weight-bold ml-2">
        Batch {{ batchId.slice(0, 8) }}
      </h1>
      <v-spacer />
      <v-btn
        v-if="summary && summary.pending + summary.running > 0"
        color="error"
        variant="tonal"
        prepend-icon="mdi-stop"
        @click="showCancelConfirm = true"
      >
        Cancel batch
      </v-btn>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
    <v-skeleton-loader v-if="loading" type="card, table" />

    <template v-else-if="summary">
      <!-- Summary row -->
      <v-row class="mb-4" dense>
        <v-col cols="6" sm="3"><v-card><v-card-text class="text-center"><div class="text-caption text-medium-emphasis">Total</div><div class="text-h4">{{ summary.total }}</div></v-card-text></v-card></v-col>
        <v-col cols="6" sm="3"><v-card><v-card-text class="text-center"><div class="text-caption text-medium-emphasis">Running</div><div class="text-h4 text-info">{{ summary.running }}</div></v-card-text></v-card></v-col>
        <v-col cols="6" sm="3"><v-card><v-card-text class="text-center"><div class="text-caption text-medium-emphasis">Completed</div><div class="text-h4 text-success">{{ summary.completed }}</div></v-card-text></v-card></v-col>
        <v-col cols="6" sm="3"><v-card><v-card-text class="text-center"><div class="text-caption text-medium-emphasis">Failed</div><div class="text-h4 text-error">{{ summary.failed }}</div></v-card-text></v-card></v-col>
      </v-row>

      <v-progress-linear
        :model-value="progress"
        color="primary"
        height="8"
        class="mb-4 rounded"
      >
        <template #default="{ value }">
          <span class="text-caption">{{ Math.round(value) }}%</span>
        </template>
      </v-progress-linear>

      <!-- Per-job table -->
      <v-card>
        <v-data-table
          :items="summary.jobs"
          :headers="[
            { title: 'Status', key: 'status', width: '110px' },
            { title: 'Job', key: 'title' },
            { title: 'Branch', key: 'branch', width: '200px' },
            { title: 'PR', key: 'pr_url', width: '80px' },
            { title: 'Cost', key: 'cost_usd', width: '100px' },
            { title: 'Actions', key: 'actions', width: '100px', sortable: false },
          ]"
          density="comfortable"
        >
          <template #item.status="{ value }">
            <v-chip :color="statusColor[value as string] ?? 'default'" size="small" variant="flat">
              {{ value }}
            </v-chip>
          </template>
          <template #item.branch="{ value }">
            <code v-if="value" class="text-caption">{{ value }}</code>
            <span v-else class="text-medium-emphasis">—</span>
          </template>
          <template #item.pr_url="{ value }">
            <v-btn
              v-if="value"
              size="small"
              variant="text"
              :href="value as string"
              target="_blank"
              icon="mdi-source-pull"
            />
            <span v-else class="text-medium-emphasis">—</span>
          </template>
          <template #item.cost_usd="{ value }">
            <span v-if="typeof value === 'number'">${{ value.toFixed(3) }}</span>
            <span v-else class="text-medium-emphasis">—</span>
          </template>
          <template #item.actions="{ item }">
            <v-btn
              size="small"
              variant="text"
              icon="mdi-open-in-new"
              :to="`/jobs/${(item as { id: string }).id}`"
            />
          </template>
        </v-data-table>
      </v-card>
    </template>

    <!-- Cancel confirmation -->
    <v-dialog v-model="showCancelConfirm" max-width="440">
      <v-card>
        <v-card-title>Cancel batch?</v-card-title>
        <v-card-text>
          This will cancel every pending and running job in this batch.
          Completed jobs will not be affected.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showCancelConfirm = false">Keep running</v-btn>
          <v-btn color="error" variant="flat" :loading="cancelling" @click="cancelBatch">
            Cancel batch
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
