<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ApprovalRequest } from '@chq/shared/browser';

// CAP-027 / story 013-003: approval detail drawer with three-way
// Approve / Edit / Reject decision.
//
// Approve → resolve with decision='approve'
// Edit    → open the tool_input editor; user mutates the JSON; on
//           submit, validate + resolve with decision='approve' and
//           editedInput populated.
// Reject  → open the feedback field; resolve with decision='deny'
//           and responseText populated. The hub broadcasts the
//           feedback as a synthetic session:output chunk (013-004).

const props = defineProps<{
  modelValue: boolean;
  approval: ApprovalRequest | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'resolve', approvalId: string, decision: 'approve' | 'deny', opts: {
    editedInput?: string;
    responseText?: string;
  }): void;
}>();

type Mode = 'view' | 'edit' | 'reject';
const mode = ref<Mode>('view');

const editBuffer = ref('');
const rejectFeedback = ref('');
const editError = ref<string | null>(null);

watch(
  () => props.approval?.id,
  () => {
    mode.value = 'view';
    editBuffer.value = prettyInput.value;
    rejectFeedback.value = '';
    editError.value = null;
  },
);

// Pretty-print the tool_input if it's valid JSON; otherwise show it raw.
const prettyInput = computed(() => {
  const raw = props.approval?.tool_input;
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
});

const riskColor = computed(() => {
  switch (props.approval?.risk_level) {
    case 'critical':
      return 'error';
    case 'high':
      return 'warning';
    case 'medium':
      return 'info';
    case 'low':
    default:
      return 'success';
  }
});

function enterEditMode(): void {
  mode.value = 'edit';
  editBuffer.value = prettyInput.value;
  editError.value = null;
}

function enterRejectMode(): void {
  mode.value = 'reject';
  rejectFeedback.value = '';
}

function backToView(): void {
  mode.value = 'view';
  editError.value = null;
}

function approve(): void {
  if (!props.approval) return;
  emit('resolve', props.approval.id, 'approve', {});
  emit('update:modelValue', false);
}

function submitEdit(): void {
  if (!props.approval) return;
  // Validate JSON
  try {
    JSON.parse(editBuffer.value);
  } catch (e) {
    editError.value = `Invalid JSON: ${(e as Error).message}`;
    return;
  }
  emit('resolve', props.approval.id, 'approve', { editedInput: editBuffer.value });
  emit('update:modelValue', false);
}

function submitReject(): void {
  if (!props.approval) return;
  emit('resolve', props.approval.id, 'deny', {
    responseText: rejectFeedback.value.trim() || undefined,
  });
  emit('update:modelValue', false);
}
</script>

<template>
  <v-navigation-drawer
    :model-value="modelValue"
    location="right"
    temporary
    width="560"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card v-if="approval" flat class="h-100 d-flex flex-column">
      <v-toolbar density="compact" color="surface" class="flex-grow-0">
        <v-toolbar-title class="text-body-1">
          <v-icon class="mr-2">mdi-shield-check</v-icon>
          {{ approval.tool_name ?? approval.request_type }}
        </v-toolbar-title>
        <v-chip :color="riskColor" size="x-small" class="mr-2">
          {{ approval.risk_level }}
        </v-chip>
        <v-btn icon="mdi-close" size="small" variant="text" @click="emit('update:modelValue', false)" />
      </v-toolbar>

      <v-card-text class="flex-grow-1 overflow-y-auto">
        <!-- Metadata -->
        <div class="text-caption text-medium-emphasis mb-3">
          <div><strong>Session:</strong> <code>{{ approval.session_id.slice(0, 12) }}</code></div>
          <div><strong>Source:</strong> {{ approval.source }}</div>
          <div><strong>Created:</strong> {{ new Date(approval.created_at * 1000).toLocaleString() }}</div>
        </div>

        <!-- View mode — read-only tool_input -->
        <template v-if="mode === 'view'">
          <div v-if="approval.prompt_text" class="mb-3">
            <div class="text-caption text-medium-emphasis mb-1">Prompt</div>
            <div class="text-body-2" style="white-space: pre-wrap">{{ approval.prompt_text }}</div>
          </div>
          <div v-if="approval.tool_input" class="mb-3">
            <div class="text-caption text-medium-emphasis mb-1">Tool input</div>
            <pre class="pa-2 rounded bg-surface-variant text-body-2"
                 style="white-space: pre-wrap; word-break: break-all">{{ prettyInput }}</pre>
          </div>
          <div v-if="approval.terminal_context" class="mb-3">
            <div class="text-caption text-medium-emphasis mb-1">Terminal context</div>
            <pre class="pa-2 rounded bg-surface-variant text-caption"
                 style="white-space: pre-wrap; max-height: 160px; overflow-y: auto">{{ approval.terminal_context }}</pre>
          </div>
        </template>

        <!-- Edit mode — mutable tool_input JSON -->
        <template v-else-if="mode === 'edit'">
          <div class="text-caption text-medium-emphasis mb-1">
            Edit the tool input before approving.
          </div>
          <v-textarea
            v-model="editBuffer"
            variant="outlined"
            rows="12"
            auto-grow
            style="font-family: 'JetBrains Mono', monospace; font-size: 12px"
          />
          <v-alert
            v-if="editError"
            type="error"
            variant="tonal"
            density="compact"
            class="mt-2"
            closable
            @click:close="editError = null"
          >
            {{ editError }}
          </v-alert>
        </template>

        <!-- Reject mode — feedback text -->
        <template v-else-if="mode === 'reject'">
          <div class="text-caption text-medium-emphasis mb-1">
            Feedback for the session (optional). Will appear in the session stream.
          </div>
          <v-textarea
            v-model="rejectFeedback"
            placeholder="Explain why you're rejecting this request..."
            variant="outlined"
            rows="4"
            auto-grow
          />
        </template>
      </v-card-text>

      <!-- Action bar -->
      <v-divider />
      <v-card-actions class="flex-grow-0 pa-3">
        <template v-if="mode === 'view' && approval.status === 'pending'">
          <v-btn color="success" variant="flat" prepend-icon="mdi-check" @click="approve">
            Approve
          </v-btn>
          <v-btn color="primary" variant="tonal" prepend-icon="mdi-pencil" @click="enterEditMode">
            Edit
          </v-btn>
          <v-spacer />
          <v-btn color="error" variant="tonal" prepend-icon="mdi-close" @click="enterRejectMode">
            Reject
          </v-btn>
        </template>
        <template v-else-if="mode === 'edit'">
          <v-btn variant="text" @click="backToView">Back</v-btn>
          <v-spacer />
          <v-btn color="success" variant="flat" prepend-icon="mdi-check" @click="submitEdit">
            Approve with edits
          </v-btn>
        </template>
        <template v-else-if="mode === 'reject'">
          <v-btn variant="text" @click="backToView">Back</v-btn>
          <v-spacer />
          <v-btn color="error" variant="flat" prepend-icon="mdi-close" @click="submitReject">
            Reject
          </v-btn>
        </template>
        <template v-else>
          <v-chip size="small" class="ml-2">
            {{ approval.status }}
          </v-chip>
        </template>
      </v-card-actions>
    </v-card>
  </v-navigation-drawer>
</template>
