import { ref } from 'vue';
import { defineStore } from 'pinia';
import type { QueueTask, HubToDashboardMessage } from '@chq/shared';

export const useQueuesStore = defineStore('queues', () => {
  const queuesByMachine = ref<Map<string, QueueTask[]>>(new Map());
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchQueues(machineId?: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const url = machineId ? `/api/queues/${machineId}` : '/api/queues';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as QueueTask[];
      if (machineId) {
        queuesByMachine.value.set(machineId, data);
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch queues';
    } finally {
      loading.value = false;
    }
  }

  function handleWsMessage(msg: HubToDashboardMessage): void {
    if (msg.type === 'queue:updated') {
      queuesByMachine.value.set(msg.machineId, msg.queue);
    }
  }

  return { queuesByMachine, loading, error, fetchQueues, handleWsMessage };
});
