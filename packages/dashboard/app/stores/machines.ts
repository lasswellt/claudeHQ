import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import type { MachineRecord, HubToDashboardMessage } from '@chq/shared';

export const useMachinesStore = defineStore('machines', () => {
  const machines = ref<MachineRecord[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const onlineMachines = computed(() =>
    machines.value.filter((m) => m.status === 'online'),
  );

  const machineById = computed(() => {
    const map = new Map<string, MachineRecord>();
    for (const m of machines.value) {
      map.set(m.id, m);
    }
    return map;
  });

  async function fetchMachines(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res = await fetch('/api/machines');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      machines.value = (await res.json()) as MachineRecord[];
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch machines';
    } finally {
      loading.value = false;
    }
  }

  function handleWsMessage(msg: HubToDashboardMessage): void {
    if (msg.type === 'machine:updated' && msg.machine) {
      const idx = machines.value.findIndex((m) => m.id === msg.machine.id);
      if (idx >= 0) {
        machines.value[idx] = msg.machine;
      } else {
        machines.value.push(msg.machine);
      }
    }
  }

  return { machines, loading, error, onlineMachines, machineById, fetchMachines, handleWsMessage };
});
