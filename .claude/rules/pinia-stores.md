---
globs: "packages/dashboard/**/stores/**"
---
# Pinia Store Patterns

- Setup syntax: `defineStore('storeName', () => { ... })`
- Return reactive state, computed getters, and action functions
- WebSocket integration via composables, not directly in stores
- Clean up subscriptions and intervals in store `$dispose`
- Store names match file names: `sessions.ts` → `defineStore('sessions', ...)`

```typescript
export const useSessionsStore = defineStore('sessions', () => {
  const sessions = ref<SessionRecord[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const activeSessions = computed(() =>
    sessions.value.filter(s => s.status === 'running')
  );

  async function fetchSessions() {
    loading.value = true;
    error.value = null;
    try {
      const res = await fetch('/api/sessions');
      sessions.value = await res.json();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch sessions';
    } finally {
      loading.value = false;
    }
  }

  return { sessions, loading, error, activeSessions, fetchSessions };
});
```
