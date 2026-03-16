import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import type { SessionRecord, HubToDashboardMessage } from '@chq/shared/browser';

export const useSessionsStore = defineStore('sessions', () => {
  const sessions = ref<SessionRecord[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const activeSessions = computed(() =>
    sessions.value.filter((s) => s.status === 'running'),
  );

  const sessionById = computed(() => {
    const map = new Map<string, SessionRecord>();
    for (const s of sessions.value) {
      map.set(s.id, s);
    }
    return map;
  });

  async function fetchSessions(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      sessions.value = (await res.json()) as SessionRecord[];
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch sessions';
    } finally {
      loading.value = false;
    }
  }

  function handleWsMessage(msg: HubToDashboardMessage): void {
    if (msg.type === 'session:updated' && msg.session) {
      const idx = sessions.value.findIndex((s) => s.id === msg.session.id);
      if (idx >= 0) {
        sessions.value[idx] = msg.session;
      } else {
        sessions.value.unshift(msg.session);
      }
    }
  }

  return { sessions, loading, error, activeSessions, sessionById, fetchSessions, handleWsMessage };
});
