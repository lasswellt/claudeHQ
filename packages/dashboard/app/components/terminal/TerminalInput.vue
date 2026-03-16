<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  sessionId: string;
  disabled?: boolean;
}>();

const input = ref('');
const sending = ref(false);

async function sendInput(text: string): Promise<void> {
  if (!text || props.disabled) return;
  sending.value = true;
  try {
    await fetch(`/api/sessions/${props.sessionId}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text }),
    });
    input.value = '';
  } finally {
    sending.value = false;
  }
}

function onSubmit(): void {
  sendInput(input.value + '\n');
}
</script>

<template>
  <div class="d-flex align-center ga-2">
    <v-text-field
      v-model="input"
      :disabled="disabled"
      :loading="sending"
      placeholder="Type input and press Enter..."
      density="compact"
      variant="outlined"
      hide-details
      @keyup.enter="onSubmit"
    >
      <template #prepend-inner>
        <v-icon size="small" color="primary">mdi-console</v-icon>
      </template>
    </v-text-field>
    <v-btn size="small" variant="tonal" :disabled="disabled" @click="sendInput('y\n')">
      Yes
    </v-btn>
    <v-btn size="small" variant="tonal" :disabled="disabled" @click="sendInput('n\n')">
      No
    </v-btn>
    <v-btn size="small" variant="tonal" color="error" :disabled="disabled" @click="sendInput('\x03')">
      Ctrl+C
    </v-btn>
  </div>
</template>
