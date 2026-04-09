import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import type { SessionRecord, HubToDashboardMessage } from '@chq/shared/browser';

export const useSessionsStore = defineStore('sessions', () => {
  const sessions = ref<SessionRecord[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // CAP-010: tag filter state
  const selectedTags = ref<string[]>([]);

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

  // Unique tags across all loaded sessions, alphabetically sorted.
  const allTags = computed(() => {
    const set = new Set<string>();
    for (const s of sessions.value) {
      for (const tag of s.tags ?? []) set.add(tag);
    }
    return [...set].sort();
  });

  // Sessions narrowed by any currently selected tag (OR match).
  // Empty selection means "no filter" → return everything.
  const filteredSessions = computed(() => {
    if (selectedTags.value.length === 0) return sessions.value;
    const sel = new Set(selectedTags.value);
    return sessions.value.filter((s) => (s.tags ?? []).some((t) => sel.has(t)));
  });

  function toggleTag(tag: string): void {
    const idx = selectedTags.value.indexOf(tag);
    if (idx >= 0) selectedTags.value.splice(idx, 1);
    else selectedTags.value.push(tag);
  }

  function clearTagFilter(): void {
    selectedTags.value = [];
  }

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
    // ME-23: extract into a local const so TypeScript narrows correctly even
    // if the compiler cannot prove msg.session is stable across the block.
    if (msg.type === 'session:updated') {
      const session = msg.session;
      const idx = sessions.value.findIndex((s) => s.id === session.id);
      if (idx >= 0) {
        sessions.value[idx] = session;
      } else {
        sessions.value.unshift(session);
      }
    }
  }

  return {
    sessions,
    loading,
    error,
    activeSessions,
    sessionById,
    selectedTags,
    allTags,
    filteredSessions,
    toggleTag,
    clearTagFilter,
    fetchSessions,
    handleWsMessage,
  };
});
