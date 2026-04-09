<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ApprovalRequest } from '@chq/shared/browser';

// CAP-028 / story 013-005: Approve-and-Remember flow.
//
// Dialog opened when the user clicks Approve on a pending approval.
// Fast path: just click Approve again to resolve. Slow path: tick
// "Remember" to reveal a rule preview with a customizable name, then
// click Approve — the resolve call passes rememberAsRule=true and the
// hub saves a new approval_policy_rules row referencing
// created_from_approval_id (existing backend behavior).

const props = defineProps<{
  modelValue: boolean;
  approval: ApprovalRequest | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'confirm', approvalId: string, rememberAsRule: boolean, ruleName: string | null): void;
}>();

const remember = ref(false);
const ruleName = ref('');

// Reset whenever the approval changes.
watch(
  () => props.approval?.id,
  () => {
    remember.value = false;
    ruleName.value = defaultRuleName.value;
  },
);

// Default rule name derives from the tool name. Users can override
// before saving.
const defaultRuleName = computed(() => {
  if (!props.approval?.tool_name) return '';
  return `Auto-approve ${props.approval.tool_name}`;
});

watch(defaultRuleName, (val) => {
  if (!remember.value) ruleName.value = val;
});

// Human-readable preview of what the saved rule would do.
const rulePreview = computed(() => {
  if (!props.approval) return null;
  const tool = props.approval.tool_name;
  if (!tool) return null;
  return {
    name: ruleName.value || defaultRuleName.value,
    match: { tool_name: [tool] },
    action: 'auto_approve' as const,
    priority: 45,
    source: `approval:${props.approval.id.slice(0, 8)}`,
  };
});

function handleApprove(): void {
  if (!props.approval) return;
  const save = remember.value;
  emit('confirm', props.approval.id, save, save ? (ruleName.value || defaultRuleName.value) : null);
  emit('update:modelValue', false);
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="520"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card v-if="approval">
      <v-card-title class="d-flex align-center ga-2">
        <v-icon color="success">mdi-shield-check</v-icon>
        Approve {{ approval.tool_name ?? approval.request_type }}
      </v-card-title>

      <v-card-text>
        <div v-if="approval.tool_input" class="mb-3">
          <div class="text-caption text-medium-emphasis mb-1">Tool input</div>
          <code class="d-block pa-2 rounded bg-surface-variant text-body-2"
                style="white-space: pre-wrap; word-break: break-all;">
            {{ approval.tool_input }}
          </code>
        </div>

        <v-checkbox
          v-if="approval.tool_name"
          v-model="remember"
          label="Remember for similar requests"
          hint="Save this as an auto-approve rule so future matching requests don't prompt you."
          persistent-hint
          density="compact"
        />

        <!-- Rule preview appears when "remember" is checked -->
        <v-expand-transition>
          <div v-show="remember && rulePreview" class="mt-3">
            <v-card variant="outlined" class="pa-3">
              <div class="text-caption text-medium-emphasis mb-2">Rule preview</div>
              <v-text-field
                v-model="ruleName"
                label="Rule name"
                density="compact"
                variant="outlined"
                hide-details="auto"
                class="mb-3"
              />
              <div class="text-caption">
                <div>
                  <strong>Matches:</strong> tool_name in
                  <code>{{ JSON.stringify(rulePreview?.match.tool_name) }}</code>
                </div>
                <div><strong>Action:</strong> auto_approve</div>
                <div><strong>Priority:</strong> 45</div>
                <div><strong>Source:</strong> {{ rulePreview?.source }}</div>
              </div>
            </v-card>
          </div>
        </v-expand-transition>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('update:modelValue', false)">
          Cancel
        </v-btn>
        <v-btn color="success" variant="flat" @click="handleApprove">
          {{ remember ? 'Approve & save rule' : 'Approve' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
