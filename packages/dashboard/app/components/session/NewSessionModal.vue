<script setup lang="ts">
import { ref } from 'vue';
import { useMachinesStore } from '../../stores/machines';

const props = defineProps<{
  modelValue: boolean;
  defaultMachineId?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'created', sessionId: string): void;
}>();

const machinesStore = useMachinesStore();
const machineId = ref(props.defaultMachineId ?? '');
const prompt = ref('');
const cwd = ref('');
const submitting = ref(false);
const error = ref<string | null>(null);

async function submit(): Promise<void> {
  if (!machineId.value || !prompt.value || !cwd.value) return;
  submitting.value = true;
  error.value = null;

  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        machineId: machineId.value,
        prompt: prompt.value,
        cwd: cwd.value,
      }),
    });

    if (!res.ok) {
      const data = (await res.json()) as { error: string };
      throw new Error(data.error);
    }

    const session = (await res.json()) as { id: string };
    emit('created', session.id);
    emit('update:modelValue', false);
    prompt.value = '';
    cwd.value = '';
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to create session';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="600" @update:model-value="emit('update:modelValue', $event)">
    <v-card>
      <v-card-title>New Session</v-card-title>
      <v-card-text>
        <v-alert v-if="error" type="error" variant="tonal" class="mb-4" closable @click:close="error = null">
          {{ error }}
        </v-alert>
        <v-select
          v-model="machineId"
          :items="machinesStore.onlineMachines.map(m => ({ title: m.display_name || m.id, value: m.id }))"
          label="Machine"
          class="mb-3"
        />
        <v-textarea
          v-model="prompt"
          label="Prompt"
          placeholder="What should Claude do?"
          rows="3"
          class="mb-3"
        />
        <v-text-field v-model="cwd" label="Working Directory" placeholder="/home/user/project" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="submitting"
          :disabled="!machineId || !prompt || !cwd"
          @click="submit"
        >
          Start Session
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
