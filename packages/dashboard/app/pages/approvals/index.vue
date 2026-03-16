<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useApprovalsStore } from '../../stores/approvals';

definePageMeta({ layout: 'default' });

const store = useApprovalsStore();

onMounted(() => store.fetchApprovals());

const riskColor: Record<string, string> = {
  low: 'info',
  medium: 'warning',
  high: 'error',
  critical: 'error',
};

const statusColor: Record<string, string> = {
  pending: 'warning',
  approved: 'success',
  denied: 'error',
  timed_out: 'default',
  cancelled: 'default',
};

async function handleRespond(id: string, decision: 'approve' | 'deny'): Promise<void> {
  await store.respond(id, decision);
}

async function bulkApproveAllLowRisk(): Promise<void> {
  const lowRiskIds = store.pending
    .filter((a) => a.risk_level === 'low' || a.risk_level === 'medium')
    .map((a) => a.id);
  if (lowRiskIds.length > 0) {
    await store.bulkRespond(lowRiskIds, 'approve');
  }
}
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-6">
      <div class="d-flex align-center ga-3">
        <h1 class="text-h4 font-weight-bold">Approvals</h1>
        <v-chip v-if="store.pendingCount > 0" color="warning" size="small">
          {{ store.pendingCount }} pending
        </v-chip>
      </div>
      <div class="d-flex ga-2">
        <v-btn
          v-if="store.pending.length > 0"
          variant="tonal"
          color="success"
          size="small"
          @click="bulkApproveAllLowRisk"
        >
          Approve All Safe
        </v-btn>
        <v-btn variant="text" size="small" @click="store.fetchApprovals()">
          <v-icon>mdi-refresh</v-icon>
        </v-btn>
      </div>
    </div>

    <v-skeleton-loader v-if="store.loading" type="table" />
    <v-alert v-else-if="store.error" type="error" variant="tonal">
      {{ store.error }}
    </v-alert>
    <v-alert v-else-if="store.approvals.length === 0" type="info" variant="tonal">
      No approval requests.
    </v-alert>

    <v-data-table
      v-else
      :items="store.approvals"
      :headers="[
        { title: 'Risk', key: 'risk_level', width: '80px' },
        { title: 'Status', key: 'status', width: '100px' },
        { title: 'Type', key: 'request_type', width: '120px' },
        { title: 'Tool', key: 'tool_name', width: '100px' },
        { title: 'Session', key: 'session_id', width: '120px' },
        { title: 'Created', key: 'created_at', width: '150px' },
        { title: 'Actions', key: 'actions', width: '180px', sortable: false },
      ]"
      density="comfortable"
    >
      <template #item.risk_level="{ value }">
        <v-chip :color="riskColor[value as string]" size="x-small" variant="flat">
          {{ value }}
        </v-chip>
      </template>
      <template #item.status="{ value }">
        <v-chip :color="statusColor[value as string]" size="x-small">
          {{ value }}
        </v-chip>
      </template>
      <template #item.session_id="{ value }">
        <code class="text-caption">{{ (value as string)?.slice(0, 8) }}</code>
      </template>
      <template #item.created_at="{ value }">
        {{ new Date((value as number) * 1000).toLocaleTimeString() }}
      </template>
      <template #item.actions="{ item }">
        <template v-if="(item as { status: string }).status === 'pending'">
          <v-btn
            size="x-small"
            color="success"
            variant="tonal"
            class="mr-1"
            @click.stop="handleRespond((item as { id: string }).id, 'approve')"
          >
            Approve
          </v-btn>
          <v-btn
            size="x-small"
            color="error"
            variant="tonal"
            @click.stop="handleRespond((item as { id: string }).id, 'deny')"
          >
            Deny
          </v-btn>
        </template>
        <span v-else class="text-caption text-medium-emphasis">—</span>
      </template>
    </v-data-table>
  </div>
</template>
