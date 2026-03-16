<script setup lang="ts">
import { computed } from 'vue';
import { useApprovalsStore } from '../../stores/approvals';

const props = defineProps<{ sessionId: string }>();
const store = useApprovalsStore();

const sessionApprovals = computed(() =>
  store.pending.filter((a) => a.session_id === props.sessionId),
);

async function respond(id: string, decision: 'approve' | 'deny'): Promise<void> {
  await store.respond(id, decision);
}
</script>

<template>
  <v-alert
    v-if="sessionApprovals.length > 0"
    type="warning"
    variant="tonal"
    class="mb-3"
    density="compact"
  >
    <div class="d-flex align-center justify-space-between flex-wrap ga-2">
      <span class="font-weight-medium">
        {{ sessionApprovals.length }} approval{{ sessionApprovals.length > 1 ? 's' : '' }} pending
      </span>
      <div class="d-flex ga-1 flex-wrap">
        <template v-for="approval in sessionApprovals" :key="approval.id">
          <v-chip size="small" class="mr-1">
            {{ approval.tool_name || approval.request_type }}
          </v-chip>
          <v-btn size="x-small" color="success" variant="tonal" @click="respond(approval.id, 'approve')">
            Approve
          </v-btn>
          <v-btn size="x-small" color="error" variant="tonal" @click="respond(approval.id, 'deny')">
            Deny
          </v-btn>
        </template>
      </div>
    </div>
  </v-alert>
</template>
