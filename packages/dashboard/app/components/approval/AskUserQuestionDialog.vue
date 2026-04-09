<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ApprovalRequest } from '@chq/shared/browser';

// CAP-030 / story 013-006: AskUserQuestion chat-bubble dialog.
//
// Triggered for approvals with request_type === 'ask_user'. Parses the
// approval's prompt_options JSON blob to decide between two modes:
//   - multi-choice: buttons for each option
//   - text: a free-form text response
//
// Honors an optional `previewFormat: 'markdown' | 'html'` field on the
// options blob. `html` uses v-html (the agent is the source of truth
// for its own session context, not external input). `markdown` is
// rendered as plain text with preserved line breaks to avoid pulling
// in a markdown parser dependency; a richer renderer can land later.

const props = defineProps<{
  modelValue: boolean;
  approval: ApprovalRequest | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'respond', approvalId: string, responseText: string): void;
}>();

interface AskUserOptions {
  previewFormat?: 'markdown' | 'html' | 'plain';
  choices?: Array<string | { label: string; value?: string }>;
  placeholder?: string;
}

const parsedOptions = computed<AskUserOptions>(() => {
  if (!props.approval?.prompt_options) return {};
  try {
    return JSON.parse(props.approval.prompt_options) as AskUserOptions;
  } catch {
    return {};
  }
});

const isMultiChoice = computed(() => {
  const choices = parsedOptions.value.choices;
  return Array.isArray(choices) && choices.length > 0;
});

const textResponse = ref('');
const submitting = ref(false);

// Reset the text field whenever a new approval is loaded.
watch(
  () => props.approval?.id,
  () => {
    textResponse.value = '';
    submitting.value = false;
  },
);

const promptText = computed(() => props.approval?.prompt_text ?? '');
const previewFormat = computed(() => parsedOptions.value.previewFormat ?? 'plain');

function normalizeChoice(
  c: string | { label: string; value?: string },
): { label: string; value: string } {
  if (typeof c === 'string') return { label: c, value: c };
  return { label: c.label, value: c.value ?? c.label };
}

const normalizedChoices = computed(() =>
  (parsedOptions.value.choices ?? []).map(normalizeChoice),
);

async function submitChoice(value: string): Promise<void> {
  if (!props.approval) return;
  submitting.value = true;
  emit('respond', props.approval.id, value);
  emit('update:modelValue', false);
}

async function submitText(): Promise<void> {
  if (!props.approval || !textResponse.value.trim()) return;
  submitting.value = true;
  emit('respond', props.approval.id, textResponse.value.trim());
  emit('update:modelValue', false);
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="560"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card v-if="approval">
      <v-card-title class="d-flex align-center ga-2">
        <v-icon color="info">mdi-chat-question</v-icon>
        Question from session
      </v-card-title>

      <v-card-text>
        <!-- Chat bubble -->
        <div class="chat-bubble pa-4 mb-4 rounded-lg">
          <div v-if="previewFormat === 'html'" v-html="promptText" />
          <div v-else class="text-body-1 chat-text">{{ promptText }}</div>
        </div>

        <!-- Multi-choice mode -->
        <div
          v-if="isMultiChoice"
          class="d-flex flex-column ga-2"
        >
          <v-btn
            v-for="choice in normalizedChoices"
            :key="choice.value"
            variant="tonal"
            color="primary"
            :disabled="submitting"
            @click="submitChoice(choice.value)"
          >
            {{ choice.label }}
          </v-btn>
        </div>

        <!-- Text mode -->
        <v-textarea
          v-else
          v-model="textResponse"
          :placeholder="parsedOptions.placeholder ?? 'Type your answer…'"
          rows="3"
          auto-grow
          variant="outlined"
          :disabled="submitting"
          @keydown.ctrl.enter="submitText"
        />
      </v-card-text>

      <v-card-actions v-if="!isMultiChoice">
        <v-spacer />
        <v-btn variant="text" @click="emit('update:modelValue', false)">
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!textResponse.trim() || submitting"
          @click="submitText"
        >
          Send
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.chat-bubble {
  background-color: rgb(var(--v-theme-surface-variant));
  border-left: 3px solid rgb(var(--v-theme-info));
}

.chat-text {
  white-space: pre-wrap;
  word-wrap: break-word;
}
</style>
