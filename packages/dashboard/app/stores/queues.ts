import { ref } from 'vue';
import { defineStore } from 'pinia';
import type { QueueTask, HubToDashboardMessage } from '@chq/shared/browser';

export const useQueuesStore = defineStore('queues', () => {
  const queuesByMachine = ref<Map<string, QueueTask[]>>(new Map());
  const loading = ref(false);
  const error = ref<string | null>(null);

  // ME-20: machineId is required — queues are always per-machine. The optional
  // variant silently discarded fetched data when machineId was absent.
  async function fetchQueues(machineId: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res = await fetch(`/api/queues/${machineId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as QueueTask[];
      queuesByMachine.value.set(machineId, data);
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
