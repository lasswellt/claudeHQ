<script setup lang="ts">
import { computed, ref } from 'vue';
import { useApprovalsStore } from '../../stores/approvals';

// CAP-042 / story 013-012: sticky in-session approval banner with bulk actions.
// Shows pending approvals for the current session only. Supports
// Approve All Safe (low + medium) and Deny All. Collapsible.

const props = defineProps<{ sessionId: string }>();
const store = useApprovalsStore();

const collapsed = ref(false);

const sessionApprovals = computed(() =>
  store.pending.filter((a) => a.session_id === props.sessionId),
);

// "Safe" = low or medium risk. Critical + high require explicit review.
const safeApprovals = computed(() =>
  sessionApprovals.value.filter(
    (a) => a.risk_level === 'low' || a.risk_level === 'medium',
  ),
);

const riskyCount = computed(
  () => sessionApprovals.value.length - safeApprovals.value.length,
);

const bannerColor = computed(() => {
  if (sessionApprovals.value.some((a) => a.risk_level === 'critical')) return 'error';
  if (sessionApprovals.value.some((a) => a.risk_level === 'high')) return 'warning';
  return 'info';
});

async function respond(id: string, decision: 'approve' | 'deny'): Promise<void> {
  await store.respond(id, decision);
}

async function approveAllSafe(): Promise<void> {
  const ids = safeApprovals.value.map((a) => a.id);
  if (ids.length === 0) return;
  await store.bulkRespond(ids, 'approve');
}

async function denyAll(): Promise<void> {
  const ids = sessionApprovals.value.map((a) => a.id);
  if (ids.length === 0) return;
  await store.bulkRespond(ids, 'deny');
}

const riskColor: Record<string, string> = {
  low: 'success',
  medium: 'info',
  high: 'warning',
  critical: 'error',
};
</script>

<template>
  <v-alert
    v-if="sessionApprovals.length > 0"
    :type="bannerColor === 'error' ? 'error' : bannerColor === 'warning' ? 'warning' : 'info'"
    variant="tonal"
    class="mb-3 approval-banner-sticky"
    density="compact"
  >
    <div class="d-flex align-center justify-space-between flex-wrap ga-2">
      <div class="d-flex align-center ga-2">
        <v-btn
          :icon="collapsed ? 'mdi-chevron-right' : 'mdi-chevron-down'"
          size="x-small"
          variant="text"
          @click="collapsed = !collapsed"
        />
        <span class="font-weight-medium">
          {{ sessionApprovals.length }} approval{{ sessionApprovals.length > 1 ? 's' : '' }} pending
          <span v-if="riskyCount > 0" class="text-caption text-medium-emphasis">
            ({{ riskyCount }} need review)
          </span>
        </span>
      </div>

      <!-- Bulk actions — always visible even when collapsed -->
      <div class="d-flex ga-1">
        <v-btn
          v-if="safeApprovals.length > 0"
          size="small"
          color="success"
          variant="tonal"
          prepend-icon="mdi-check-all"
          @click="approveAllSafe"
        >
          Approve {{ safeApprovals.length }} safe
        </v-btn>
        <v-btn
          size="small"
          color="error"
          variant="tonal"
          prepend-icon="mdi-close-box-multiple"
          @click="denyAll"
        >
          Deny all
        </v-btn>
      </div>
    </div>

    <!-- Expanded per-approval row -->
    <v-expand-transition>
      <div v-show="!collapsed" class="mt-3 d-flex flex-column ga-2">
        <div
          v-for="approval in sessionApprovals"
          :key="approval.id"
          class="d-flex align-center ga-2 flex-wrap"
        >
          <v-chip
            :color="riskColor[approval.risk_level] ?? 'default'"
            size="x-small"
            variant="flat"
          >
            {{ approval.risk_level }}
          </v-chip>
          <span class="text-body-2 flex-grow-1 text-truncate">
            <strong>{{ approval.tool_name || approval.request_type }}</strong>
            <template v-if="approval.tool_input">
              — <code class="text-caption">{{ approval.tool_input.slice(0, 80) }}</code>
            </template>
          </span>
          <v-btn
            size="x-small"
            color="success"
            variant="tonal"
            @click="respond(approval.id, 'approve')"
          >
            Approve
          </v-btn>
          <v-btn
            size="x-small"
            color="error"
            variant="tonal"
            @click="respond(approval.id, 'deny')"
          >
            Deny
          </v-btn>
        </div>
      </div>
    </v-expand-transition>
  </v-alert>
</template>

<style scoped>
.approval-banner-sticky {
  position: sticky;
  top: 0;
  z-index: 5;
}
</style>
