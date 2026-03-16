<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useTerminal } from '../../composables/useTerminal';
import { useWebSocket } from '../../composables/useWebSocket';
import type { HubToDashboardMessage } from '@chq/shared';

const props = defineProps<{
  sessionId: string;
  readonly?: boolean;
}>();

const containerRef = ref<HTMLElement | null>(null);
const { write } = useTerminal(containerRef);
const ws = useWebSocket();

let unsubscribeOutput: (() => void) | null = null;

onMounted(() => {
  // Subscribe to session output
  ws.subscribe('session', props.sessionId);

  unsubscribeOutput = ws.onMessage('session:output', (msg: HubToDashboardMessage) => {
    if (msg.type === 'session:output' && msg.sessionId === props.sessionId) {
      for (const chunk of msg.chunks) {
        write(chunk.data);
      }
    }
  });
});

onUnmounted(() => {
  ws.unsubscribe('session', props.sessionId);
  unsubscribeOutput?.();
});

watch(() => props.sessionId, (newId, oldId) => {
  if (oldId) ws.unsubscribe('session', oldId);
  ws.subscribe('session', newId);
});
</script>

<template>
  <div ref="containerRef" class="terminal-container" />
</template>

<style scoped>
.terminal-container {
  width: 100%;
  height: 100%;
  min-height: 400px;
  background: #1e1e1e;
  border-radius: 8px;
  overflow: hidden;
}
</style>
