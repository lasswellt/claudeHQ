<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { ApprovalPolicyRule } from '@chq/shared/browser';

definePageMeta({ layout: 'default' });

const rules = ref<ApprovalPolicyRule[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const deleteConfirmId = ref<string | null>(null);

async function fetchRules(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch('/api/approval-policies');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rules.value = (await res.json()) as ApprovalPolicyRule[];
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to fetch';
  } finally {
    loading.value = false;
  }
}

async function deleteRule(id: string): Promise<void> {
  error.value = null;
  try {
    const res = await fetch(`/api/approval-policies/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await fetchRules();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to delete rule';
  } finally {
    deleteConfirmId.value = null;
  }
}

function formatToolNames(value: unknown): string {
  if (!value) return '';
  try {
    const parsed = JSON.parse(value as string) as string[];
    return parsed.join(', ');
  } catch {
    return String(value);
  }
}

const actionColor: Record<string, string> = {
  auto_approve: 'success',
  auto_deny: 'error',
  require_approval: 'warning',
};

onMounted(() => fetchRules());
</script>

<template>
  <div>
    <h1 class="text-h4 font-weight-bold mb-6">Approval Policies</h1>

    <v-skeleton-loader v-if="loading" type="table" />
    <v-alert v-else-if="error" type="error" variant="tonal">{{ error }}</v-alert>

    <v-data-table
      v-else
      :items="rules"
      :headers="[
        { title: 'Priority', key: 'priority', width: '80px' },
        { title: 'Name', key: 'name' },
        { title: 'Match Tool', key: 'match_tool_name', width: '150px' },
        { title: 'Action', key: 'action', width: '150px' },
        { title: 'Enabled', key: 'enabled', width: '80px' },
        { title: '', key: 'actions', width: '80px', sortable: false },
      ]"
      density="comfortable"
    >
      <template #item.match_tool_name="{ value }">
        <span v-if="value">{{ formatToolNames(value) }}</span>
        <span v-else class="text-medium-emphasis">Any</span>
      </template>
      <template #item.action="{ value }">
        <v-chip :color="actionColor[value as string]" size="small">
          {{ (value as string).replace(/_/g, ' ') }}
        </v-chip>
      </template>
      <template #item.enabled="{ value }">
        <v-icon :color="value ? 'success' : 'default'" size="small">
          {{ value ? 'mdi-check-circle' : 'mdi-close-circle' }}
        </v-icon>
      </template>
      <template #item.actions="{ item }">
        <v-btn
          icon="mdi-delete"
          size="x-small"
          variant="text"
          color="error"
          @click="deleteConfirmId = (item as { id: string }).id"
        />
      </template>
    </v-data-table>

    <v-dialog :model-value="!!deleteConfirmId" max-width="400" @update:model-value="deleteConfirmId = null">
      <v-card>
        <v-card-title>Delete Policy Rule?</v-card-title>
        <v-card-text>This action cannot be undone.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleteConfirmId = null">Cancel</v-btn>
          <v-btn color="error" variant="flat" @click="deleteRule(deleteConfirmId!)">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
