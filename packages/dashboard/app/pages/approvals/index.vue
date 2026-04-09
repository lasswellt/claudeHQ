<script setup lang="ts">
import { onMounted, computed, ref } from 'vue';
import { useApprovalsStore } from '../../stores/approvals';
import ApproveWithRememberDialog from '../../components/approval/ApproveWithRememberDialog.vue';
import ApprovalDetailDrawer from '../../components/approval/ApprovalDetailDrawer.vue';
import type { ApprovalRequest } from '@chq/shared/browser';

definePageMeta({ layout: 'default' });

const store = useApprovalsStore();

onMounted(() => store.fetchApprovals());

// CAP-027: three-way decision drawer state.
const drawerOpen = ref(false);
const drawerApproval = ref<ApprovalRequest | null>(null);

function openDrawer(approval: ApprovalRequest): void {
  drawerApproval.value = approval;
  drawerOpen.value = true;
}

async function onDrawerResolve(
  id: string,
  decision: 'approve' | 'deny',
  opts: { editedInput?: string; responseText?: string },
): Promise<void> {
  await store.respond(id, decision, opts.responseText, false, opts.editedInput);
}

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

// CAP-028: Approve-and-Remember dialog state.
const approveDialogOpen = ref(false);
const dialogApproval = ref<ApprovalRequest | null>(null);

function openApproveDialog(approval: ApprovalRequest): void {
  dialogApproval.value = approval;
  approveDialogOpen.value = true;
}

async function onApproveConfirm(
  id: string,
  rememberAsRule: boolean,
  _ruleName: string | null,
): Promise<void> {
  // Note: rule name customization is reflected in the UI preview,
  // but the hub currently auto-generates the saved rule's name from
  // the tool. Propagating the custom name needs a small hub schema
  // bump — tracked for a future story.
  await store.respond(id, 'approve', undefined, rememberAsRule);
}

async function handleDeny(id: string): Promise<void> {
  await store.respond(id, 'deny');
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
      hover
      @click:row="(_: unknown, row: { item: ApprovalRequest }) => openDrawer(row.item)"
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
            @click.stop="openApproveDialog(item as ApprovalRequest)"
          >
            Approve
          </v-btn>
          <v-btn
            size="x-small"
            color="error"
            variant="tonal"
            @click.stop="handleDeny((item as { id: string }).id)"
          >
            Deny
          </v-btn>
        </template>
        <span v-else class="text-caption text-medium-emphasis">—</span>
      </template>
    </v-data-table>

    <!-- CAP-028: Approve-and-Remember flow -->
    <ApproveWithRememberDialog
      v-model="approveDialogOpen"
      :approval="dialogApproval"
      @confirm="onApproveConfirm"
    />

    <!-- CAP-027: three-way decision detail drawer -->
    <ApprovalDetailDrawer
      v-model="drawerOpen"
      :approval="drawerApproval"
      @resolve="onDrawerResolve"
    />
  </div>
</template>
